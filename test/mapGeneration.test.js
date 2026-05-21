// Logic tests for map generation. Run with: npm test
//
// These cover the pure simulation core (no DOM / Canvas), which lets the
// generator be verified headlessly and in CI.

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMap, mapStats } from '../src/map/mapGenerator.js';
import { TileType } from '../src/map/tile.js';
import { mulberry32 } from '../src/core/rng.js';

const COLS = 30;
const ROWS = 30;

test('map has the requested dimensions', () => {
  const map = generateMap(COLS, ROWS, 12345);
  assert.equal(map.cols, COLS);
  assert.equal(map.rows, ROWS);
  assert.equal(map.tiles.length, ROWS);
  for (const row of map.tiles) assert.equal(row.length, COLS);
});

test('every map contains some water', () => {
  for (const seed of [1, 2, 42, 9999, 0xdeadbeef]) {
    const stats = mapStats(generateMap(COLS, ROWS, seed));
    assert.ok(stats.water > 0, `seed ${seed} produced no water`);
  }
});

test('all tile parameters stay within [0, 1]', () => {
  const map = generateMap(COLS, ROWS, 777);
  for (const row of map.tiles) {
    for (const t of row) {
      for (const key of ['elevation', 'fertility', 'moisture', 'sunlight']) {
        assert.ok(
          t[key] >= 0 && t[key] <= 1,
          `tile (${t.x},${t.y}).${key} = ${t[key]} out of range`,
        );
      }
      assert.ok(t.type === TileType.LAND || t.type === TileType.WATER);
    }
  }
});

test('water tiles have zero fertility and full moisture', () => {
  const map = generateMap(COLS, ROWS, 555);
  for (const row of map.tiles) {
    for (const t of row) {
      if (t.type === TileType.WATER) {
        assert.equal(t.fertility, 0);
        assert.equal(t.moisture, 1);
      }
    }
  }
});

test('the same seed reproduces an identical map', () => {
  const a = generateMap(COLS, ROWS, 2024);
  const b = generateMap(COLS, ROWS, 2024);
  assert.deepEqual(a.tiles, b.tiles);
});

test('different seeds produce different maps', () => {
  const a = generateMap(COLS, ROWS, 1);
  const b = generateMap(COLS, ROWS, 2);
  assert.notDeepEqual(a.tiles, b.tiles);
});

test('mulberry32 is deterministic and bounded', () => {
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});
