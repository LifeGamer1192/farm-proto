// Building system: structure bookkeeping, wood-cost reservation, the
// auto-warehouse policy, the colony-wide fence plan, and tile-claim /
// free-land helpers used by the autonomy decision tree.

import {
  BUILD_COSTS,
  AUTO_SEARCH_RANGE,
  STOCKPILE_CAP,
  FENCE_AUTO_CAP,
  FENCE_PLAN_LENGTH,
  FENCE_REPLAN_COOLDOWN,
  FENCE_TRIGGER_RANGE,
} from '../config.js';
import { TileType } from '../map/tile.js';
import { TaskType } from '../tasks.js';
import { stockpileFood } from './foodSystem.js';

/** True if (x, y) is plain land — buildable, plantable, free of anything. */
export function isFreeLand(game, x, y) {
  const row = game.map.tiles[y];
  const t = row && row[x];
  if (!t) return false;
  return t.type === TileType.LAND && !t.tilled && !t.plant && !t.structure;
}

/**
 * True if a colonist is already working a tile, or a task is queued for it.
 * A 'done' task still counts as claimed until its effect has been applied —
 * otherwise a peer could pick the same tile in the same frame.
 */
export function tileClaimed(game, x, y) {
  for (const c of game.colonists) {
    const task = c.currentTask;
    if (task && task.x === x && task.y === y && task.status !== 'failed') {
      return true;
    }
  }
  for (const task of game.taskQueue) {
    if (task.x === x && task.y === y) return true;
  }
  return false;
}

/**
 * Spiral out from a colonist looking for an unclaimed plain land tile —
 * a spot for auto-built huts and hearths.
 */
export function findFreeLandNear(game, colonist) {
  const cx = colonist.tileX;
  const cy = colonist.tileY;
  for (let r = 1; r <= AUTO_SEARCH_RANGE; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!isFreeLand(game, x, y)) continue;
        if (tileClaimed(game, x, y)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

/** BUILD tasks of this structure queued or in colonists' hands. */
export function pendingBuilds(game, structure) {
  let n = 0;
  for (const t of game.taskQueue) {
    if (t.type === TaskType.BUILD && t.structure === structure) n++;
  }
  for (const c of game.colonists) {
    const ct = c.currentTask;
    if (ct && ct.type === TaskType.BUILD && ct.structure === structure) n++;
  }
  return n;
}

/** Total fence tiles the colony has, built plus pending. */
export function totalFences(game) {
  return game.fences.length + pendingBuilds(game, 'fence');
}

/** Wood already earmarked for queued or in-progress builds. */
export function reservedBuildWood(game) {
  let n = 0;
  for (const task of game.taskQueue) {
    if (task.type === TaskType.BUILD) n += BUILD_COSTS[task.structure] || 0;
  }
  for (const c of game.colonists) {
    const t = c.currentTask;
    if (t && t.type === TaskType.BUILD) n += BUILD_COSTS[t.structure] || 0;
  }
  return n;
}

/** Can afford `structure` without overspending reserved wood. */
export function canAffordBuild(game, structure) {
  const cost = BUILD_COSTS[structure] || 0;
  return game.storage.wood - reservedBuildWood(game) >= cost;
}

/**
 * Whether to auto-build another warehouse. Always wants at least one;
 * builds more if existing ones are nearly full, up to a hard cap.
 */
const AUTO_WAREHOUSE_CAP = 40;
export function wantsAutoWarehouse(game) {
  const total = game.stockpiles.length + pendingBuilds(game, 'stockpile');
  if (total >= AUTO_WAREHOUSE_CAP) return false;
  if (game.stockpiles.length === 0) return true;
  let used = 0;
  for (const sp of game.stockpiles) used += stockpileFood(sp);
  const cap = game.stockpiles.length * STOCKPILE_CAP;
  return used / cap > 0.85;
}

/**
 * The colony picks ONE wall row, then every colonist serves that plan
 * until it is built (or its tiles become invalid). Without a shared plan
 * each colonist would chase the moving animal independently, scattering
 * single fence tiles across several rows.
 */
export function nextFenceTile(game, colonist) {
  if (game.fencePlan) {
    game.fencePlan = game.fencePlan.filter((p) => isFreeLand(game, p.x, p.y));
    if (game.fencePlan.length === 0) game.fencePlan = null;
  }
  if (game.fencePlan) {
    let best = null;
    let bestD = Infinity;
    for (const p of game.fencePlan) {
      if (tileClaimed(game, p.x, p.y)) continue;
      const d = Math.hypot(p.x - colonist.tileX, p.y - colonist.tileY);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
  if (game.clock - game.fencePlanAt < FENCE_REPLAN_COOLDOWN) return null;
  if (totalFences(game) >= FENCE_AUTO_CAP) return null;
  planFenceLine(game);
  return game.fencePlan ? nextFenceTile(game, colonist) : null;
}

/**
 * Lay out one wall row of up to FENCE_PLAN_LENGTH tiles, sitting between
 * the colony's centroid and the nearest hostile animal, running
 * perpendicular to the threat direction. Stamps `fencePlanAt` so the
 * cooldown starts even if no plan was actually made.
 */
export function planFenceLine(game) {
  const animal = game._nearestAnimalToColony(FENCE_TRIGGER_RANGE);
  game.fencePlanAt = game.clock;
  if (!animal) return;
  const anchors = game.huts.length > 0
    ? game.huts
    : game.colonists.map((c) => ({ x: c.tileX, y: c.tileY }));
  if (anchors.length === 0) return;
  let cx = 0;
  let cy = 0;
  for (const a of anchors) {
    cx += a.x;
    cy += a.y;
  }
  cx /= anchors.length;
  cy /= anchors.length;
  let dx = animal.x - cx;
  let dy = animal.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const distFromColony = Math.min(Math.max(len * 0.55, 2), len - 1);
  const midX = cx + dx * distFromColony;
  const midY = cy + dy * distFromColony;
  const px = -dy;
  const py = dx;
  const budget = Math.min(FENCE_PLAN_LENGTH, FENCE_AUTO_CAP - totalFences(game));
  if (budget < 2) return;
  const plan = [];
  const half = (budget - 1) / 2;
  const lo = -Math.floor(half);
  const hi = Math.ceil(half);
  for (let i = lo; i <= hi; i++) {
    const x = Math.round(midX + px * i);
    const y = Math.round(midY + py * i);
    if (!isFreeLand(game, x, y)) continue;
    if (plan.some((p) => p.x === x && p.y === y)) continue;
    plan.push({ x, y });
  }
  if (plan.length >= 2) game.fencePlan = plan;
}
