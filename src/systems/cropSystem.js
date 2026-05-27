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

/**
 * Note in the codex if this genome is the best variety of its crop yet.
 * Updates the colony-wide codex, plus the harvesting group's per-group
 * codex when `groupId` is provided (α25 follow-up — before this fix the
 * group codex stayed frozen at initial state).
 */
export function recordCodex(game, cropId, genome, groupId) {
  const c = game.codex[cropId];
  if (c && genomeQuality(genome) > genomeQuality(c.best)) c.best = genome;
  else if (!c) {
    game.codex[cropId] = { origin: genome, best: genome };
  }
  if (groupId == null) return;
  const grp = game.groups?.[groupId];
  if (!grp) return;
  const gc = grp.codex[cropId];
  if (gc) {
    if (genomeQuality(genome) > genomeQuality(gc.best)) gc.best = genome;
  } else {
    grp.codex[cropId] = { origin: genome, best: genome };
  }
}

/**
 * The seed list to read from. `groupId` null/undefined → colony-wide
 * aggregate (`game.seeds`). Otherwise → that group's per-group pool
 * (`game.groups[groupId].seeds`). After B1 (α25 follow-up) the per-group
 * lists are the canonical store and `game.seeds` holds the union — see
 * the addSeed / takeSeed mirror logic below.
 */
function seedList(game, cropId, groupId) {
  if (groupId == null) return game.seeds[cropId] || [];
  const g = game.groups?.[groupId];
  if (!g || !g.seeds) return [];
  return g.seeds[cropId] || [];
}

export function seedCount(game, cropId, groupId) {
  return seedList(game, cropId, groupId).length;
}

/** The best (highest-quality) seed of a crop in stock, or null. */
export function bestSeed(game, cropId, groupId) {
  const s = seedList(game, cropId, groupId);
  if (s.length === 0) return null;
  let best = s[0];
  for (const seed of s) {
    if (genomeQuality(seed.genome) > genomeQuality(best.genome)) best = seed;
  }
  return best;
}

/** Quality rank ★ of the best seed of a crop, or 0 if there are none. */
export function bestSeedRank(game, cropId, groupId) {
  const seed = bestSeed(game, cropId, groupId);
  return seed ? qualityRank(seed.genome) : 0;
}

/**
 * Sow tasks for a crop already lined up — queued plus in colonists'
 * hands. When `groupId` is set, only counts tasks belonging to that
 * group (so two groups don't double-book one colony-wide pending count).
 */
export function pendingSows(game, cropId, groupId) {
  let n = 0;
  // N2: prefer task.groupId (set at enqueue time). Fall back to the
  // assignee lookup for older / hand-built tasks that lack groupId.
  const taskGroupId = (task) => {
    if (task.groupId != null) return task.groupId;
    if (!task.assignee) return null;
    const c = game.colonists.find((cc) => cc.name === task.assignee);
    return c ? c.groupId : null;
  };
  for (const task of game.taskQueue) {
    if (task.type !== TaskType.SOW || task.cropId !== cropId) continue;
    if (groupId == null) { n++; continue; }
    if (taskGroupId(task) === groupId) n++;
  }
  for (const c of game.colonists) {
    const ct = c.currentTask;
    if (!ct || ct.type !== TaskType.SOW || ct.cropId !== cropId) continue;
    if (groupId == null || c.groupId === groupId) n++;
  }
  return n;
}

/** True if a seed of this crop can still be spared for another sow order. */
export function canSow(game, cropId, groupId) {
  return seedCount(game, cropId, groupId) > pendingSows(game, cropId, groupId);
}

/**
 * Remove and return the best-quality seed of a crop (null if none).
 * When `groupId` is given, takes from that group's pool first; the
 * colony aggregate (`game.seeds`) is kept in lock-step. When omitted
 * (player-issued sow without an assignee group), scans every group and
 * takes from whichever has the best seed.
 */
export function takeSeed(game, cropId, groupId) {
  const seed = bestSeed(game, cropId, groupId);
  if (!seed) return null;
  if (groupId != null) {
    const g = game.groups?.[groupId];
    if (g?.seeds?.[cropId]) {
      const i = g.seeds[cropId].indexOf(seed);
      if (i >= 0) g.seeds[cropId].splice(i, 1);
    }
  } else {
    // Find whichever group holds the chosen seed object and pull it out
    // of that group's pool too, so the per-group view stays consistent
    // with the colony aggregate.
    for (const g of game.groups || []) {
      const list = g.seeds?.[cropId];
      if (!list) continue;
      const i = list.indexOf(seed);
      if (i >= 0) { list.splice(i, 1); break; }
    }
  }
  const colList = game.seeds[cropId];
  if (colList) {
    const i = colList.indexOf(seed);
    if (i >= 0) colList.splice(i, 1);
  }
  return seed;
}

/**
 * Add a bred seed to a crop's stock and record it in the codex. When
 * `groupId` is provided the seed is filed into that group's per-group
 * pool AND into the colony aggregate (same object reference, so a later
 * takeSeed removes both copies). When omitted, only the colony pool is
 * touched — used by legacy paths that don't know an owner.
 */
