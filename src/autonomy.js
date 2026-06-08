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
import { isRipe, CROP_IDS, cropSuitability, getCrop } from './crops.js';
import { tileBlocksCrop } from './systems/cropSystem.js';
import {
  ON_HAND_LOW,
  ON_HAND_CAP,
  MEAL_TARGET,
  HUNT_FOOD_PER_HEAD,
  AUTO_HUNT_RANGE,
  AUTO_SEARCH_RANGE,
  FENCE_AUTO_CAP,
  FENCE_AUTO_CAP_BUILDER,
  STOCKPILE_CAP,
  WOOD_LOW,
  HUT_CAPACITY_BY_TYPE,
  BIRTH_FOOD_PER_HEAD,
  BUILD_COSTS,
  SEED_VARIETY_TARGET,
} from './config.js';
import { registerScript } from './groups.js';
import { t } from './i18n.js';
import { TileType } from './map/tile.js';
import { genomeQuality } from './genetics.js';
import { pickBestAffordable as recipesPickBestAffordable } from './recipes.js';

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

const WAREHOUSE_HARD_CAP = Infinity; // no colony-wide cap on warehouse count
// α29 followup: target hearth count = ceil(pop / HEARTH_POP_RATIO),
// floor 1. One hearth comfortably feeds and warms ~4 colonists; a
// larger group queues a second / third hearth as it grows.
const HEARTH_POP_RATIO = 4;
// α31 followup: workshop auto-build is GATED per-script. Manual late-
// placement headless trial showed farmer_breed +18, farmer +9,
// builder +7 alive; scout +0 (opts out). But pop alone isn't a strong
// enough gate — auto-build keeps firing as soon as pop hits the
// threshold and bleeds resources. So we also require sustained meal
// surplus (>= MEAL_SURPLUS_TARGET, see below) AND a wood reserve, so
// auto-build only fires when the colony is GENUINELY established.
// α31 followup: every script except scout auto-builds a workshop. The
// auto-build trigger is per-script — scripts whose manual late-placement
// trial showed a clear survival gain (farmer_breed +18, builder +7,
// farmer +9) build it sooner; scripts whose gain was smaller (temperate
// +3, balanced +1) require a much more established colony first. Scout
// opts out entirely because its hunting + immediate-eat loop never piles
// up surplus crops worth preserving.
//
// All conditions must be met for auto-build:
//   - colonist population at or above the per-script pop gate
//   - own meal stock at or above WORKSHOP_MEAL_SURPLUS (BY_SCRIPT)
//   - own wood reserve at or above WORKSHOP_WOOD_RESERVE_BY_SCRIPT
//   - at least one hearth and one warehouse already up (set in caller)
// This three-way gate means the workshop only fires when the colony is
// genuinely beyond subsistence — never as a knee-jerk pop-threshold
// trigger that drained colonies in earlier iterations.
// α31 followup: per-script gates are tuned by empirical timing trial —
// manually placing a workshop at Y2 / Y5 / Y8 / Y12 across 4 seeds × 3
// repeats showed each script has a different sweet spot. EARLY building
// is universally bad (balanced Y2 Δ-5.7, builder Y2 Δ-6.5); late timing
// is best for builder and scout (Y12 Δ+0.9 and Δ+3.6). Gate thresholds
// are calibrated to pop levels that typically correspond to each
// script's best timing in the test data.
const WORKSHOP_POP_GATE_BY_SCRIPT = {
  farmer_breed:  6,   // Y2 best — eager (lots of surplus from selective breeding)
  farmer:       10,   // Y5 best — mid-game
  temperate:    10,   // Y5 best — diverse crops mature mid-game
  balanced:     12,   // Y8 best — mid-late, needs colony establishment first
  scout:        18,   // Y12 best — late! Foraged stock + accumulated raw food
  builder:      18,   // Y12 best — built-out infra ready to use workshop
};
const WORKSHOP_MEAL_SURPLUS_BY_SCRIPT = {
  farmer_breed: 10,
  farmer:       14,
  temperate:    14,
  balanced:     16,
  scout:        18,
  builder:      18,
};
const WORKSHOP_WOOD_RESERVE_BY_SCRIPT = {
  farmer_breed: 24,
  farmer:       30,
  temperate:    30,
  balanced:     32,
  scout:        35,
  builder:      35,
};
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
      icon: 'warn',
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
export function wantsWarehouse(game, colonist, { utilThreshold = 0.85, oneInFlight = true } = {}) {
  const gid = colonist.groupId;
  const totalSp = game.stockpiles.length + game._pendingBuilds('stockpile')
    + game._pendingBuilds('stockpile_med') + game._pendingBuilds('stockpile_large');
  if (totalSp >= WAREHOUSE_HARD_CAP) return null;
  // E1+ : default gate — never queue another warehouse for this group
  // while one is already pending/in-flight. The critical (≥0.95) branch
  // explicitly opts out (oneInFlight:false) so a colony in genuine
  // capacity crisis can still spin up several at once.
  if (oneInFlight && autoWarehousePending(game, gid) > 0) return null;
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
// N2: task.groupId is set at enqueue time. Older / hand-built tasks
// without groupId fall back to looking up the assignee's group.
function taskBelongsTo(game, task, gid) {
  if (gid == null) return true; // colony-wide caller
  if (task.groupId != null) return task.groupId === gid;
  if (task.assignee) {
    const c = game.colonists.find((cc) => cc.name === task.assignee);
    return !!c && c.groupId === gid;
  }
  return false;
}

function autoHutPendingBeds(game, gid) {
  let n = 0;
  for (const t of game.taskQueue) {
    if (t.type !== TaskType.BUILD || !HUT_CAPACITY_BY_TYPE[t.structure]) continue;
    if (!taskBelongsTo(game, t, gid)) continue;
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

/** E1+ : warehouse builds in flight that belong to `gid` (queued or in
 * a colonist's hands). Used to stop a group from spawning N warehouses
 * at once when many colonists hit on-hand-full on the same tick. */
function autoWarehousePending(game, gid) {
  const isWh = (s) => s === 'stockpile' || s === 'stockpile_med' || s === 'stockpile_large';
  let n = 0;
  for (const t of game.taskQueue) {
    if (t.type !== TaskType.BUILD || !isWh(t.structure)) continue;
    if (!taskBelongsTo(game, t, gid)) continue;
    n++;
  }
  for (const c of game.colonists) {
    const ct = c.currentTask;
    if (!ct || ct.type !== TaskType.BUILD || !isWh(ct.structure)) continue;
    if (gid != null && c.groupId !== gid) continue;
    n++;
  }
  return n;
}

/** Hearth builds in flight that belong to `gid`. */
function autoHearthPending(game, gid) {
  let n = 0;
  for (const t of game.taskQueue) {
    if (t.type !== TaskType.BUILD || t.structure !== 'hearth') continue;
    if (!taskBelongsTo(game, t, gid)) continue;
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

/** α31: workshop builds in flight that belong to `gid`. */
function autoWorkshopPending(game, gid) {
  let n = 0;
  for (const t of game.taskQueue) {
    if (t.type !== TaskType.BUILD || t.structure !== 'workshop') continue;
    if (!taskBelongsTo(game, t, gid)) continue;
    n++;
  }
  for (const c of game.colonists) {
    const ct = c.currentTask;
    if (!ct || ct.type !== TaskType.BUILD || ct.structure !== 'workshop') continue;
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
 * Balanced-script emergency farming: when this colony has zero food in
 * storage AND fewer than 2 own-group living crops, queue sow/till
 * immediately so the colonist does not waste its first season on hunt
 * → chop → infra while seeds rot in the bag.
 *
 * Returns a SOW or TILL task, or null when the situation is not
 * critical (food on hand, crops already growing, no seeds, no spot).
 *
 * @param {object} game
 * @param {object} colonist
 * @returns {?object}
 */
function _balancedEmergencyFarm(game, colonist) {
  const gid = colonist.groupId;
  const ownPop = game.groups?.[gid]?.colonists?.length || 0;
  if (ownPop === 0) return null;
  // Light pivot: only fire while the colony literally has no food and no
  // crops in the ground. A too-sticky threshold blocks the colonist from
  // chopping wood / building huts, which on a cold seed kills them
  // faster than a thin field would. Once either condition is satisfied,
  // normal priorities resume (hunt/chop/infra/till+sow).
  const ownFood = game._totalFoodFor(gid);
  if (ownFood > 0) return null;
  let ownAlive = 0;
  for (const crop of game.crops) {
    if (crop.ownerId !== gid) continue;
    if (crop.withered) continue;
    ownAlive++;
    if (ownAlive >= ownPop) return null;
  }
  const sowCrop = game._mostStockedCrop(gid);
  if (!sowCrop) return null;
  const sowSpot = game._pickAutoSowSpot(colonist, sowCrop);
  if (sowSpot) {
    return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
  }
  const tillSpot = game._pickTillSpot(colonist, sowCrop);
  if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
  return null;
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
  // 2. Hearth — α29 followup: gate by colonist headcount instead of hut
  // count. Hut variants come in three capacities (1 / 4 / 8); one
  // hut_large that sleeps eight previously only earned its colony a
  // single hearth, while eight tiny huts triggered eight hearths even
  // for one family each. Now every script targets ~one hearth per
  // HEARTH_POP_RATIO colonists (4), with a floor of 1.
  const hearthTarget = Math.max(1, Math.ceil(ownPop / HEARTH_POP_RATIO));
  const ownHearths = game._hearthCountFor(gid) + autoHearthPending(game, gid);
  if (ownHearths < hearthTarget && game._canAffordBuild('hearth')) {
    const spot = game._findFreeLandNear(colonist);
    if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'hearth' });
  }
  // 2b. α31 followup: workshop auto-build is now SCRIPT-AWARE. Empirical
  // headless run (8 seeds × 6 scripts, workshop placed late vs never):
  //   builder       +7 alive   (infra-heavy, fits naturally)
  //   farmer_breed  +18 alive  (selective-breeding produces surplus)
  //   farmer        +9 alive   (sow-heavy → harvest surplus)
  //   temperate     +3 alive
  //   balanced      +1 alive   (small benefit only)
  //   scout         +0 alive   (hunting + fast-food, no surplus)
  //
  // So each script declares its own readiness threshold via
  // WORKSHOP_POP_GATE_BY_SCRIPT. Scout opts out entirely (returns
  // Infinity), balanced is very conservative (10), farmer/temperate
  // moderate (8), builder/farmer_breed eager (6). Workshop also waits
  // for the colony to have a warehouse so excess raw food has somewhere
  // to wait until it's processed.
  const grpForWS = game.groups?.[gid];
  const wsScriptId = grpForWS?.scriptId || 'balanced';
  const popGate = WORKSHOP_POP_GATE_BY_SCRIPT[wsScriptId] ?? Infinity;
  const ownWorkshops = (game.workshops || []).filter((w) => w.ownerId === gid).length;
  const ownWorkshopsPending = autoWorkshopPending(game, gid);
  const ownStockpiles = game._stockpileCountFor(gid);
  // Extra gate: colony's food situation must be HEALTHY (meals stocked
  // at or above target, wood reserve for hearth fuel). Otherwise the
  // workshop build diverts wood + colonist time from immediate survival
  // — manual headless trials showed early auto-build (right when pop
  // hits the gate) is worse than no workshop. Waiting until the colony
  // has actual surplus aligns the build with the late-placement
  // condition that showed gains in trials.
  // α31 followup: count meals across on-hand AND own warehouses.
  // grp.storage.meal alone barely passes 6 (the hearth-cook target) —
  // colonists eat it as fast as it's cooked. The colony's REAL meal
  // reserve sits in the warehouses they've hauled into. Diagnostic
  // run showed temperate maxed at meal=2 on-hand across 1271 samples
  // — workshop gate never fired with that measure, even when meal
  // stocks across warehouses were comfortable.
  let ownMeals = grpForWS?.storage?.meal || 0;
  for (const sp of game.stockpiles || []) {
    if (sp.ownerId !== gid) continue;
    ownMeals += sp.items?.meal || 0;
  }
  const ownWood = grpForWS?.storage?.wood || 0;
  const mealGate = WORKSHOP_MEAL_SURPLUS_BY_SCRIPT[wsScriptId] ?? Infinity;
  const woodGate = WORKSHOP_WOOD_RESERVE_BY_SCRIPT[wsScriptId] ?? Infinity;
  if (
    ownPop >= popGate
    && ownHearths >= 1
    && ownStockpiles >= 1
    && ownMeals >= mealGate
    && ownWood >= woodGate
    && ownWorkshops + ownWorkshopsPending < 1
    && game._canAffordBuild('workshop')
  ) {
    const spot = game._findFreeLandNear(colonist);
    if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'workshop' });
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
    // Critical (≥95% util): opt out of the one-in-flight gate so the
    // colony can rush several warehouses in parallel.
    const dec = wantsWarehouse(game, colonist, { utilThreshold: 0.95, oneInFlight: false });
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
    // E1: include "unclaimed" in the predicate so we walk past piles
    // another colonist already targets and pick the next-nearest pile
    // that ACTUALLY has space. Without this, a single claim on the
    // nearest pile flipped this whole branch to "build another
    // warehouse", spawning huge over-built warehouse rows even at <5%
    // utilisation.
    const sp = game._nearestOwnStockpile(colonist, (s) =>
      game.stockpileFood(s) < (s.cap || STOCKPILE_CAP)
      && !game._tileClaimed(s.x, s.y));
    if (sp) {
      return createTask(TaskType.STORE, sp.x, sp.y);
    }
    // D3: no warehouse can accept this haul → treat the situation like
    // a warehouse shortage and pivot to building one (or chopping wood
    // for it). Falls through to non-additive chores only if even that
    // is blocked, so colonists never sit idle while their pockets are
    // full and food is rotting.
    // E1+ : the "one in-flight per group" gate now lives inside
    // wantsWarehouse (default oneInFlight:true), so this call already
    // returns null when a warehouse is already being built — N hungry
    // colonists on the same tick can't each queue their own BUILD.
    if (game.autoMode) {
      // E1++ : threshold was 0 ("any unclaimed-pile shortage → build")
      // which over-built at low utilisation when peers momentarily
      // claimed every pile. 0.3 means transient claim collisions at
      // very low fill just wait one tick, while sustained on-hand
      // pressure (which is what actually rots food) still triggers a
      // build. 0.6 was too tight and starved the colony. The ≥0.95
      // critical branch is the real emergency net above this.
      const dec = wantsWarehouse(game, colonist, { utilThreshold: 0.3 });
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
  // E3 / N4 helper: only auto-tend a crop the colonist is allowed to
  // touch. Own-group crops always qualify; foreign crops only when the
  // share-flag for that owner is on. Old crops without ownerId are
  // treated as colony-wide (= anyone may help).
  const gid = colonist.groupId;
  const ownsCrop = (crop) => game._canUseFrom(gid, crop.ownerId);
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
  // E1: include "unclaimed" + "reachable" in the predicate so a single
  // claim on the nearest non-empty pile doesn't leave the colonist
  // sitting idle when the next-nearest pile is fine.
  if (game.onHandFood < ON_HAND_LOW) {
    const sp = game._nearestOwnStockpile(colonist, (s) =>
      game.stockpileFood(s) > 0
      && !game._tileClaimed(s.x, s.y)
      && reachable(s.x, s.y));
    if (sp) {
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
  // C9: chase seed variety. When this colony holds fewer than
  // SEED_VARIETY_TARGET distinct seed types, go forage a wild plant for
  // new stock even if the pantry is full — wild harvests drop ancestor
  // seeds, which is the only way a low-variety colony broadens its
  // breeding base. Deliberately NOT gated by onHandFull (variety beats
  // another bushel of food).
  if (game.autoMode && game._seedVarietyFor(gid) < SEED_VARIETY_TARGET) {
    const wild = game._nearestWildPlant(colonist, AUTO_SEARCH_RANGE);
    if (wild && !game._tileClaimed(wild.x, wild.y) && reachable(wild.x, wild.y)) {
      return createTask(TaskType.HARVEST, wild.x, wild.y);
    }
  }
  // 4b. Balanced-only emergency farming: when this colony has no food in
  // store AND essentially no own crops growing, jump straight to sow/till
  // instead of letting the colonist chase hunt → chop → infra. Without
  // this, a fresh balanced colony spends its starter wood on huts and
  // hearths while its seed packets sit idle, and starves before any crop
  // ripens. Scope is intentionally narrow (scriptId === 'balanced') so
  // scout stays disadvantaged on purpose — a scout colony is supposed
  // to learn that hunting alone is unreliable.
  if (game.autoMode && game.groups?.[gid]?.scriptId === 'balanced') {
    const em = _balancedEmergencyFarm(game, colonist);
    if (em) return em;
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
    // 6. Hearth-cook FIRST. α31 first-try put workshops ahead of
    // hearth-cook so brewing-only ingredients (hop) wouldn't get
    // burnt into survival meals before the workshop fired. But a
    // colony in early game uses most of its raw stock to feed
    // itself, and the workshop's preservation recipes are net food
    // negative (cabbage:3 → sauerkraut:3 is neutral, but berry:3 →
    // jam:2, melon:3 → driedMelon:2, soybean:3 → soyOil:1 all lose
    // food). With workshops running ahead of hearth-cook the
    // colony bled food into preserves and intermediates and starved
    // — single-colony survival dropped from ~6/8 to 0/8 across most
    // scripts. Hearth-cook (which actually produces eatable meals
    // toward MEAL_TARGET) now wins; workshops fire only AFTER the
    // colony's meal stock is healthy.
    if (game._hearthsLitFor(gid) && ownRaw > 0 && ownMeal < MEAL_TARGET) {
      for (const h of game.hearths) {
        if (!game._canUseFrom(gid, h.ownerId)) continue;
        if (colonist.isUnreachable?.(h.x, h.y, game.clock)) continue;
        if (!game._tileClaimed(h.x, h.y)) {
          return createTask(TaskType.COOK, h.x, h.y);
        }
      }
    }
    // 6b. α31 (revised): workshop processing fires AFTER hearth-cook,
    // and is itself gated by meal sufficiency — preserves are nice
    // but they're a luxury until basic food is stocked. The exception
    // is workshop-only inputs (hop): if the colony has those, fire
    // the workshop regardless of meal stock because the hearth would
    // never use them and they'd otherwise sit idle. Inventory check
    // spans on-hand + every own-group stockpile so the workshop
    // fires even when the colonist has already STOREd its inputs
    // into a warehouse.
    const ownGrp = game.groups?.[gid];
    const ownWorkshops = (game.workshops || []).filter((w) => game._canUseFrom(gid, w.ownerId));
    if (ownWorkshops.length > 0 && ownGrp) {
      const ownPiles = (game.stockpiles || []).filter((sp) => sp.ownerId === gid);
      const getQty = (k) => {
        let n = ownGrp.storage[k] || 0;
        for (const sp of ownPiles) n += sp.items[k] || 0;
        return n;
      };
      const recipe = recipesPickBestAffordable(ownGrp.storage, getQty, 'workshop');
      if (recipe) {
        // Gate: meal stock comfortably above the basic target — OR —
        // the recipe's ingredients include a workshop-only input that
        // the hearth can't process anyway (hop, etc.). The combined
        // (on-hand + own-warehouse) count is used so the cook fires
        // when the colony is genuinely food-secure, not just when
        // on-hand has been topped up by a recent FETCH.
        let combinedMeal = ownMeal;
        for (const sp of ownPiles) combinedMeal += sp.items?.meal || 0;
        const usesWorkshopOnly = Object.keys(recipe.ingredients).some(
          (id) => game._isWorkshopOnlyInput?.(id),
        );
        if (combinedMeal >= MEAL_TARGET * 2 || usesWorkshopOnly) {
          for (const w of ownWorkshops) {
            if (colonist.isUnreachable?.(w.x, w.y, game.clock)) continue;
            if (!game._tileClaimed(w.x, w.y)) {
              return createTask(TaskType.COOK, w.x, w.y);
            }
          }
        }
      }
    }
  }
  // 7a. α34 followup: FISH whenever there's a catchable water tile
  // nearby. The previous "only when food is low" gate almost never
  // fired in survival tests because by the time food/head dropped
  // below the hunt threshold, the colony was already in a death
  // spiral. Instead we treat the shoreline as a standing opportunity:
  // if water with a catch is within AUTO_HUNT_RANGE and the
  // colonist's on-hand isn't already full, go fish. Other priorities
  // (harvest / sow / cook) still run before this branch, so fishing
  // never starves the farm or the kitchen.
  if (game.autoHunt && !onHandFull) {
    const sf = game._nearestSeafoodFor?.(colonist, AUTO_HUNT_RANGE);
    if (sf && !game._tileClaimed(sf.x, sf.y)) {
      return createTask(TaskType.FISH, sf.x, sf.y);
    }
  }
  // 7b. Hunt next when this colony's own stores run low (I2). Done
  // before infra and farm work so colonists don't build themselves
  // into starvation. The food/head check is per-group — a Colony C
  // sitting on 4.8 food/head no longer gets masked by Colony B's
  // surplus pushing the colony-wide average up. Hunting still skips
  // while on-hand is at cap (it adds to it).
  if (game.autoHunt && !onHandFull) {
    const ownPop = game.groups?.[gid]?.colonists?.length || game.colonists.length;
    const ownFood = game._totalFoodFor(gid);
    if (ownFood < ownPop * HUNT_FOOD_PER_HEAD) {
      const a = game._animalNear(colonist.tileX, colonist.tileY, AUTO_HUNT_RANGE, colonist);
      if (a && !game._tileClaimed(a.tileX, a.tileY)) {
        return createTask(TaskType.HUNT, a.tileX, a.tileY, { animalId: a.id });
      }
    }
  }
  // 8. Chop the nearest tree when wood reserve has fallen below the
  // threshold, so building (and cooking — hearths burn their own
  // group's wood) does not grind to a halt.
  // E3 (alpha 29 followup): the check used to be colony-wide
  // (`game.storage.wood`). With per-group ownership, one rich group
  // masked the shortage of every other — a colony with zero own wood
  // never went to chop while its hearth went cold, and the colonists
  // starved with a stockpile full of grain they could not cook. Now
  // each colonist looks at THEIR OWN group's wood.
  if (game.autoMode) {
    const ownGrp = game.groups?.[gid];
    const ownWood = ownGrp?.storage?.wood || 0;
    // α30 followup: chop trigger now factors in three demand drivers,
    // not just hearth count. The earlier formula (constant + hearths × 3)
    // ignored population (more colonists = more cook tasks = more lit
    // hearth time) and season (winter burns more wood for warmth on top
    // of cooking). Manual-play tests showed colonies of 4-9 surviving
    // food crises only to freeze to death in autumn/winter once the
    // wood ran out. The new buffers keep autumn/winter reserves ahead
    // of demand.
    const ownHearths = game._hearthCountFor(gid);
    const ownPop = ownGrp?.colonists?.length || 0;
    const season = game.environment?.season;
    const hearthBuf = Math.ceil(ownHearths * WOOD_LOW / 2);
    const popBuf = Math.ceil(ownPop / 2);
    const seasonBuf = season === 'winter' ? WOOD_LOW
      : season === 'autumn' ? Math.ceil(WOOD_LOW / 2)
        : 0;
    const woodLow = Math.max(WOOD_LOW, WOOD_LOW + hearthBuf + popBuf + seasonBuf);
    if (ownWood < woodLow) {
      const tree = game._nearestTree(colonist, AUTO_SEARCH_RANGE);
      if (tree) return createTask(TaskType.HARVEST, tree.x, tree.y);
    }
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
      const sowSpot = game._pickAutoSowSpot(colonist, sowCrop);
      if (sowSpot) {
        return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
      }
      const tillSpot = game._pickTillSpot(colonist, sowCrop);
      if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
    }
  }
  // 11. Haul surplus on-hand food into a stockpile, safe from the pests.
  // E1: same "nearest unclaimed with space" fix as the onHandFull pivot.
  if (game.onHandFood > ON_HAND_CAP) {
    const sp = game._nearestOwnStockpile(colonist, (s) =>
      game.stockpileFood(s) < (s.cap || STOCKPILE_CAP)
      && !game._tileClaimed(s.x, s.y));
    if (sp) {
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
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  // K1: clear withered own crops so the field doesn't fill up with dead
  // plots the farmer's sow loop can't reuse.
  for (const crop of game.crops) {
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.WEED, crop.x, crop.y);
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
        if (!game._canUseFrom(gid, h.ownerId)) continue;
        if (colonist.isUnreachable?.(h.x, h.y, game.clock)) continue;
        if (!game._tileClaimed(h.x, h.y)) return createTask(TaskType.COOK, h.x, h.y);
      }
    }
  }
  // Farmer-priority: sow + till BEFORE worrying about hunting / huts.
  if (game.autoMode) {
    const sowCrop = game._mostStockedCrop(colonist.groupId);
    if (sowCrop) {
      const sowSpot = game._pickAutoSowSpot(colonist, sowCrop);
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
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  // K1: clear withered own crops even on a hunt-focused colony.
  for (const crop of game.crops) {
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.WEED, crop.x, crop.y);
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
  // α27: scout also forages — wild plants drop forage + a 20% chance of
  // an ancestor seed, which keeps the breeding pipeline fed even without
  // farmland. Sits between hunt and chop so a scout colony's discovery
  // loop fires before it starts stripping the forest.
  if (game.autoMode) {
    const wild = game._nearestWildPlant(colonist, AUTO_SEARCH_RANGE);
    if (wild) return createTask(TaskType.HARVEST, wild.x, wild.y);
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

function pickRectSowSpot(game, colonist, cropId) {
  const plan = fieldPlanFor(game, colonist);
  if (!plan) return null;
  const gid = colonist.groupId;
  for (let dy = 0; dy < plan.h; dy++) {
    for (let dx = 0; dx < plan.w; dx++) {
      const x = plan.x + dx;
      const y = plan.y + dy;
      const t = game.map.tiles[y]?.[x];
      if (!t || !t.tilled || t.plant || t.structure) continue;
      if (!game._canUseFrom(gid, t.tilledBy)) continue;
      if (game._tileClaimed(x, y)) continue;
      if (colonist.isUnreachable?.(x, y, game.clock)) continue;
      if (tileBlocksCrop(t, cropId)) continue;
      return { x, y };
    }
  }
  return null;
}

function pickRectTillSpot(game, colonist, cropId) {
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
      if (tileBlocksCrop(t, cropId)) continue;
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
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  // K1: withered own crops get cleared before sowing the next batch —
  // the breeding programme is what feeds the rect plan, so dead plots
  // blocking sow spots have to go first.
  for (const crop of game.crops) {
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.WEED, crop.x, crop.y);
    }
  }
  // Critical warehouse pivot — even a breeding-focused colony can't keep
  // sowing if the harvest has nowhere to land. Uses the same script-level
  // helper as the balanced/farmer scripts so the threshold stays in sync.
  // G1: per-group critical check.
  const critical = game._warehousesCriticalFor?.(colonist.groupId) || false;
  if (critical && game.autoMode) {
    // Critical (≥95% util): opt out of the one-in-flight gate so the
    // colony can rush several warehouses in parallel.
    const dec = wantsWarehouse(game, colonist, { utilThreshold: 0.95, oneInFlight: false });
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
        if (!game._canUseFrom(gid, h.ownerId)) continue;
        if (colonist.isUnreachable?.(h.x, h.y, game.clock)) continue;
        if (!game._tileClaimed(h.x, h.y)) return createTask(TaskType.COOK, h.x, h.y);
      }
    }
  }
  // Sow / till the rectangular field BEFORE looking at any other work.
  if (game.autoMode) {
    const sowCrop = game._mostStockedCrop(colonist.groupId);
    if (sowCrop) {
      const sowSpot = pickRectSowSpot(game, colonist, sowCrop);
      if (sowSpot) return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
      const tillSpot = pickRectTillSpot(game, colonist, sowCrop);
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
        icon: 'skip',
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
        // N2: stamp the task with the breeding group's id so only its
        // own colonists pick it up.
        const task = createTask(TaskType.WEED, c.x, c.y);
        task.groupId = grp.id;
        game.taskQueue.push(task);
        queued += 1;
      }
      if (queued > 0) {
        game._pushLog({
          icon: 'sprout',
          text: t('log.cull', { crop: t('crop.' + cropId), n: queued }),
          cls: 'log-ok',
          groupId: grp.id,
        });
      }
    }
  }
}

// --- α28 new scripts ----------------------------------------------------
//
// Two new autonomy variants:
//
// `temperate` — Temperate specialist.
//   At sow time, only picks crops that score well on a "good temperate
//   land" template (mid-fertility, moderate moisture, full sun). The
//   set is precomputed at module load — wheat / barley / cabbage rank
//   high; tropical or drought-specific crops drop out.
//
// `builder` — Infrastructure-first.
//   After the standard hut → hearth → warehouse ladder, this script
//   keeps building: extra hearths above hut-count parity, a second /
//   third warehouse as soon as own utilisation passes 50 %. Falls back
//   to the balanced script once the build queue empties.

// Precompute the "temperate-friendly" crop set at module load. We score
// every catalogue entry against a synthetic mid-temperate tile and keep
// the top half by cropSuitability.
const _TEMPERATE_SYNTHETIC_TILE = { type: TileType.LAND, fertility: 0.65, moisture: 0.55, sunlight: 0.85 };
const _TEMPERATE_CROPS = (() => {
  const scored = [];
  for (const id of CROP_IDS) {
    if (id === 'wildgreens') continue;
    scored.push([id, cropSuitability(getCrop(id), _TEMPERATE_SYNTHETIC_TILE)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return new Set(scored.slice(0, Math.ceil(scored.length / 2)).map(([id]) => id));
})();

/** "Temperate specialist" — only auto-sows crops that fit temperate land. */
export function temperateScript(game, colonist) {
  const gid = colonist.groupId;
  // Same early steps as farmer.
  for (const crop of game.crops) {
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  for (const crop of game.crops) {
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.WEED, crop.x, crop.y);
    }
  }
  const infra = urgentInfraBuild(game, colonist);
  if (infra) return infra;
  // Sow / till — but only crops that survive a temperate climate well.
  if (game.autoMode) {
    // Pick the most-stocked crop ONLY from the temperate-friendly set.
    let sowCrop = null;
    let bestN = 0;
    for (const id of _TEMPERATE_CROPS) {
      const n = game.seedCount(id, gid);
      if (n > bestN) { bestN = n; sowCrop = id; }
    }
    if (sowCrop) {
      const sowSpot = game._pickAutoSowSpot(colonist);
      if (sowSpot) return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
      const tillSpot = game._pickTillSpot(colonist, sowCrop);
      if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
    }
  }
  return pickAutonomousTask(game, colonist);
}

/** "Builder" — pushes infrastructure ahead of, and upgrades, as it can. */
export function builderScript(game, colonist) {
  const gid = colonist.groupId;
  // Critical care work first.
  for (const crop of game.crops) {
    if (!game._canUseFrom(gid, crop.ownerId)) continue;
    if (colonist.isUnreachable?.(crop.x, crop.y, game.clock)) continue;
    if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.HARVEST, crop.x, crop.y);
    }
  }
  // The signature behaviour: build / expand aggressively.
  if (game.autoMode) {
    // First the standard ladder (hut → hearth → warehouse).
    const infra = urgentInfraBuild(game, colonist);
    if (infra) return infra;
    // Then proactive upgrades: a second warehouse when own utilisation
    // > 50%; a hut upgrade when bed slack < 2; an extra hearth above
    // the bare hut-count parity.
    const ownStockpiles = game._stockpileCountFor(gid);
    if (ownStockpiles > 0 && game._warehouseUtilizationFor(gid) > 0.5) {
      const wh = wantsWarehouse(game, colonist, { utilThreshold: 0.5 });
      if (wh && wh.build) {
        return createTask(TaskType.BUILD, wh.spot.x, wh.spot.y, { structure: wh.build });
      }
    }
    // α29 followup: builder's "+1 extra hearth" character now layers on
    // top of the pop-based target so the script's signature (more
    // infra) stays intact under any hut composition.
    const ownPop = game.groups?.[gid]?.colonists?.length || 0;
    const hearthTarget = Math.max(1, Math.ceil(ownPop / HEARTH_POP_RATIO)) + 1;
    const ownHearths = game._hearthCountFor(gid);
    if (ownHearths < hearthTarget && game._canAffordBuild('hearth')) {
      const spot = game._findFreeLandNear(colonist);
      if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'hearth' });
    }
    // α29 followup: builder gets a higher fence cap (FENCE_AUTO_CAP_BUILDER)
    // before delegating to balanced (which would stop at FENCE_AUTO_CAP).
    // The trigger is still the same — a hostile animal within range — so
    // peaceful runs don't see a wall of fence; once the threat fires the
    // planner, builder just keeps adding until its higher ceiling.
    if (
      game._totalFences() < FENCE_AUTO_CAP_BUILDER
      && game._canAffordBuild('fence')
    ) {
      const spot = game._nextFenceTile(colonist);
      if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'fence' });
    }
  }
  // Fallthrough — balanced handles farming / hunting / hauling.
  return pickAutonomousTask(game, colonist);
}

// Register every script so groups can look them up by id.
registerScript('balanced', pickAutonomousTask);
registerScript('farmer', farmerScript);
registerScript('farmer_breed', farmerBreedScript);
registerScript('scout', scoutScript);
registerScript('temperate', temperateScript);
registerScript('builder', builderScript);
