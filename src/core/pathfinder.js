// A* pathfinding on the tile grid (4-directional movement).
// Water tiles are impassable, so paths route around them. Callers that
// pass blockFences=true (wild animals) also route around fences.
//
// Alpha 22 added three robustness knobs to keep big maps responsive:
//   - `maxIterations` caps the A* loop so a sealed-off goal cannot pin
//     the frame for milliseconds searching every reachable tile.
//   - `fallbackToNearest` returns the path to the closest reachable
//     tile to the goal when the goal itself is unreachable or the
//     iteration cap was hit. Useful for colonist work orders so a
//     colonist at least walks toward the cancelled / occupied tile
//     instead of standing still.
//   - `findPathStaged` splits long routes into legs through a midpoint
//     checkpoint so each A* call stays small. `PathCache` lets the
//     game share path results across colonists that aim at the same
//     tile in the same frame.

import { TileType } from '../map/tile.js';

function isWalkable(map, x, y, blockFences) {
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return false;
  const tile = map.tiles[y][x];
  if (tile.type === TileType.WATER) return false;
  if (blockFences && tile.structure === 'fence') return false;
  return true;
}

// Binary min-heap of open nodes, keyed by f-score.
class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(node) {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < n && items[left].f < items[smallest].f) smallest = left;
        if (right < n && items[right].f < items[smallest].f) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/** Reconstruct path waypoints from a cameFrom array. */
function reconstruct(cameFrom, startIdx, endIdx, cols) {
  const path = [];
  let p = endIdx;
  while (p !== startIdx) {
    path.push({ x: p % cols, y: (p / cols) | 0 });
    p = cameFrom[p];
    if (p < 0) return null;
  }
  path.reverse();
  return path;
}

/**
 * Find a shortest walkable path between two tiles.
 *
 * @param {{cols:number, rows:number, tiles:object[][]}} map
 * @param {{x:number, y:number}} start
 * @param {{x:number, y:number}} goal
 * @param {boolean} [blockFences] route around fence structures (wild animals)
 * @param {object}  [opts]
 * @param {number}  [opts.maxIterations=5000] hard cap on A* loop iterations
 * @param {boolean} [opts.fallbackToNearest=false] when the goal is
 *   unreachable (or the cap is hit), return the path to the visited
 *   tile closest to the goal instead of null. The fallback path may
 *   be empty if no progress was made beyond the start tile.
 * @returns {{x:number,y:number}[]|null} waypoints from the tile after
 *   `start` through `goal` (inclusive); `[]` if start === goal; `null`
 *   if unreachable and no fallback was requested.
 */
export function findPath(map, start, goal, blockFences = false, opts = {}) {
  const maxIterations = opts.maxIterations ?? 5000;
  const fallbackToNearest = !!opts.fallbackToNearest;

  // The start tile is always allowed to leave (an animal pinned on a fresh
  // fence can still walk off it); the goal and every step honour blockFences.
  if (!isWalkable(map, start.x, start.y, false)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const goalWalkable = isWalkable(map, goal.x, goal.y, blockFences);
  if (!goalWalkable && !fallbackToNearest) return null;

  const { cols, rows } = map;
  const total = cols * rows;
  const idx = (x, y) => y * cols + x;

  const gScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heuristic = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  const startIdx = idx(start.x, start.y);
  gScore[startIdx] = 0;

  // Track the visited tile that came nearest to the goal — used as the
  // fallback when the goal is sealed off or the cap is hit.
  let nearestIdx = startIdx;
  let nearestH = heuristic(start.x, start.y);

  const open = new MinHeap();
  open.push({ x: start.x, y: start.y, f: nearestH });

  const dirs = [1, 0, -1, 0, 0, 1, 0, -1];
  let iterations = 0;
  while (open.size > 0) {
    if (++iterations > maxIterations) break;
    const cur = open.pop();
    const ci = idx(cur.x, cur.y);
    if (closed[ci]) continue;
    closed[ci] = 1;

    const h = heuristic(cur.x, cur.y);
    if (h < nearestH) {
      nearestH = h;
      nearestIdx = ci;
    }

    if (cur.x === goal.x && cur.y === goal.y) {
      return reconstruct(cameFrom, startIdx, ci, cols);
    }

    for (let d = 0; d < 8; d += 2) {
      const nx = cur.x + dirs[d];
      const ny = cur.y + dirs[d + 1];
      if (!isWalkable(map, nx, ny, blockFences)) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const tentative = gScore[ci] + 1;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = ci;
        open.push({ x: nx, y: ny, f: tentative + heuristic(nx, ny) });
      }
    }
  }

  // Goal unreachable — fall back to the closest visited tile, if asked.
  if (fallbackToNearest && nearestIdx !== startIdx) {
    return reconstruct(cameFrom, startIdx, nearestIdx, cols);
  }
  if (fallbackToNearest) return []; // never moved past start
  return null;
}

