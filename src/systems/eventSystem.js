// Event system: season transitions, population growth, the winter
// trader, pest strikes, hearth fuel burn, forest regrowth and the
// victory check. Extracted from game.js so the "random / seasonal /
// background" loop is one tunable file.

import {
  PEST_INTERVAL,
  PEST_BITE,
  WOOD_BURN_RATE,
  TREE_GROW_TIME,
  POPULATION_CAP,
  BIRTH_NAMES,
  BIRTH_CHANCE,
  BIRTH_FOOD_PER_HEAD,
  BIRTH_HEALTHY_REQUIRED,
  TRADER_WOOD_GIFT,
  TRADER_SEED_PACKETS,
  TRADER_SEED_COUNT,
  STUMP_REGROW_TIME,
  VICTORY_YEAR,
  ANIMAL_COUNT,
  ANIMAL_SPAWN_MIX,
  ANIMAL_RESTOCK_THRESHOLD,
  ANIMAL_RESTOCK_AMOUNT,
} from '../config.js';
import { CROP_IDS, seedGenome } from '../crops.js';
import { PlantKind } from '../world.js';
import { Colonist } from '../entities/colonist.js';
import { Animal } from '../entities/animal.js';
import { t } from '../i18n.js';
import { pickBirthName, formatColonistName } from '../names/index.js';
import {
  FOOD_TYPES,
  rawFood,
  totalFood,
  largestFood,
  storageAdd,
  storageSub,
  largestGroupHolder,
} from './foodSystem.js';

/**
 * Seasonal events — kept here so the birth roll and the winter trader
 * both fire at exactly the same beat as the season change banner.
 */
export function onSeasonChange(game, season) {
  // α30 followup: stamp the wood reading at the moment of season
  // change into each group's per-season bucket so the timeline can
  // print "木材 8 → 0".
  if (game.stats?.seasonByGroup && game.environment) {
    const env = game.environment;
    const sk = `Y${env.year}_${env.season}`;
    for (const grp of game.groups || []) {
      const byG = game.stats.seasonByGroup[grp.id] ||= {};
      const bucket = byG[sk] ||= { woodStart: 0, woodEnd: 0, litSamples: [], cooks: 0, eatMissReasons: {} };
      bucket.woodStart = grp.storage?.wood || 0;
      bucket.woodEnd = bucket.woodStart;
    }
  }
  if (season === 'winter') runWinterTrader(game);
  maybeBirth(game);
  // α26: groups running the Farmer (Selective breeding) script cull
  // their lowest-quality stock once per season change. The hook lives
  // on `game` so eventSystem doesn't depend on autonomy.js directly.
  // C7: the cull is autonomous work — skip it while Auto-work is off so
  // a fully order-driven colony doesn't queue weed tasks on its own.
  if (game.autoMode && game._runSelectiveBreedingCulls) game._runSelectiveBreedingCulls();
  // α28 followup Z3: top up wild animals once per year (at the spring
  // change). Without this a scout / forager colony eventually empties
  // the map and starves. Restock only fires when the population has
  // dropped below the threshold, so a healthy map isn't over-stuffed.
  if (season === 'spring') maybeRestockAnimals(game);
}

function maybeRestockAnimals(game) {
  const target = ANIMAL_COUNT * ANIMAL_RESTOCK_THRESHOLD;
  if ((game.animals?.length || 0) >= target) return;
  const tiles = game._randomLandTiles?.(ANIMAL_RESTOCK_AMOUNT) || [];
  if (tiles.length === 0) return;
  // Re-use the spawnAnimals helper indirectly: pull in a small mix and
  // build Animal instances using the existing wiring.
  const mix = game.biome?.animalSpawnMix || ANIMAL_SPAWN_MIX;
  const specList = [];
  for (const { species, n } of mix) for (let i = 0; i < n; i++) specList.push(species);
  while (specList.length < ANIMAL_RESTOCK_AMOUNT) specList.push('boar');
  const id0 = (game.animals?.length || 0) + 1;
  for (let i = 0; i < tiles.length; i++) {
    const a = new Animal(tiles[i].x, tiles[i].y, id0 + i, specList[i % specList.length]);
    game.animals.push(a);
  }
  game._pushLog({
    icon: 'deer',
    text: t('log.animalsReturn', { n: tiles.length }),
    cls: 'log-meal',
  });
}

