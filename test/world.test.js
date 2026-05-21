// Logic tests for world contents (plants). Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMap } from '../src/map/mapGenerator.js';
import { scatterPlants } from '../src/world.js';
import { TileType } from '../src/map/tile.js';

test('scatterPlants places plants only on land', () => {
  const map = generateMap(40, 40, 4321);
  const placed = scatterPlants(map);
  assert.ok(placed > 0, 'expected some plants to be placed');
  for (const row of map.tiles) {
    for (const t of row) {
      if (t.plant) assert.equal(t.type, TileType.LAND);
    }
  }
});

test('scatterPlants is deterministic for a given seed', () => {
  const a = generateMap(40, 40, 99);
  const b = generateMap(40, 40, 99);
  scatterPlants(a);
  scatterPlants(b);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      assert.equal(!!a.tiles[y][x].plant, !!b.tiles[y][x].plant);
    }
  }
});
