// Autonomous-work rules: the decision tree an idle colonist runs to find
// useful work without being given an explicit order.
//
// This file is the script-level surface for "how the colony behaves on
// its own". Extracted out of game.js so future versions can:
//   - swap in a different rule set (mod / faction / behaviour preset),
//   - keep the engine (state mutations, animation, build effects) stable
//     while iterating on the policy on top of it.
//
// `pickAutonomousTask` is a pure function over the game state — it reads
// from `game` but never mutates it, and returns either a freshly created
// task or `null`. The class method `Game._autonomousTask` is a thin shim
// that delegates here, so existing call sites and tests still work.

import { TaskType, createTask } from './tasks.js';
import { isRipe } from './crops.js';
import {
  ON_HAND_LOW,
  ON_HAND_CAP,
  MEAL_TARGET,
  HUNT_FOOD_PER_HEAD,
  AUTO_HUNT_RANGE,
  AUTO_SEARCH_RANGE,
  FENCE_AUTO_CAP,
  STOCKPILE_CAP,
  WOOD_LOW,
  HUT_CAPACITY_BY_TYPE,
  BIRTH_FOOD_PER_HEAD,
  BUILD_COSTS,
} from './config.js';
import { registerScript } from './groups.js';
import { t } from './i18n.js';
import { TileType } from './map/tile.js';
import { genomeQuality } from './genetics.js';

// --- α26 warehouse policy ----------------------------------------------
//
// Decision logic for "should we start another warehouse, and where?" now
// lives in the script tree (each script can override it). The defaults
// below are what the balanced / farmer / scout scripts all share. The
// `wantsWarehouse(game, opts)` helper returns:
//   - { build: 'stockpile_med', spot, reason: 'utilization 0.95' } → fire BUILD
//   - { build: null, reason: 'no_wood' } → script logs (optional) & moves on
//   - null → no decision (no warehouses needed)
//
// `opts.utilThreshold` lets a script (e.g. selective-breeding farmer)
// build sooner / later by passing a different fill ratio.

const WAREHOUSE_HARD_CAP = 40;
// Diagnostic log: emitted at most once per (groupId, reason) per minute
// so the activity log doesn't flood with "no land for warehouse".
const _warnedAt = new Map();
function _maybeWarn(game, c, reason, textKey, params) {
  const key = `${c?.groupId ?? 0}|${reason}`;
  const last = _warnedAt.get(key) || -Infinity;
  if (game.clock - last < 60) return;
  _warnedAt.set(key, game.clock);
  if (game._pushLog) {
    game._pushLog({
      icon: '⚠',
      text: t(textKey, params),
      cls: 'log-warn',
      groupId: c?.groupId,
    });
  }
}

/** Pick the best warehouse variant the colony can afford right now. */
function pickWarehouseVariant(game) {
  // Try large → medium → basic and return the first the colony can pay
  // for. Tier-2 huts/stockpiles arrived in α26 with steeper costs but
  // far more storage per ground tile, so the auto-builder prefers them
  // once the wood reserve catches up.
  for (const variant of ['stockpile_large', 'stockpile_med', 'stockpile']) {
    if (game._canAffordBuild(variant)) return variant;
  }
  return null;
}

/** Wood cost of the cheapest warehouse variant — used in the diagnostic
 * log so the player knows what they're short of. */
function cheapestWarehouseCost() {
  return BUILD_COSTS.stockpile;
}

/**
 * Script-level decision: should an idle colonist start a warehouse?
 * Returns an action descriptor or null. Diagnostic warnings are logged
 * when the answer is "yes but blocked" so the player can tell the
 * difference between "no space for it" and "no wood for it".
 *
 * G1: every count and utilisation is per-group, so Colony B will build
 * its own first warehouse even if Colony A already has three. The
 * colony-wide hard cap still applies to keep the map from filling up.
 */
