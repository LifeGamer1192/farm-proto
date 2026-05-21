// Logic tests for A* pathfinding. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { findPath } from '../src/core/pathfinder.js';
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
