// Crop system: starter assortment, seed stock, codex tracking,
// cross-pollination on harvest, and the auto-sow / auto-till helpers
// that pick the next farming spot. Extracted from game.js so the seed/
// genetics economy lives in one tunable place.

import { CROP_IDS, getCrop, cropSuitability } from '../crops.js';
import {
  freshGenome,
  crossGenomes,
  qualityRank,
  genomeQuality,
} from '../genetics.js';
import { SEED_START_COUNT, SEEDS_PER_HARVEST, AUTO_SEARCH_RANGE } from '../config.js';
import { TileType } from '../map/tile.js';
import { TaskType } from '../tasks.js';
import { PlantKind } from '../world.js';
import { t } from '../i18n.js';

/**
 * Pick the colony's starting seed assortment — eight random crops, with
 * at least one grain so there is always a staple to plant. Wildgreens
 * is reserved for the foraging discovery loop and never seeds the
 * starter list.
 */
export function pickStartingCrops() {
  const want = 8;
  const eligible = CROP_IDS.filter((id) => id !== 'wildgreens');
  const grains = eligible.filter((id) => getCrop(id).category === 'grain');
  const others = eligible.filter((id) => getCrop(id).category !== 'grain');
  const pick = (pool) => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const chosen = [pick([...grains])];
  const pool = [...grains, ...others].filter((id) => !chosen.includes(id));
  while (chosen.length < want && pool.length) chosen.push(pick(pool));
  return chosen;
}

/**
 * A fresh seed stock: SEED_START_COUNT seeds for each starting crop; every
 * other crop slot is created empty. Sets `game.startingCrops` as a side
 * effect (kept on the game so the UI can read it).
 */
export function freshSeeds(game) {
  const stock = {};
  game.startingCrops = pickStartingCrops();
  for (const id of CROP_IDS) {
    const list = [];
    if (game.startingCrops.includes(id)) {
      for (let i = 0; i < SEED_START_COUNT; i++) list.push({ genome: freshGenome() });
    }
    stock[id] = list;
  }
  return stock;
}

/**
 * A fresh codex: per crop, the origin strain and the best variety so far.
 * Only crops the colony actually holds seed of get an entry.
 */
export function freshCodex(game) {
  const codex = {};
  for (const id of CROP_IDS) {
    const list = game.seeds[id];
    if (!list || list.length === 0) continue;
    let best = list[0].genome;
    for (const s of list) {
      if (genomeQuality(s.genome) > genomeQuality(best)) best = s.genome;
    }
    codex[id] = { origin: list[0].genome, best };
  }
  return codex;
}

/** Note in the codex if this genome is the best variety of its crop yet. */
export function recordCodex(game, cropId, genome) {
  const c = game.codex[cropId];
  if (c && genomeQuality(genome) > genomeQuality(c.best)) c.best = genome;
}

export function seedCount(game, cropId) {
  const s = game.seeds[cropId];
  return s ? s.length : 0;
}

/** The best (highest-quality) seed of a crop in stock, or null. */
export function bestSeed(game, cropId) {
  const s = game.seeds[cropId];
  if (!s || s.length === 0) return null;
  let best = s[0];
  for (const seed of s) {
    if (genomeQuality(seed.genome) > genomeQuality(best.genome)) best = seed;
  }
  return best;
}

/** Quality rank ★ of the best seed of a crop, or 0 if there are none. */
export function bestSeedRank(game, cropId) {
  const seed = bestSeed(game, cropId);
  return seed ? qualityRank(seed.genome) : 0;
}

/** Sow tasks for a crop already lined up — queued plus in colonists' hands. */
export function pendingSows(game, cropId) {
  let n = 0;
  for (const task of game.taskQueue) {
    if (task.type === TaskType.SOW && task.cropId === cropId) n++;
  }
  for (const c of game.colonists) {
    const ct = c.currentTask;
    if (ct && ct.type === TaskType.SOW && ct.cropId === cropId) n++;
  }
  return n;
}

/** True if a seed of this crop can still be spared for another sow order. */
export function canSow(game, cropId) {
  return seedCount(game, cropId) > pendingSows(game, cropId);
}