/**
 * Population growth is rolled per colony group (G2). For each group:
 *   - must have at least one colonist alive
 *   - own roster < POPULATION_CAP / group_count (so a single colony can't
 *     hog the cap)
 *   - own huts >= own colonists
 *   - own food/head >= BIRTH_FOOD_PER_HEAD
 *   - BIRTH_CHANCE roll succeeds
 * Multiple groups can give birth on the same season change. The baby
 * joins its parent's group, spawning at one of that group's huts.
 */
export function maybeBirth(game) {
  if (!game.groups || game.groups.length === 0) {
    return maybeBirthLegacy(game);
  }
  // Per-group cap: divide the colony cap evenly across groups so the
  // total stays bounded but a single colony can't dominate.
  const perGroupCap = Math.max(1, Math.floor(POPULATION_CAP / game.groups.length));
  for (const grp of game.groups) {
    if (grp.colonists.length === 0) continue;
    if (grp.colonists.length >= perGroupCap) continue;
    if (game.colonists.length >= POPULATION_CAP) break;
    // Own-group BED capacity (not hut count) vs own roster. I1: a
    // single medium hut covers 4 beds, so the previous "hutCount <
    // pop" check froze population at 4 even after the colony had
    // upgraded to a tier-2 hut. Use the same bed-cap helper the
    // auto-builder uses to decide when more hut space is needed.
    const beds = game._hutCapacityFor ? game._hutCapacityFor(grp.id) : 0;
    if (beds < grp.colonists.length) continue;
    // α30 (B1): require at least N healthy (stage 0) colonists in the
    // group — a colony living on bread alone won't grow until somebody
    // brings vitamin or protein back to the table.
    const healthy = grp.colonists.filter(
      (c) => !c.dead && (c.malnutritionStage ? c.malnutritionStage() : 0) === 0,
    ).length;
    if (healthy < BIRTH_HEALTHY_REQUIRED) continue;
    // Own-group food / head
    const ownFood = game._totalFoodFor ? game._totalFoodFor(grp.id) : 0;
    if (ownFood < grp.colonists.length * BIRTH_FOOD_PER_HEAD) continue;
    if (Math.random() >= BIRTH_CHANCE) continue;
    spawnBabyInto(game, grp);
  }
}

/** Single-group / legacy path used when groups aren't initialised yet. */
function maybeBirthLegacy(game) {
  if (game.colonists.length === 0) return;
  if (game.colonists.length >= POPULATION_CAP) return;
  if (game.huts.length < game.colonists.length) return;
  if (totalFood(game) < game.colonists.length * BIRTH_FOOD_PER_HEAD) return;
  // α30 (B1): healthy-colonist gate also applies to the legacy path.
  const healthy = game.colonists.filter(
    (c) => !c.dead && (c.malnutritionStage ? c.malnutritionStage() : 0) === 0,
  ).length;
  if (healthy < BIRTH_HEALTHY_REQUIRED) return;
  if (Math.random() >= BIRTH_CHANCE) return;
  spawnBabyInto(game, null);
}

/** Add a new colonist to `grp` (or the colony root) and announce it. */
function spawnBabyInto(game, parentGroup) {
  const gid = parentGroup ? parentGroup.id : 0;
  // Prefer own-group huts; fall back to a member's tile, else a random
  // tile near group 0's spawn anchor.
  let pos = null;
  if (parentGroup) {
    const ownHuts = game.huts.filter((h) => h.ownerId === gid);
    if (ownHuts.length > 0) pos = ownHuts[Math.floor(Math.random() * ownHuts.length)];
    else if (parentGroup.colonists.length > 0) {
      const c = parentGroup.colonists[0];
      pos = { x: c.tileX, y: c.tileY };
    }
  }
  if (!pos) {
    if (game.huts.length > 0) {
      pos = game.huts[Math.floor(Math.random() * game.huts.length)];
    } else if (game.colonists.length > 0) {
      const c = game.colonists[0];
      pos = { x: c.tileX, y: c.tileY };
    } else return;
  }
  // T4 (α27 followup): pull names from the per-language births pool and
  // format as "Name[GroupLetter]" so the colony tag is obvious in the
  // log and the colonist roster. Ungrouped (legacy) births get a "?".
  const baseName = pickBirthName(game._birthCounter);
  const name = parentGroup
    ? formatColonistName(baseName, parentGroup.id)
    : baseName;
  game._birthCounter += 1;
  const baby = new Colonist(pos.x, pos.y, name, gid);
  game.colonists.push(baby);
  if (parentGroup) parentGroup.colonists.push(baby);
  // BUG-4 fix: persistent birth counter.
  if (game.stats?.birthsByGroup) {
    game.stats.birthsByGroup[gid] = (game.stats.birthsByGroup[gid] || 0) + 1;
  }
  game._birthEvent = { name, groupId: gid };
  game._pushLog({
    icon: 'baby',
    text: t('log.birth', { name }),
    cls: 'log-meal',
    groupId: gid,
  });
}

