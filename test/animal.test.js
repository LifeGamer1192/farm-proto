// Logic tests for a wild animal. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Animal } from '../src/entities/animal.js';
import { TileType } from '../src/map/tile.js';

// '.' land, '#' water.
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

test('an animal eventually strolls away from its starting tile', () => {
  const map = makeMap(Array(12).fill('.'.repeat(12)));
  const a = new Animal(6, 6, 1);
  const startX = a.x;
  const startY = a.y;
  // PAUSE is a few sim-seconds; run well past it so it picks a path and walks.
  for (let i = 0; i < 60 * 20; i++) a.update(1 / 60, map);
  assert.ok(a.x !== startX || a.y !== startY);
});

test("an animal's attack cooldown counts down over time", () => {
  const map = makeMap(Array(6).fill('......'));
  const a = new Animal(2, 2, 1);
  a.attackCooldown = 5;
  a.update(1, map);
  assert.ok(a.attackCooldown <= 4);
});

test('an animal stays on land, never stepping onto water', () => {
  const map = makeMap(['............', '............', '....######..', '............']);
  const a = new Animal(1, 1, 1);
  for (let i = 0; i < 60 * 30; i++) {
    a.update(1 / 60, map);
    assert.notEqual(map.tiles[a.tileY][a.tileX].type, TileType.WATER);
  }
});