export function wantsWarehouse(game, colonist, { utilThreshold = 0.85 } = {}) {
  const gid = colonist.groupId;
  const totalSp = game.stockpiles.length + game._pendingBuilds('stockpile')
    + game._pendingBuilds('stockpile_med') + game._pendingBuilds('stockpile_large');
  if (totalSp >= WAREHOUSE_HARD_CAP) return null;
  // First own-group warehouse is always wanted. After that, only when
  // own-group fill is past the configured threshold for the script.
  const ownPiles = game._stockpileCountFor(gid);
  let wants = ownPiles === 0;
  if (!wants && game._warehouseUtilizationFor(gid) >= utilThreshold) wants = true;
  if (!wants) return null;
  const variant = pickWarehouseVariant(game);
  if (!variant) {
    const have = Math.max(0, Math.floor((game.storage.wood || 0) - game._reservedBuildWood()));
    _maybeWarn(game, colonist, 'no_wood', 'log.warehouseNoWood', {
      have,
      need: cheapestWarehouseCost(),
    });
    return { build: null, reason: 'no_wood' };
  }
  let spot = game._findFreeLandNear(colonist);
  if (!spot) spot = game._findFreeLandColonyWide?.(colonist);
  if (!spot) {
    _maybeWarn(game, colonist, 'no_land', 'log.warehouseNoLand', {
      variant: t('structure.' + variant),
    });
    return { build: null, reason: 'no_land' };
  }
  return { build: variant, spot, reason: 'ok' };
}

/**
 * Beds in flight for already-queued / in-progress hut builds. G1: only
 * counts builds owned by `gid` (= the requesting colonist's group), so
 * Colony B's auto-builder doesn't think Colony A's queued hut covers
 * its own bed shortage.
 */
function autoHutPendingBeds(game, gid) {
  let n = 0;
  for (const t of game.taskQueue) {
    if (t.type !== TaskType.BUILD || !HUT_CAPACITY_BY_TYPE[t.structure]) continue;
    // Queued tasks pick up the assignee's group at run time. Tasks
    // without an assignee yet are colony-wide; we count them only when
    // gid is null (= colony-wide caller, legacy).
    if (gid != null && t.assignee) {
      const c = game.colonists.find((cc) => cc.name === t.assignee);
      if (!c || c.groupId !== gid) continue;
    } else if (gid != null) {
      continue;
    }
    n += HUT_CAPACITY_BY_TYPE[t.structure];
  }
  for (const c of game.colonists) {
    const ct = c.currentTask;
    if (!ct || ct.type !== TaskType.BUILD || !HUT_CAPACITY_BY_TYPE[ct.structure]) continue;
    if (gid != null && c.groupId !== gid) continue;
    n += HUT_CAPACITY_BY_TYPE[ct.structure];
  }
  return n;
}

/** Hearth builds in flight that belong to `gid`. */
function autoHearthPending(game, gid) {
  let n = 0;
  for (const t of game.taskQueue) {
    if (t.type !== TaskType.BUILD || t.structure !== 'hearth') continue;
    if (gid != null && t.assignee) {
      const c = game.colonists.find((cc) => cc.name === t.assignee);
      if (!c || c.groupId !== gid) continue;
    } else if (gid != null) {
      continue;
    }
    n++;
  }
  for (const c of game.colonists) {
    const ct = c.currentTask;
    if (!ct || ct.type !== TaskType.BUILD || ct.structure !== 'hearth') continue;
    if (gid != null && c.groupId !== gid) continue;
    n++;
  }
  return n;
}

/** Pick the most economical hut variant for the group's current size. */
function pickAutoHutVariant(game, gid) {
  const need = gid == null
    ? game.colonists.length
    : (game.groups?.[gid]?.colonists?.length || 0);
  if (need >= 12) return 'hut_large';
  if (need >= 4) return 'hut_med';
  return 'hut';
}