/**
 * Pick the group most in need of trader help: fewest total seeds across
 * every crop. Falls back to group 0 when no groups exist (single-group
 * legacy path).
 */
function pickTraderRecipient(game) {
  if (!game.groups || game.groups.length === 0) return null;
  let best = game.groups[0];
  let bestN = Infinity;
  for (const g of game.groups) {
    let n = 0;
    for (const id of CROP_IDS) n += g.seeds?.[id]?.length || 0;
    if (n < bestN) { bestN = n; best = g; }
  }
  return best;
}

/**
 * A travelling trader visits once per winter, leaving wood + seed
 * packets for a couple of random crops. α25 follow-up (B1): the seed
 * gift is routed to the most-deprived group so per-group pools stay in
 * sync. Wood remains colony-wide until B3.
 */
export function runWinterTrader(game) {
  const year = game.environment.year;
  if (year <= game._traderYear) return;
  game._traderYear = year;
  const recipient = pickTraderRecipient(game);
  const recipientId = recipient ? recipient.id : null;
  // B3: route the wood gift through the per-group ledger so the
  // recipient's wood column updates alongside the colony aggregate.
  storageAdd(game, recipientId, 'wood', TRADER_WOOD_GIFT);
  const pool = (game.startingCrops && game.startingCrops.length > 0)
    ? [...game.startingCrops]
    : CROP_IDS.slice();
  const gifts = [];
  while (gifts.length < TRADER_SEED_PACKETS && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    const id = pool.splice(idx, 1)[0];
    for (let i = 0; i < TRADER_SEED_COUNT; i++) {
      // addSeed handles colony aggregate + per-group pool + codex.
      if (game._addSeed) game._addSeed(id, seedGenome(id), recipientId);
    }
    // α30 followup: tag the codex entry so the pedigree origin banner
    // can show "商人から入手". Only stamp if no origin was recorded yet
    // — a crop already in the catalogue from starter / mutation
    // shouldn't be relabelled.
    const grp = game.groups?.[recipientId];
    const codex = grp?.codex?.[id];
    if (codex && !codex.originType) codex.originType = 'trader';
    gifts.push(id);
  }
  game._traderEvent = { wood: TRADER_WOOD_GIFT, seeds: gifts, groupId: recipientId };
  // BUG-4 fix: keep a per-year trader visit record on stats so a post-
  // game summary can verify the winter event fired even after the log
  // ring buffer has rotated past it.
  if (game.stats?.traderVisitsByYear) {
    game.stats.traderVisitsByYear[year] = {
      groupId: recipientId,
      wood: TRADER_WOOD_GIFT,
      seeds: gifts.slice(),
    };
  }
  game._pushLog({
    icon: 'cart',
    text: t('log.trader', {
      wood: TRADER_WOOD_GIFT,
      crops: gifts.map((id) => t('crop.' + id)).join(', '),
    }),
    cls: 'log-meal',
    groupId: recipientId,
  });
}

/** Pests gnaw at on-hand raw food on a timer; stockpiles keep food safe. */
export function updatePests(game, dt) {
  game.pestTimer += dt;
  if (game.pestTimer < PEST_INTERVAL) return;
  game.pestTimer -= PEST_INTERVAL;
  pestStrike(game);
}

