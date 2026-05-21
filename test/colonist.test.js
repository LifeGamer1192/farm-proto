// Logic tests for the colonist's movement. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Colonist } from '../src/entities/colonist.js';
import { TileType } from '../src/map/tile.js';

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

// Advance the colonist by `seconds`, in 1/60 s steps.
function simulate(colonist, map, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) colonist.update(1 / 60, map);
}

test('a commanded colonist walks to the goal tile', () => {
  const map = makeMap(Array(6).fill('......'));
  const c = new Colonist(0, 0);
  assert.equal(c.commandTo(map, 5, 4), true);
  assert.equal(c.state, 'moving');
  simulate(c, map, 2.5);
  assert.equal(c.tileX, 5);
  assert.equal(c.tileY, 4);
  assert.equal(c.state, 'idle');
});

test('commanding an unreachable tile fails and does not move', () => {
  const map = makeMap(['...#.', '...#.', '...#.', '...#.']);
  const c = new Colonist(0, 0);
  assert.equal(c.commandTo(map, 4, 0), false);
});

test('an idle colonist wanders off on its own', () => {
  const map = makeMap(Array(12).fill('............'));
  const c = new Colonist(5, 5);
  let moved = false;
  const steps = 180; // 3 s
  for (let i = 0; i < steps; i++) {
    c.update(1 / 60, map);
    if (c.state === 'wandering' || c.x !== 5 || c.y !== 5) moved = true;
  }
  assert.ok(moved, 'colonist should move autonomously when left idle');
});

test('a command overrides autonomous wandering', () => {
  const map = makeMap(Array(10).fill('..........'));
  const c = new Colonist(0, 0);
  simulate(c, map, 2.5); // let it start wandering
  assert.equal(c.commandTo(map, 9, 9), true);
  assert.equal(c.state, 'moving');
});