/**
 * H4: own-colony infra builder — returns a BUILD task for the most
 * urgent missing structure (hut → hearth → warehouse), or null when
 * everything's covered. Extracted so every script (balanced, farmer,
 * scout, farmer_breed) can run the same check at the top of its
 * decision tree. Previously only the balanced script's auto-build
 * branch evaluated infra, which meant farmer_breed (whose till/sow
 * pipeline never empties) effectively never built anything.
 */
export function urgentInfraBuild(game, colonist) {
  if (!game.autoMode) return null;
  const gid = colonist.groupId;
  const ownPop = game.groups?.[gid]?.colonists?.length || game.colonists.length;
  // 1. Hut — own beds short of own colonists.
  const beds = game._hutCapacityFor(gid) + autoHutPendingBeds(game, gid);
  if (beds < ownPop) {
    const variant = pickAutoHutVariant(game, gid);
    if (game._canAffordBuild(variant)) {
      const spot = game._findFreeLandNear(colonist);
      if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: variant });
    }
  }
  // 2. Hearth — own hearths short of own huts (so each hut has warmth).
  const ownHearths = game._hearthCountFor(gid) + autoHearthPending(game, gid);
  const ownHuts = game._hutCountFor(gid);
  if (ownHearths < ownHuts && game._canAffordBuild('hearth')) {
    const spot = game._findFreeLandNear(colonist);
    if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'hearth' });
  }
  // 3. Warehouse — wantsWarehouse handles "first one" + the
  // utilisation threshold for follow-up expansions. The same helper
  // is shared with the critical-warehouse pivot at script level.
  const wh = wantsWarehouse(game, colonist);
  if (wh && wh.build) {
    return createTask(TaskType.BUILD, wh.spot.x, wh.spot.y, { structure: wh.build });
  }
  return null;
}

/**
 * Pick the next bit of self-directed work for `colonist`, or `null` if
 * there is nothing useful to do (the caller falls back to idling).
 *
 * Priority order (top wins):
 *   1. harvest ripe crops
 *   2. fetch food back from a stockpile when on-hand is low
 *   3. water crops that have run dry
 *   4. clear withered crops
 *   5. extend the auto-fence plan against a nearby boar
 *   6. cook raw food on a lit hearth
 *   7. hunt when colony stores are short of food
 *   8. chop a tree when wood is low
 *   9. build infrastructure (hut → hearth → warehouse)
 *  10. till new ground and sow the most-stocked crop
 *  11. haul surplus on-hand food into a stockpile
 *
 * @param {object} game  the Game instance
 * @param {object} colonist
 * @returns {?object} a task created via createTask, or null
 */