export function pestStrike(game) {
  if (rawFood(game) <= 0) return;
  const loss = Math.ceil(rawFood(game) * PEST_BITE);
  let spoiled = 0;
  while (spoiled < loss) {
    const pick = largestFood(game.storage, FOOD_TYPES);
    if (pick === null) break;
    // B2: the spoilage is debited from the group with the biggest stash
    // of the picked item, so the per-group "spoiled" counter follows the
    // food that actually rotted.
    const holder = largestGroupHolder(game, pick);
    const gid = holder ? holder.id : null;
    storageSub(game, gid, pick, 1);
    if (holder) holder.pestsLost = (holder.pestsLost || 0) + 1;
    spoiled += 1;
  }
  if (spoiled === 0) return;
  game.pestsLost += spoiled;
  // D1: the consumer (main.js) reads { n } so the popup can quote how
  // many units were spoiled. Older code only checked truthiness, so an
  // object value remains back-compat.
  game._pestEvent = { n: spoiled };
  game._pushLog({ icon: 'pest', text: t('log.pests', { n: spoiled }), cls: 'log-fail' });
}

/**
 * Lit hearths burn through their OWN group's wood over time.
 *
 * α30 followup: until now the burn was colony-wide — every hearth
 * pulled from whichever group currently held the most wood. That meant
 * a poor colony's hearths were "lit" (visually) drawing on a rich
 * colony's stockpile, but the per-group cook gate `_hearthsLitFor(gid)`
 * still required the poor group's OWN wood to be > 0, so they could
 * never actually cook. Real player run: colony B had 8 warehouses of
 * raw barley, three hearths, zero own wood; A had wood, so B's hearths
 * drained A's reserve while B starved. Now each group's hearths burn
 * that group's wood only; a group with no own wood gets dark hearths
 * (and the per-group chop trigger fires for them, instead of A
 * silently subsidising B's heating).
 */
export function updateFuel(game, dt) {
  if (game.hearths.length === 0) return;
  const env = game.environment;
  const seasonKey = env ? `Y${env.year}_${env.season}` : null;
  const prevByG = game.stats?._prevWoodByGroup || {};
  for (const grp of game.groups || []) {
    const ownHearths = game.hearths.filter((h) => h.ownerId === grp.id).length;
    if (ownHearths === 0) continue;
    const ownWood = grp.storage?.wood || 0;
    const wasLit = (prevByG[grp.id] ?? ownWood) > 0;
    const nowLit = ownWood > 0;
    // α30 followup: per-season "%-of-time the hearths were lit" — a 1
    // per tick when group had wood, 0 when dark. Averaged at export time.
    if (seasonKey && game.stats?.seasonByGroup) {
      const byG = game.stats.seasonByGroup[grp.id] ||= {};
      const bucket = byG[seasonKey] ||= { woodStart: ownWood, woodEnd: ownWood, litSamples: [], cooks: 0, eatMissReasons: {} };
      bucket.litSamples.push(nowLit ? 1 : 0);
      bucket.woodEnd = ownWood;
    }
    // Capture lit → unlit transition once per group per drop-to-zero.
    if (wasLit && !nowLit) {
      if (game.stats?.hearthOutEventsByGroup && env) {
        const arr = game.stats.hearthOutEventsByGroup[grp.id] ||= [];
        arr.push({ year: env.year, season: env.season, day: env.day });
      }
    }
    if (nowLit) {
      const burn = Math.min(ownWood, ownHearths * WOOD_BURN_RATE * dt);
      if (burn > 0) storageSub(game, grp.id, 'wood', burn);
    }
    if (game.stats) {
      if (!game.stats._prevWoodByGroup) game.stats._prevWoodByGroup = {};
      game.stats._prevWoodByGroup[grp.id] = grp.storage?.wood || 0;
    }
  }
}

/**
 * Trees grow back from stumps after a cooldown; young trees mature
 * over the next stretch. Iterating every tile is cheap at the
 * prototype's map size and keeps the bookkeeping simple.
 */
export function updateForest(game, dt) {
  const rows = game.map.tiles;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const p = row[x].plant;
      if (!p) continue;
      if (p.kind === PlantKind.STUMP) {
        if (game.clock >= p.regrowAt) {
          row[x].plant = { kind: PlantKind.TREE, growth: 0 };
        }
      } else if (p.kind === PlantKind.TREE && p.growth < 1) {
        p.growth = Math.min(1, p.growth + dt / TREE_GROW_TIME);
      }
    }
  }
}

/** Fire the one-shot victory event when the colony has survived enough years. */
export function checkVictory(game) {
  if (game.won || game.over) return;
  if (game.environment.year >= VICTORY_YEAR && game.colonists.length > 0) {
    game.won = true;
    game._winEvent = true;
  }
}

/** Re-export the regrow constant so callers can compute it themselves. */
export { STUMP_REGROW_TIME };
