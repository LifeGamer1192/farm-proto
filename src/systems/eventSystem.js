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
import { CROP_IDS } from '../crops.js';
import { freshGenome } from '../genetics.js';
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
  if (season === 'winter') runWinterTrader(game);
  maybeBirth(game);
  // α26: groups running the Farmer (Selective breeding) script cull
  // their lowest-quality stock once per season change. The hook lives
  // on `game` so eventSystem doesn't depend on autonomy.js directly.
  if (game._runSelectiveBreedingCulls) game._runSelectiveBreedingCulls();
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
    icon: '🦌',
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
    icon: '👶',
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
      if (game._addSeed) game._addSeed(id, freshGenome(), recipientId);
    }
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
    icon: '🛒',
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
  game._pushLog({ icon: '🐛', text: t('log.pests', { n: spoiled }), cls: 'log-fail' });
}

/**
 * Lit hearths burn through the colony's wood over time. B3: the burn
 * is debited from whichever group currently holds the most wood, so the
 * per-group wood ledger stays consistent with the colony aggregate.
 */
export function updateFuel(game, dt) {
  if (game.hearths.length === 0 || game.storage.wood <= 0) return;
  const burn = Math.min(game.storage.wood, game.hearths.length * WOOD_BURN_RATE * dt);
  if (burn <= 0) return;
  const holder = largestGroupHolder(game, 'wood');
  storageSub(game, holder ? holder.id : null, 'wood', burn);
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