export function pickAutonomousTask(game, colonist) {
  // Alpha 24: at 95% warehouse utilization the colony hits CRITICAL —
  // every colonist drops harvest / hunt / forage work and rushes to
  // build another warehouse (or chop wood for it). Otherwise the
  // "on-hand full" rule from α19 stays the same.
  // G1: the critical-warehouse check is now per-group — Colony B
  // doesn't drop everything because Colony A's warehouses are full.
  const critical = game._warehousesCriticalFor?.(colonist.groupId) || false;
  if (critical && game.autoMode) {
    const dec = wantsWarehouse(game, colonist, { utilThreshold: 0.95 });
    if (dec && dec.build) {
      return createTask(TaskType.BUILD, dec.spot.x, dec.spot.y, { structure: dec.build });
    }
    // Either no wood (try to chop) or no land near (fall through, the
    // diagnostic log already explains why). When wood was the blocker,
    // rush a tree so building unblocks itself.
    if (dec && dec.reason === 'no_wood') {
      const tree = game._nearestTree(colonist, AUTO_SEARCH_RANGE);
      if (tree) return createTask(TaskType.HARVEST, tree.x, tree.y);
    }
  }
  // On-hand is full. Anything that would *add* to it (harvest a ripe crop,
  // fetch food, hunt, forage by chopping a wild plant) is skipped this
  // turn — colonists prefer to STORE first instead. This stops auto mode
  // from running on-hand way past its cap while the storage queue is
  // perpetually crowded out by farm work.
  const onHandFull = critical || game.onHandFood >= ON_HAND_CAP;
  if (onHandFull) {
    const sp = game._nearestOwnStockpile(colonist, (s) => game.stockpileFood(s) < (s.cap || STOCKPILE_CAP));
    if (sp && !game._tileClaimed(sp.x, sp.y)) {
      return createTask(TaskType.STORE, sp.x, sp.y);
    }
    // D3: no warehouse can accept this haul → treat the situation like
    // a warehouse shortage and pivot to building one (or chopping wood
    // for it). Falls through to non-additive chores only if even that
    // is blocked, so colonists never sit idle while their pockets are
    // full and food is rotting.
    if (game.autoMode) {
      const dec = wantsWarehouse(game, colonist, { utilThreshold: 0 });
      if (dec && dec.build) {
        return createTask(TaskType.BUILD, dec.spot.x, dec.spot.y, { structure: dec.build });
      }
      if (dec && dec.reason === 'no_wood') {
        const tree = game._nearestTree(colonist, AUTO_SEARCH_RANGE);
        if (tree) return createTask(TaskType.HARVEST, tree.x, tree.y);
      }
    }
    // Even the build pivot is blocked (no land / no tree) — fall through
    // to non-additive chores: watering, weeding, cooking.
  }
  // E3 helper: only auto-tend a crop if it belongs to the same colony.
  // Old crops (saved games before E3) have no ownerId — treat those as
  // "anyone may help" so we don't ghost-orphan them on first load.
  const gid = colonist.groupId;
  const ownsCrop = (crop) => crop.ownerId == null || crop.ownerId === gid;
  const reachable = (x, y) => !colonist.isUnreachable?.(x, y, game.clock);
  // 1. Gather ripe crops — skipped when on-hand is full so colonists do
  //    not pile food up faster than they can store it.
  if (!onHandFull) {
    for (const crop of game.crops) {
      if (!ownsCrop(crop)) continue;
      if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y) && reachable(crop.x, crop.y)) {
        return createTask(TaskType.HARVEST, crop.x, crop.y);
      }
    }
  }
  // 2. Fetch food back from a stockpile when the on-hand store runs low.
  if (game.onHandFood < ON_HAND_LOW) {
    const sp = game._nearestOwnStockpile(colonist, (s) => game.stockpileFood(s) > 0);
    if (sp && !game._tileClaimed(sp.x, sp.y) && reachable(sp.x, sp.y)) {
      return createTask(TaskType.FETCH, sp.x, sp.y);
    }
  }
  // 3. Tend crops that have run dry.
  for (const crop of game.crops) {
    if (!ownsCrop(crop)) continue;
    if (
      !crop.withered &&
      !isRipe(crop) &&
      game.clock >= crop.wateredUntil &&
      !game._tileClaimed(crop.x, crop.y) &&
      reachable(crop.x, crop.y)
    ) {
      return createTask(TaskType.WATER, crop.x, crop.y);
    }
  }
  // 4. Clear away withered, dead crops.
  for (const crop of game.crops) {
    if (!ownsCrop(crop)) continue;
    if (crop.withered && !game._tileClaimed(crop.x, crop.y) && reachable(crop.x, crop.y)) {
      return createTask(TaskType.WEED, crop.x, crop.y);
    }
  }
  // 5. Throw up a fence between the colony and a nearby boar — colony-
  // wide plan, see Game#_nextFenceTile.
  if (
    game.autoMode &&
    game._totalFences() < FENCE_AUTO_CAP &&
    game._canAffordBuild('fence')
  ) {
    const spot = game._nextFenceTile(colonist);
    if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'fence' });
  }
  // 6. Cook raw food into meals while a hearth is lit. H2: every input
  // to the decision is per-group — own raw food, own meal stock, own
  // hearths — so Colony B never marches to Colony A's hearth on
  // Colony A's food. When B has no hearth, this branch returns null
  // and the auto-build path further down will queue one.
  {
    const ownRaw = game._rawFoodFor(gid);
    const ownMeal = game.groups?.[gid]?.storage?.meal || 0;
    if (game._hearthsLitFor(gid) && ownRaw > 0 && ownMeal < MEAL_TARGET) {
      for (const h of game.hearths) {
        if (h.ownerId !== gid) continue;
        if (colonist.isUnreachable?.(h.x, h.y, game.clock)) continue;
        if (!game._tileClaimed(h.x, h.y)) {
          return createTask(TaskType.COOK, h.x, h.y);
        }
      }
    }
  }
  // 7. Hunt first when colony stores run low — done before infra and farm
  // work so colonists do not build themselves into starvation. Hunting
  // adds to on-hand, so it is skipped while on-hand is already at cap.
  if (
    game.autoHunt &&
    !onHandFull &&
    game.totalFood < game.colonists.length * HUNT_FOOD_PER_HEAD
  ) {
    const a = game._animalNear(colonist.tileX, colonist.tileY, AUTO_HUNT_RANGE, colonist);
    if (a && !game._tileClaimed(a.tileX, a.tileY)) {
      return createTask(TaskType.HUNT, a.tileX, a.tileY, { animalId: a.id });
    }
  }
  // 8. Chop the nearest tree when wood reserve has fallen below the
  // threshold, so building does not grind to a halt.
  if (game.autoMode && game.storage.wood - game._reservedBuildWood() < WOOD_LOW) {
    const tree = game._nearestTree(colonist, AUTO_SEARCH_RANGE);
    if (tree) return createTask(TaskType.HARVEST, tree.x, tree.y);
  }
  // 9. Stand up infrastructure before opening more farmland. The single
  // helper urgentInfraBuild() collects the per-group hut → hearth →
  // warehouse logic so every script (balanced/farmer/scout/farmer_breed)
  // shares one source of truth (H4).
  if (game.autoMode) {
    const infra = urgentInfraBuild(game, colonist);
    if (infra) return infra;
    // 10. Till new ground and sow the most-stocked crop.
    const sowCrop = game._mostStockedCrop(colonist.groupId);
    if (sowCrop) {
      const sowSpot = game._pickAutoSowSpot(colonist);
      if (sowSpot) {
        return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
      }
      const tillSpot = game._pickTillSpot(colonist, sowCrop);
      if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
    }
  }
  // 11. Haul surplus on-hand food into a stockpile, safe from the pests.
  if (game.onHandFood > ON_HAND_CAP) {
    const sp = game._nearestOwnStockpile(colonist, (s) => game.stockpileFood(s) < (s.cap || STOCKPILE_CAP));
    if (sp && !game._tileClaimed(sp.x, sp.y)) {
      return createTask(TaskType.STORE, sp.x, sp.y);
    }
  }
  return null;
}

