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
} from '../config.js';
import { CROP_IDS } from '../crops.js';
import { freshGenome } from '../genetics.js';
import { PlantKind } from '../world.js';
import { Colonist } from '../entities/colonist.js';
import { t } from '../i18n.js';
import { FOOD_TYPES, rawFood, totalFood, largestFood } from './foodSystem.js';

/**
 * Seasonal events — kept here so the birth roll and the winter trader
 * both fire at exactly the same beat as the season change banner.
 */
export function onSeasonChange(game, season) {
  if (season === 'winter') runWinterTrader(game);
  maybeBirth(game);
}

/**
 * A new colonist joins when the colony has more than enough food, at
 * least one hut per existing colonist, and the population cap has not
 * been reached. The chance rolls per season change — about one season
 * in three when conditions hold — so growth feels like years, not minutes.
 */
export function maybeBirth(game) {
  if (game.colonists.length === 0) return;
  if (game.colonists.length >= POPULATION_CAP) return;
  if (game.huts.length < game.colonists.length) return;
  if (totalFood(game) < game.colonists.length * BIRTH_FOOD_PER_HEAD) return;
  if (Math.random() >= BIRTH_CHANCE) return;
  // Pick the group that has the fewest colonists (so growth is fair) —
  // ties broken by lowest id. The baby joins that group, spawning at
  // one of its huts if any, else next to one of its existing members.
  let parentGroup = null;
  if (game.groups && game.groups.length > 0) {
    for (const grp of game.groups) {
      if (!parentGroup || grp.colonists.length < parentGroup.colonists.length) {
        parentGroup = grp;
      }
    }
  }
  let pos;
  if (game.huts.length > 0) {
    pos = game.huts[Math.floor(Math.random() * game.huts.length)];
  } else if (parentGroup && parentGroup.colonists.length > 0) {
    const c = parentGroup.colonists[0];
    pos = { x: c.tileX, y: c.tileY };
  } else {
    const c = game.colonists[0];
    pos = { x: c.tileX, y: c.tileY };
  }
  // Per-group letter prefix keeps names unique across groups (alpha 23 fix).
  const letter = parentGroup ? String.fromCharCode(65 + parentGroup.id) : 'X';
  const baseName = BIRTH_NAMES[game._birthCounter % BIRTH_NAMES.length];
  const name = parentGroup ? `${baseName}·${letter}` : baseName;
  game._birthCounter += 1;
  const gid = parentGroup ? parentGroup.id : 0;
  const baby = new Colonist(pos.x, pos.y, name, gid);
  game.colonists.push(baby);
  if (parentGroup) parentGroup.colonists.push(baby);
  game._birthEvent = name;
  game._pushLog({
    icon: '👶',
    text: t('log.birth', { name }),
    cls: 'log-meal',
  });
}

/**
 * A travelling trader visits once per winter, leaving wood + seed
 * packets for a couple of random crops.
 */
export function runWinterTrader(game) {
  const year = game.environment.year;
  if (year <= game._traderYear) return;
  game._traderYear = year;
  game.storage.wood += TRADER_WOOD_GIFT;
  const pool = (game.startingCrops && game.startingCrops.length > 0)
    ? [...game.startingCrops]
    : CROP_IDS.slice();
  const gifts = [];
  while (gifts.length < TRADER_SEED_PACKETS && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    const id = pool.splice(idx, 1)[0];
    const list = game.seeds[id] || (game.seeds[id] = []);
    for (let i = 0; i < TRADER_SEED_COUNT; i++) {
      list.push({ genome: freshGenome() });
    }
    if (!game.codex[id]) {
      game.codex[id] = { origin: list[0].genome, best: list[0].genome };
    }
    gifts.push(id);
  }
  game._traderEvent = { wood: TRADER_WOOD_GIFT, seeds: gifts };
  game._pushLog({
    icon: '🛒',
    text: t('log.trader', {
      wood: TRADER_WOOD_GIFT,
      crops: gifts.map((id) => t('crop.' + id)).join(', '),
    }),
    cls: 'log-meal',
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
    game.storage[pick] -= 1;
    spoiled += 1;
  }
  if (spoiled === 0) return;
  game.pestsLost += spoiled;
  game._pestEvent = true;
  game._pushLog({ icon: '🐛', text: t('log.pests', { n: spoiled }), cls: 'log-fail' });
}

/** Lit hearths burn through the colony's wood over time. */
export function updateFuel(game, dt) {
  if (game.hearths.length === 0 || game.storage.wood <= 0) return;
  game.storage.wood = Math.max(0, game.storage.wood - game.hearths.length * WOOD_BURN_RATE * dt);
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
