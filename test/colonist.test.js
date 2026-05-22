// Logic tests for a colonist carrying out tasks. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Colonist } from '../src/entities/colonist.js';
import { TileType } from '../src/map/tile.js';
import { createTask, TaskType } from '../src/tasks.js';

// '.' land, '#' water, '*' land with a wild plant.
function makeMap(rows) {
  const tiles = rows.map((line, y) =>
    [...line].map((ch, x) => ({
      x,
      y,
      type: ch === '#' ? TileType.WATER : TileType.LAND,
      plant: ch === '*' ? { kind: 'wild' } : null,
      tilled: false,
    })),
  );
  return { cols: rows[0].length, rows: rows.length, tiles };
}

function simulate(colonist, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) colonist.update(1 / 60);
}

test('a move task completes once the colonist arrives', () => {
  const map = makeMap(Array(6).fill('......'));
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.MOVE, 5, 4);
  c.assignTask(task, map);
  simulate(c, 3);
  assert.equal(task.status, 'done');
  assert.equal(c.tileX, 5);
  assert.equal(c.tileY, 4);
});

test('a harvest task on a wild plant runs to completion', () => {
  const map = makeMap(['......', '...*..', '......']);
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.HARVEST, 3, 1);
  c.assignTask(task, map);
  simulate(c, 3);
  assert.equal(task.status, 'done');
});

test('harvesting an unripe crop fails', () => {
  const map = makeMap(Array(5).fill('.....'));
  map.tiles[2][3].plant = { kind: 'crop', cropId: 'bean', growth: 0.5 };
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.HARVEST, 3, 2);
  c.assignTask(task, map);
  assert.equal(task.status, 'failed');
  assert.equal(task.outcome, 'notRipe');
});

test('a withered crop may be harvested (to clear the husk)', () => {
  const map = makeMap(Array(5).fill('.....'));
  map.tiles[2][3].plant = { kind: 'crop', cropId: 'bean', growth: 0.6, withered: true };
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.HARVEST, 3, 2);
  c.assignTask(task, map);
  assert.notEqual(task.status, 'failed');
});

test('sowing on water fails', () => {
  const map = makeMap(['..#..', '.....']);
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.SOW, 2, 0, 'wheat');
  c.assignTask(task, map);
  assert.equal(task.status, 'failed');
  assert.equal(task.outcome, 'onWater');
});

test('a till task on land completes', () => {
  const map = makeMap(Array(5).fill('.....'));
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.TILL, 3, 2);
  c.assignTask(task, map);
  simulate(c, 3);
  assert.equal(task.status, 'done');
});

test('a water task fails where there is no crop', () => {
  const map = makeMap(Array(5).fill('.....'));
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.WATER, 3, 2);
  c.assignTask(task, map);
  assert.equal(task.status, 'failed');
  assert.equal(task.outcome, 'noCrop');
});

test('a personal eat task completes after its work phase', () => {
  const map = makeMap(Array(4).fill('....'));
  const c = new Colonist(1, 1, 'A');
  const task = createTask(TaskType.EAT, 1, 1);
  c.assignTask(task, map);
  simulate(c, 3);
  assert.equal(task.status, 'done');
});

test('an unreachable task fails', () => {
  const map = makeMap(['..#..', '..#..', '..#..']);
  const c = new Colonist(0, 0, 'A');
  const task = createTask(TaskType.MOVE, 4, 0);
  c.assignTask(task, map);
  assert.equal(task.status, 'failed');
  assert.equal(task.outcome, 'unreachable');
});

// --- survival stats (alpha 7) --------------------------------------------

test('a colonist grows hungrier as time passes', () => {
  const c = new Colonist(0, 0, 'A');
  const before = c.hunger;
  simulate(c, 10);
  assert.ok(c.hunger > before);
});

test('a starving colonist loses health', () => {
  const c = new Colonist(0, 0, 'A');
  c.hunger = 1;
  simulate(c, 5);
  assert.ok(c.health < 1);
});

test('a well-fed colonist recovers lost health', () => {
  const c = new Colonist(0, 0, 'A');
  c.health = 0.5;
  c.hunger = 0;
  simulate(c, 5);
  assert.ok(c.health > 0.5);
});

test('an animal attack hurts a colonist; enough attacks are fatal', () => {
  const c = new Colonist(0, 0, 'A');
  c.hurt(0.3);
  assert.ok(c.health < 1);
  assert.equal(c.dead, false);
  c.hurt(1);
  assert.equal(c.health, 0);
  assert.equal(c.dead, true);
});

test('a colonist that starves to death is marked dead', () => {
  const c = new Colonist(0, 0, 'A');
  c.hunger = 1;
  c.health = 0.02;
  simulate(c, 5);
  assert.equal(c.dead, true);
});