export function addSeed(game, cropId, genome, groupId) {
  const seed = { genome };
  if (groupId != null) {
    const g = game.groups?.[groupId];
    if (g) {
      if (!g.seeds[cropId]) g.seeds[cropId] = [];
      g.seeds[cropId].push(seed);
    }
  }
  if (!game.seeds[cropId]) game.seeds[cropId] = [];
  game.seeds[cropId].push(seed);
  recordCodex(game, cropId, genome, groupId);
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
 *
 * `groupId` is the colonist's group — used so the per-group codex (and
 * eventually the per-group seed stock, see B1) records the new variety.
 */
export function gatherSeeds(game, plant, groupId) {
  const mate = pollenSource(game, plant);
  const otherGenome = mate ? mate.genome : plant.genome;
  for (let i = 0; i < SEEDS_PER_HARVEST; i++) {
    const child = crossGenomes(plant.genome, otherGenome);
    addSeed(game, plant.cropId, child.genome, groupId);
    if (child.legendary) {
      // BUG-4 fix: persistent per-group mutation counter — survives
      // the activity log's ring-buffer rotation. Also lets the popup
      // show "Mutation #N for this colony" as a flavour tag.
      const mbg = game.stats?.mutationsByGroup;
      const seq = mbg ? (mbg[groupId] = (mbg[groupId] || 0) + 1) : null;
      game._pushLog({
        icon: '✨',
        text: t('log.mutation', { crop: t('crop.' + plant.cropId) }),
        cls: 'log-meal',
        groupId,
      });
      // D1/F3: surface mutations as a one-shot big-popup event. Carry
      // the mutated genome + the parent's so the popup can render a
      // codex-style gene panel comparing the two strains. Also pass
      // the per-group mutation count + the parent's tile so the popup
      // can show a celebratory "Nth mutation" badge and the season.
      game._mutationEvent = {
        crop: plant.cropId,
        groupId,
        genome: child.genome,
        parent: plant.genome,
        seq,
        year: game.environment?.year ?? null,
        season: game.environment?.season ?? null,
      };
    }
  }
  return SEEDS_PER_HARVEST;
}

/**
 * The crop with the largest seed stock (used to choose what to auto-sow).
 * Per-group when `groupId` is given so each colony grows from its own
 * stash; otherwise looks at the colony aggregate.
 */
export function mostStockedCrop(game, groupId) {
  let best = null;
  let bestN = 0;
  for (const id of CROP_IDS) {
    const n = seedCount(game, id, groupId);
    if (n > bestN) {
      bestN = n;
      best = id;
    }
  }
  return best;
}

/**
 * Pick the colonist's "home" search anchor for auto-tasks: the group's
 * spawn cluster centre when available, otherwise the colonist's own
 * tile (legacy fallback). Used so an idle colonist who wandered into
 * another colony's territory still tills / sows / builds near its
 * own farm cluster instead of merging into the neighbouring colony.
 */
function homeAnchor(game, colonist) {
  const grp = game.groups?.[colonist.groupId];
  if (grp?.spawnAnchor) return grp.spawnAnchor;
  return { x: colonist.tileX, y: colonist.tileY };
}

/** BUG-3 fix: a tile that withered `cropId` 3+ times in a row is
 * blacklisted for that crop (the suitability is clearly too low to be
 * worth another seed). The streak resets on a successful harvest of
 * the same crop. */
export const WITHER_BLACKLIST_THRESHOLD = 3;
export function tileBlocksCrop(tile, cropId) {
  if (!tile || !tile.witherStreak || cropId == null) return false;
  return (tile.witherStreak[cropId] || 0) >= WITHER_BLACKLIST_THRESHOLD;
}

/**
 * The closest empty tilled tile within range, ready to be sown.
 * E3: searches from the colonist's group anchor and only accepts tiles
 * tilled by that same group. With this filter, a Colony B sower never
 * targets a Colony A bed and the two colonies' farms stay separate.
 * BUG-3 fix: when `cropId` is passed, tiles that withered the same
 * crop 3+ times are skipped.
 */
export function pickAutoSowSpot(game, colonist, cropId) {
  const anchor = homeAnchor(game, colonist);
  const cx = anchor.x;
  const cy = anchor.y;
  const gid = colonist.groupId;
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
      if (!game._canUseFrom(gid, t.tilledBy)) continue;
      if (game._tileClaimed(x, y)) continue;
      if (colonist.isUnreachable?.(x, y, game.clock)) continue;
      if (tileBlocksCrop(t, cropId)) continue;
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
 * E3: searches from the group anchor and the adjacency bonus only
 * counts tiles owned by the same group, so colonies grow their own
 * farms instead of bridging together.
 */
export function pickTillSpot(game, colonist, cropId) {
  const cropDef = getCrop(cropId);
  const anchor = homeAnchor(game, colonist);
  const cx = anchor.x;
  const cy = anchor.y;
  const gid = colonist.groupId;
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
      if (colonist.isUnreachable?.(x, y, game.clock)) continue;
      if (tileBlocksCrop(t, cropId)) continue;
      let score = cropSuitability(cropDef, t);
      if (touchesTilled(game, x, y, gid)) score += 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * True if (x, y) has at least one 4-adjacent tile that is tilled. When
 * `groupId` is given, only counts tiles tilled by that group (E3) so
 * the adjacency bonus stays inside the group's own farmland.
 */
export function touchesTilled(game, x, y, groupId) {
  for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const row = game.map.tiles[y + ay];
    const nb = row && row[x + ax];
    if (!nb || !nb.tilled) continue;
    if (groupId != null && nb.tilledBy != null && nb.tilledBy !== groupId) continue;
    return true;
  }
  return false;
}
