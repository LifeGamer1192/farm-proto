// A* pathfinding on the tile grid (4-directional movement).
// Water tiles are impassable, so paths route around them.

import { TileType } from '../map/tile.js';

function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return false;
  return map.tiles[y][x].type !== TileType.WATER;
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

/**
 * Find a shortest walkable path between two tiles.
 * @param {{cols:number, rows:number, tiles:object[][]}} map
 * @param {{x:number, y:number}} start
 * @param {{x:number, y:number}} goal
 * @returns {{x:number,y:number}[]|null} waypoints from the tile after `start`
 *   through `goal` (inclusive); `[]` if start === goal; `null` if unreachable.
 */
export function findPath(map, start, goal) {
  if (!isWalkable(map, start.x, start.y)) return null;
  if (!isWalkable(map, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const { cols, rows } = map;
  const total = cols * rows;
  const idx = (x, y) => y * cols + x;

  const gScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heuristic = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  const startIdx = idx(start.x, start.y);
  gScore[startIdx] = 0;

  const open = new MinHeap();
  open.push({ x: start.x, y: start.y, f: heuristic(start.x, start.y) });

  const dirs = [1, 0, -1, 0, 0, 1, 0, -1];
  while (open.size > 0) {
    const cur = open.pop();
    const ci = idx(cur.x, cur.y);
    if (closed[ci]) continue;
    closed[ci] = 1;

    if (cur.x === goal.x && cur.y === goal.y) {
      const path = [];
      let p = ci;
      while (p !== startIdx) {
        path.push({ x: p % cols, y: (p / cols) | 0 });
        p = cameFrom[p];
      }
      path.reverse();
      return path;
    }

    for (let d = 0; d < 8; d += 2) {
      const nx = cur.x + dirs[d];
      const ny = cur.y + dirs[d + 1];
      if (!isWalkable(map, nx, ny)) continue;
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
  return null;
}