// --- Script variants (alpha 23) -----------------------------------------
//
// Each colony group picks an autonomy "script" at setup. The script is
// the decision function called for every idle colonist in that group.
// 'balanced' is the default (the function above). 'farmer' shifts the
// priorities so sowing / tilling beats hunting and fence-building, so
// a farming-focused group will turn its share of the map into farmland
// even when a boar is around. 'scout' does the opposite — it leans
// into hunting and exploration, and only builds infrastructure once
// the food supply is comfortable.

/** "Farmer" — sow / till / cook before fencing or hunting. */
export function farmerScript(game, colonist) {
  // Same chores in the front (harvest / water / weed) — those are
  // colony-critical regardless of personality. E3 filters by ownership
  // so a Farmer-type colonist doesn't snipe a Balanced colony's crops.
  const gid = colonist.groupId;
  for (const crop of game.crops) {
    if (crop.ownerId != null && crop.ownerId !== gid) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  // H4: build essential infra before settling into the sow / till loop.
  const infra = urgentInfraBuild(game, colonist);
  if (infra) return infra;
  // Skip fence-building entirely — let the balanced colonists handle it.
  // H2: own-group cook check (raw + meal + hearth).
  {
    const ownRaw = game._rawFoodFor(gid);
    const ownMeal = game.groups?.[gid]?.storage?.meal || 0;
    if (game._hearthsLitFor(gid) && ownRaw > 0 && ownMeal < MEAL_TARGET) {
      for (const h of game.hearths) {
        if (h.ownerId !== gid) continue;
        if (colonist.isUnreachable?.(h.x, h.y, game.clock)) continue;
        if (!game._tileClaimed(h.x, h.y)) return createTask(TaskType.COOK, h.x, h.y);
      }
    }
  }
  // Farmer-priority: sow + till BEFORE worrying about hunting / huts.
  if (game.autoMode) {
    const sowCrop = game._mostStockedCrop(colonist.groupId);
    if (sowCrop) {
      const sowSpot = game._pickAutoSowSpot(colonist);
      if (sowSpot) {
        return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
      }
      const tillSpot = game._pickTillSpot(colonist, sowCrop);
      if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
    }
  }
  // Fall through to the balanced script for everything else (hunting,
  // tree-chopping, infrastructure, hauling).
  return pickAutonomousTask(game, colonist);
}

/** "Scout" — hunt + chop wood early, build last. */
export function scoutScript(game, colonist) {
  const gid = colonist.groupId;
  for (const crop of game.crops) {
    if (crop.ownerId != null && crop.ownerId !== gid) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  // H4: scout never auto-builds in its specialty (hunt/chop always finds
  // work), so the own-colony infra check has to fire here too. Without
  // this, a scout colony lives outdoors permanently.
  const infra = urgentInfraBuild(game, colonist);
  if (infra) return infra;
  // Hunt is the lead activity — even before food gets low.
  if (game.autoHunt) {
    const a = game._animalNear(colonist.tileX, colonist.tileY, AUTO_HUNT_RANGE, colonist);
    if (a && !game._tileClaimed(a.tileX, a.tileY)) {
      return createTask(TaskType.HUNT, a.tileX, a.tileY, { animalId: a.id });
    }
  }
  // Auto-chop trees aggressively so wood is plentiful.
  if (game.autoMode) {
    const tree = game._nearestTree(colonist, AUTO_SEARCH_RANGE);
    if (tree) return createTask(TaskType.HARVEST, tree.x, tree.y);
  }
  // Fall through to balanced for the rest.
  return pickAutonomousTask(game, colonist);
}

// --- α26: Farmer (Selective breeding) -----------------------------------
//
// A variant of the farmer that:
//   1. lays its field out as a contiguous rectangle (no concern for water
//      proximity — fertility/moisture become the player's irrigation
//      problem), so the colony's farmland stays orderly,
//   2. once per season, queues a small cull pass against the lowest-
//      quality 15% of each crop type. The cull runs as WEED tasks (which
//      already accept living crops as a deliberate scrap). The food-safety
//      guard skips the cull when the colony is starving.
//
// The rectangular layout lives on each group as `fieldPlan`. The cull
// state lives as `lastCullSeason`. Both are reset by createGroup.

const FIELD_INIT_W = 6;
const FIELD_INIT_H = 6;
const FIELD_MAX_W = 14;
const FIELD_MAX_H = 14;
const CULL_FRACTION = 0.15; // bottom 15% per crop type
const CULL_FOOD_SAFETY_MULT = 0.6; // skip cull if food/head < 60% of birth threshold

function fieldPlanFor(game, colonist) {
  const grp = game.groups?.[colonist.groupId];
  if (!grp) return null;
  if (!grp.fieldPlan) {
    // α25 follow-up (C1): anchor the field to the group's spawn cluster
    // (set in Game.newMap) so every colonist in the group works the
    // same patch of land. Falls back to the calling colonist's tile
    // when the anchor isn't available (legacy save / mid-test mutate).
    const anchor = grp.spawnAnchor || { x: colonist.tileX, y: colonist.tileY };
    const fx = Math.max(0, Math.min(game.map.cols - FIELD_INIT_W, anchor.x - Math.floor(FIELD_INIT_W / 2)));
    const fy = Math.max(0, Math.min(game.map.rows - FIELD_INIT_H, anchor.y + 1));
    grp.fieldPlan = { x: fx, y: fy, w: FIELD_INIT_W, h: FIELD_INIT_H };
  }
  return grp.fieldPlan;
}

function pickRectSowSpot(game, colonist) {
  const plan = fieldPlanFor(game, colonist);
  if (!plan) return null;
  const gid = colonist.groupId;
  for (let dy = 0; dy < plan.h; dy++) {
    for (let dx = 0; dx < plan.w; dx++) {
      const x = plan.x + dx;
      const y = plan.y + dy;
      const t = game.map.tiles[y]?.[x];
      if (!t || !t.tilled || t.plant || t.structure) continue;
      if (t.tilledBy != null && t.tilledBy !== gid) continue;
      if (game._tileClaimed(x, y)) continue;
      if (colonist.isUnreachable?.(x, y, game.clock)) continue;
      return { x, y };
    }
  }
  return null;
}

function pickRectTillSpot(game, colonist) {
  const plan = fieldPlanFor(game, colonist);
  if (!plan) return null;
  for (let dy = 0; dy < plan.h; dy++) {
    for (let dx = 0; dx < plan.w; dx++) {
      const x = plan.x + dx;
      const y = plan.y + dy;
      const t = game.map.tiles[y]?.[x];
      if (!t || t.type === TileType.WATER) continue;
      if (t.tilled || t.plant || t.structure) continue;
      if (game._tileClaimed(x, y)) continue;
      if (colonist.isUnreachable?.(x, y, game.clock)) continue;
      return { x, y };
    }
  }
  // Whole rectangle exhausted — grow the plan by one in each direction.
  if (plan.w < FIELD_MAX_W) plan.w += 1;
  if (plan.h < FIELD_MAX_H) plan.h += 1;
  return null;
}

/** "Farmer (Selective breeding)" — rectangular fields + quarterly cull. */
export function farmerBreedScript(game, colonist) {
  // Always harvest the ripe ones first — breeding programme depends on
  // collecting the high-quality seeds back from these. E3 enforces that
  // a breed colony only ever picks its own crops (the whole point of
  // the breed script is the genome stays inside the group).
  const gid = colonist.groupId;
  for (const crop of game.crops) {
    if (crop.ownerId != null && crop.ownerId !== gid) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  // Critical warehouse pivot — even a breeding-focused colony can't keep
  // sowing if the harvest has nowhere to land. Uses the same script-level
  // helper as the balanced/farmer scripts so the threshold stays in sync.
  // G1: per-group critical check.
  const critical = game._warehousesCriticalFor?.(colonist.groupId) || false;
  if (critical && game.autoMode) {
    const dec = wantsWarehouse(game, colonist, { utilThreshold: 0.95 });
    if (dec && dec.build) {
      return createTask(TaskType.BUILD, dec.spot.x, dec.spot.y, { structure: dec.build });
    }
  }
  // H4: breed colony lives in its rectangular farmland — without this
  // urgent-infra check it would happily sow forever and never raise a
  // hut. Fires the same hut → hearth → warehouse ladder as balanced.
  const infra = urgentInfraBuild(game, colonist);
  if (infra) return infra;
  // H2: own-group cook check.
  {
    const ownRaw = game._rawFoodFor(gid);
    const ownMeal = game.groups?.[gid]?.storage?.meal || 0;
    if (game._hearthsLitFor(gid) && ownRaw > 0 && ownMeal < MEAL_TARGET) {
      for (const h of game.hearths) {
        if (h.ownerId !== gid) continue;
        if (colonist.isUnreachable?.(h.x, h.y, game.clock)) continue;
        if (!game._tileClaimed(h.x, h.y)) return createTask(TaskType.COOK, h.x, h.y);
      }
    }
  }
  // Sow / till the rectangular field BEFORE looking at any other work.
  if (game.autoMode) {
    const sowCrop = game._mostStockedCrop(colonist.groupId);
    if (sowCrop) {
      const sowSpot = pickRectSowSpot(game, colonist);
      if (sowSpot) return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
      const tillSpot = pickRectTillSpot(game, colonist);
      if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
    }
  }
  return pickAutonomousTask(game, colonist);
}

/**
 * Quarterly cull pass. Called from eventSystem.onSeasonChange — for each
 * group running the breeding script, queue WEED tasks against the
 * bottom CULL_FRACTION (by genome quality) of every crop type that
 * group's colonists are growing. Skips the cull when food is critically
 * short (so we don't starve the colony to chase ★).
 */
export function runSelectiveBreedingCulls(game) {
  if (!game.groups) return;
  const seasonKey = `${game.environment.year}-${game.environment.season}`;
  const foodPerHead = game.colonists.length > 0
    ? game.totalFood / game.colonists.length
    : 0;
  const foodSafe = foodPerHead >= BIRTH_FOOD_PER_HEAD * CULL_FOOD_SAFETY_MULT;
  for (const grp of game.groups) {
    if (grp.scriptId !== 'farmer_breed') continue;
    if (grp.lastCullSeason === seasonKey) continue;
    grp.lastCullSeason = seasonKey;
    if (!foodSafe) {
      // Tell the player we deliberately skipped the cull this quarter,
      // and quote the threshold so they know how close we were.
      const need = (BIRTH_FOOD_PER_HEAD * CULL_FOOD_SAFETY_MULT).toFixed(1);
      game._pushLog({
        icon: '⏭',
        text: t('log.cullSkipped', {
          have: foodPerHead.toFixed(1),
          need,
        }),
        cls: 'log-warn',
        groupId: grp.id,
      });
      continue;
    }
    // Bucket every living crop in this group's field by cropId.
    const plan = grp.fieldPlan;
    const inField = (x, y) => plan
      && x >= plan.x && x < plan.x + plan.w
      && y >= plan.y && y < plan.y + plan.h;
    const buckets = new Map();
    for (const crop of game.crops) {
      if (crop.withered) continue;
      if (plan && !inField(crop.x, crop.y)) continue;
      if (!buckets.has(crop.cropId)) buckets.set(crop.cropId, []);
      buckets.get(crop.cropId).push(crop);
    }
    for (const [cropId, list] of buckets) {
      if (list.length < 5) continue; // too few to learn anything from culling
      list.sort((a, b) => genomeQuality(a.genome) - genomeQuality(b.genome));
      const cullCount = Math.max(1, Math.floor(list.length * CULL_FRACTION));
      let queued = 0;
      for (let i = 0; i < cullCount; i++) {
        const c = list[i];
        if (game._tileClaimed(c.x, c.y)) continue;
        game.taskQueue.push(createTask(TaskType.WEED, c.x, c.y));
        queued += 1;
      }
      if (queued > 0) {
        game._pushLog({
          icon: '🌱',
          text: t('log.cull', { crop: t('crop.' + cropId), n: queued }),
          cls: 'log-ok',
          groupId: grp.id,
        });
      }
    }
  }
}

// Register every script so groups can look them up by id.
registerScript('balanced', pickAutonomousTask);
registerScript('farmer', farmerScript);
registerScript('farmer_breed', farmerBreedScript);
registerScript('scout', scoutScript);
