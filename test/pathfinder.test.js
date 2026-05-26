// Logic tests for A* pathfinding. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { findPath, findPathStaged, PathCache } from '../src/core/pathfinder.js';
import { TileType } from '../src/map/tile.js';

// Build a map from ASCII rows: '.' = land, '#' = water.
function makeMap(rows) {
  const tiles = rows.map((line, y) =>
    [...line].map((ch, x) => ({
      x,
      y,
      type: ch === '#' ? TileType.WATER : TileType.LAND,
    })),
  );
  return { cols: rows[0].length, rows: rows.length, tiles };
}

const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

test('finds a straight path across open ground', () => {
  const map = makeMap(['.....', '.....', '.....']);
  const path = findPath(map, { x: 0, y: 1 }, { x: 4, y: 1 });
  assert.equal(path.length, 4);
  assert.deepEqual(path[path.length - 1], { x: 4, y: 1 });
});

test('path steps are 4-adjacent and start next to the origin', () => {
  const map = makeMap(Array(4).fill('..........'));
  const start = { x: 0, y: 0 };
  const path = findPath(map, start, { x: 9, y: 3 });
  assert.ok(adjacent(start, path[0]));
  for (let i = 1; i < path.length; i++) {
    assert.ok(adjacent(path[i - 1], path[i]));
  }
});

test('path routes around water', () => {
  const map = makeMap(['..#..', '..#..', '..#..', '.....']);
  const path = findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 });
  assert.ok(path, 'expected a path around the water');
  for (const step of path) {
    assert.notEqual(map.tiles[step.y][step.x].type, TileType.WATER);
  }
  assert.deepEqual(path[path.length - 1], { x: 4, y: 0 });
});

test('returns null when the goal is walled off by water', () => {
  const map = makeMap(['...#.', '...#.', '...#.', '...#.']);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }), null);
});

test('returns null when the goal itself is water', () => {
  const map = makeMap(['..#..']);
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }), null);
});

test('returns an empty path when already at the goal', () => {
  const map = makeMap(['...']);
  assert.deepEqual(findPath(map, { x: 1, y: 0 }, { x: 1, y: 0 }), []);
});

test('finds the shortest route on open ground', () => {
  const map = makeMap(Array(10).fill('..........'));
  const path = findPath(map, { x: 0, y: 0 }, { x: 9, y: 9 });
  assert.equal(path.length, 18); // = Manhattan distance
});

test('a fence wall stops animals but not colonists', () => {
  const map = makeMap(['.....', '.....', '.....', '.....']);
  for (let y = 0; y < map.rows; y++) map.tiles[y][2].structure = 'fence';
  // Colonists ignore fences — the straight route is still open.
  assert.ok(findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }));
  // Animals route around fences, and this wall seals every row off.
  assert.equal(findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, true), null);
});

test('an animal slips through a gap in a fence', () => {
  const map = makeMap(['.....', '.....', '.....', '.....']);
  for (let y = 0; y < 3; y++) map.tiles[y][2].structure = 'fence'; // row 3 is open
  const path = findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, true);
  assert.ok(path, 'expected a path through the fence gap');
  for (const step of path) {
    assert.notEqual(map.tiles[step.y][step.x].structure, 'fence');
  }
});

test('fallbackToNearest returns a path to the closest reachable tile', () => {
  // Goal sits in a walled-off pocket; the fallback should still produce
  // some path stepping AWAY from the start toward the wall.
  const map = makeMap(['...#.', '...#.', '...#.', '...#.']);
  const result = findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, false, {
    fallbackToNearest: true,
  });
  assert.ok(Array.isArray(result), 'fallback should not return null');
  // The last step must hug the wall (x=2 is the closest x to goal that
  // is still reachable without crossing the column of water at x=3).
  const last = result[result.length - 1];
  assert.equal(last.x, 2, 'fallback ended next to the impassable wall');
});

test('maxIterations caps the A* loop', () => {
  // Big open map — a real path is reachable but the cap forbids finding it.
  const map = makeMap(Array(20).fill('....................'));
  const tiny = findPath(map, { x: 0, y: 0 }, { x: 19, y: 19 }, false, {
    maxIterations: 5,
  });
  assert.equal(tiny, null, 'cap below path cost should bail out');
  // With the fallback flag set, the cap still returns the closest
  // reachable tile the search managed to expand into.
  const fallback = findPath(map, { x: 0, y: 0 }, { x: 19, y: 19 }, false, {
    maxIterations: 5,
    fallbackToNearest: true,
  });
  assert.ok(Array.isArray(fallback) && fallback.length > 0,
    'capped fallback returns the best progress so far');
});

test('findPathStaged matches findPath for short routes', () => {
  const map = makeMap(Array(8).fill('........'));
  const direct = findPath(map, { x: 0, y: 0 }, { x: 7, y: 0 });
  const staged = findPathStaged(map, { x: 0, y: 0 }, { x: 7, y: 0 });
  assert.equal(direct.length, staged.length, 'short routes go through the direct branch');
});

test('findPathStaged stitches a long route through a midpoint', () => {
  const map = makeMap(Array(40).fill('.'.repeat(40)));
  const staged = findPathStaged(map, { x: 0, y: 0 }, { x: 39, y: 39 });
  assert.ok(Array.isArray(staged) && staged.length >= 78,
    'staged path covers the full distance');
  // Last step is at the goal.
  const last = staged[staged.length - 1];
  assert.deepEqual(last, { x: 39, y: 39 });
});

test('PathCache reuses results within a frame and forgets on nextFrame', () => {
  const map = makeMap(Array(6).fill('......'));
  const cache = new PathCache();
  const a = cache.findCached(map, { x: 0, y: 0 }, { x: 5, y: 5 });
  // Same query should hit the cache and return an equivalent (cloned) path.
  const b = cache.findCached(map, { x: 0, y: 0 }, { x: 5, y: 5 });
  assert.deepEqual(a, b);
  // Mutating one returned path should not affect the next lookup.
  a.length = 0;
  const c = cache.findCached(map, { x: 0, y: 0 }, { x: 5, y: 5 });
  assert.ok(c.length > 0, 'cached entry survives caller mutations');
  cache.nextFrame();
  // After nextFrame the cache is empty (no internal entries left).
  assert.equal(cache._entries.size, 0);
});