/** Remove and return the best-quality seed of a crop (null if none). */
export function takeSeed(game, cropId) {
  const seed = bestSeed(game, cropId);
  if (!seed) return null;
  const list = game.seeds[cropId];
  list.splice(list.indexOf(seed), 1);
  return seed;
}

/** Add a bred seed to a crop's stock and record it in the codex. */
export function addSeed(game, cropId, genome) {
  const s = game.seeds[cropId];
  if (s) {
    s.push({ genome });
    recordCodex(game, cropId, genome);
  }
}

// The same-crop plant pollinating `plant` from an adjacent tile, if any —
// the second parent for the seeds a harvest breeds.
function pollenSource(game, plant) {
  const mates = [];
  for (let dy = -1; dy <= 1; dy++) {
    const row = game.map.tiles[plant.y + dy];
    if (!row) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const p = row[plant.x + dx] && row[plant.x + dx].plant;
      if (p && p.kind === PlantKind.CROP && !p.withered && p.cropId === plant.cropId) {
        mates.push(p);
      }
    }
  }
  return mates.length ? mates[(Math.random() * mates.length) | 0] : null;
}

/**
 * Breed SEEDS_PER_HARVEST seeds from a harvested crop, crossing it with an
 * adjacent same-crop plant (or self-pollinating). Returns the seed count.
 */
export function gatherSeeds(game, plant) {
  const mate = pollenSource(game, plant);
  const otherGenome = mate ? mate.genome : plant.genome;
  for (let i = 0; i < SEEDS_PER_HARVEST; i++) {
    const child = crossGenomes(plant.genome, otherGenome);
    addSeed(game, plant.cropId, child.genome);
    if (child.legendary) {
      game._pushLog({
        icon: '✨',
        text: t('log.mutation', { crop: t('crop.' + plant.cropId) }),
        cls: 'log-meal',
      });
    }
  }
  return SEEDS_PER_HARVEST;
}

/** The crop with the largest seed stock (used to choose what to auto-sow). */
export function mostStockedCrop(game) {
  let best = null;
  let bestN = 0;
  for (const id of CROP_IDS) {
    const n = seedCount(game, id);
    if (n > bestN) {
      bestN = n;
      best = id;
    }
  }
  return best;
}

/** The closest empty tilled tile within range, ready to be sown. */
export function pickAutoSowSpot(game, colonist) {
  const cx = colonist.tileX;
  const cy = colonist.tileY;
  let best = null;
  let bestD = Infinity;
  for (let dy = -AUTO_SEARCH_RANGE; dy <= AUTO_SEARCH_RANGE; dy++) {
    const y = cy + dy;
    const row = game.map.tiles[y];
    if (!row) continue;
    for (let dx = -AUTO_SEARCH_RANGE; dx <= AUTO_SEARCH_RANGE; dx++) {
      const x = cx + dx;
      const t = row[x];
      if (!t || !t.tilled || t.plant || t.structure) continue;
      if (game._tileClaimed(x, y)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * A spot to till next. Scores tiles by crop suitability and favours ones
 * adjacent to existing tilled tiles, so the farm grows as a cluster.
 */
export function pickTillSpot(game, colonist, cropId) {
  const cropDef = getCrop(cropId);
  const cx = colonist.tileX;
  const cy = colonist.tileY;
  let best = null;
  let bestScore = -1;
  for (let dy = -AUTO_SEARCH_RANGE; dy <= AUTO_SEARCH_RANGE; dy++) {
    const y = cy + dy;
    const row = game.map.tiles[y];
    if (!row) continue;
    for (let dx = -AUTO_SEARCH_RANGE; dx <= AUTO_SEARCH_RANGE; dx++) {
      const x = cx + dx;
      const t = row[x];
      if (!t || t.type !== TileType.LAND) continue;
      if (t.tilled || t.plant || t.structure) continue;
      if (game._tileClaimed(x, y)) continue;
      let score = cropSuitability(cropDef, t);
      if (touchesTilled(game, x, y)) score += 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

export function touchesTilled(game, x, y) {
  for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const row = game.map.tiles[y + ay];
    const nb = row && row[x + ax];
    if (nb && nb.tilled) return true;
  }
  return false;
}