/** Manhattan distance — used by the staged router to decide on splits. */
function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Long routes get split through a midpoint so each A* call stays cheap
// (the cost of A* is roughly quadratic in the open-set size). The pivot
// only needs to be plausibly walkable; if the leg fails we fall back
// to a single direct findPath call.
const STAGED_DISTANCE = 30;

/**
 * Stage-route a long-distance path through a midpoint checkpoint so each
 * A* call stays small. Falls back to a direct findPath for short routes
 * or if the staged plan cannot be stitched together. Honours the same
 * `opts` (maxIterations, fallbackToNearest) as findPath.
 */
export function findPathStaged(map, start, goal, blockFences = false, opts = {}) {
  if (manhattan(start, goal) <= STAGED_DISTANCE) {
    return findPath(map, start, goal, blockFences, opts);
  }
  // Pick a midpoint between start and goal, snapping to walkable tiles
  // if the geometric midpoint sits on water or a fence.
  const mx0 = Math.round((start.x + goal.x) / 2);
  const my0 = Math.round((start.y + goal.y) / 2);
  let mid = { x: mx0, y: my0 };
  if (!isWalkable(map, mid.x, mid.y, blockFences)) {
    // Walk outward in a small spiral until we find a passable tile.
    let found = false;
    for (let r = 1; r <= 8 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (isWalkable(map, mx0 + dx, my0 + dy, blockFences)) {
            mid = { x: mx0 + dx, y: my0 + dy };
            found = true;
          }
        }
      }
    }
    if (!found) return findPath(map, start, goal, blockFences, opts);
  }
  const leg1 = findPath(map, start, mid, blockFences, opts);
  if (!leg1) return findPath(map, start, goal, blockFences, opts);
  const last = leg1.length ? leg1[leg1.length - 1] : start;
  const leg2 = findPath(map, last, goal, blockFences, opts);
  if (!leg2) return findPath(map, start, goal, blockFences, opts);
  return leg1.concat(leg2);
}

/**
 * Tiny per-frame path cache. Multiple colonists targeting the same tile
 * in the same frame (queueing at a hearth, fetching from a stockpile,
 * marching to a tilled-tile cluster) share one A* result instead of
 * each running the full search. The cache is keyed by start+goal+flag
 * tuple and only lives within a single `frame` value, so a stale path
 * from before a fence went up is invalidated automatically.
 */
export class PathCache {
  constructor() {
    this._frame = 0;
    this._entries = new Map();
  }
  /**
   * Start of a new frame — the cache forgets last frame's entries.
   * Game.update should call this once per tick.
   */
  nextFrame() {
    this._frame += 1;
    if (this._entries.size > 0) this._entries.clear();
  }
  _key(start, goal, blockFences) {
    return `${start.x},${start.y}>${goal.x},${goal.y}|${blockFences ? 1 : 0}`;
  }
  /** Read a cached path (cloned so the consumer can mutate it). */
  get(start, goal, blockFences) {
    const hit = this._entries.get(this._key(start, goal, blockFences));
    if (!hit) return undefined;
    // Return a fresh copy — colonists mutate their path array as they walk.
    return hit.map((p) => ({ x: p.x, y: p.y }));
  }
  set(start, goal, blockFences, path) {
    if (!path) return;
    this._entries.set(this._key(start, goal, blockFences), path.map((p) => ({ x: p.x, y: p.y })));
  }
  /**
   * Convenience wrapper: lookup-then-compute. The compute uses the
   * staged router for long distances and stores the result in the
   * cache. Falls through to `null` only when no path could be found.
   */
  findCached(map, start, goal, blockFences = false, opts = {}) {
    const cached = this.get(start, goal, blockFences);
    if (cached !== undefined) return cached;
    const path = findPathStaged(map, start, goal, blockFences, opts);
    if (path) this.set(start, goal, blockFences, path);
    return path;
  }
}
