// Logic tests for the colonist carrying out tasks. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Colonist } from '../src/entities/colonist.js';
import { TileType } from '../src/map/tile.js';
import { createTask, TaskType } from '../src/tasks.js';

// Build a map from ASCII rows: '.' land, '#' water, '*' land with a plant.
function makeMap(rows) {
  const tiles = rows.map((line, y) =>
    [...line].map((ch, x) => ({
      x,
      y,
      type: ch === '#' ? TileType.WATER : TileType.LAND,
      plant: ch === '*' ? { kind: 'wild' } : null,
    })),
  );
  return { cols: rows[0].length, rows: rows.length, tiles };
}

// Advance the colonist by `seconds`, in 1/60 s steps.
function simulate(colonist, map, seconds) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) colonist.update(1 / 60, map);
}

test('a move task completes once the colonist arrives', () => {
  const map = makeMap(Array(6).fill('......'));
  const c = new Colonist(0, 0);
  const task = createTask(TaskType.MOVE, 5, 4);
  c.assignTask(task, map);
  assert.equal(task.status, 'active');
  simulate(c, map, 3);
  assert.equal(task.status, 'done');
  assert.equal(c.tileX, 5);
  assert.equal(c.tileY, 4);
});

test('a harvest task walks to the plant, works, then completes', () => {
  const map = makeMap(['......', '...*..', '......']);
  const c = new Colonist(0, 0);
  const task = createTask(TaskType.HARVEST, 3, 1);
  c.assignTask(task, map);
  let sawWorking = false;
  for (let i = 0; i < 180; i++) {
    c.update(1 / 60, map);
    if (c.state === 'working') sawWorking = true;
  }
  assert.equal(task.status, 'done');
  assert.ok(sawWorking, 'colonist should pass through the working state');
  assert.equal(c.tileX, 3);
  assert.equal(c.tileY, 1);
});

test('harvesting a tile with no plant fails immediately', () => {
  const map = makeMap(Array(4).fill('....'));
  const c = new Colonist(0, 0);
  const task = createTask(TaskType.HARVEST, 2, 2);
  c.assignTask(task, map);
  assert.equal(task.status, 'failed');
  assert.match(task.outcome, /harvest/i);
});

test('planting on water fails', () => {
  const map = makeMap(['..#..', '.....']);
  const c = new Colonist(0, 0);
  const task = createTask(TaskType.PLANT, 2, 0);
  c.assignTask(task, map);
  assert.equal(task.status, 'failed');
});

test('a task targeting an unreachable tile fails', () => {
  const map = makeMap(['..#..', '..#..', '..#..']);
  const c = new Colonist(0, 0);
  const task = createTask(TaskType.MOVE, 4, 0);
  c.assignTask(task, map);
  assert.equal(task.status, 'failed');
  assert.match(task.outcome, /unreachable/i);
});

test('a colonist with no task wanders on its own', () => {
  const map = makeMap(Array(12).fill('............'));
  const c = new Colonist(5, 5);
  let moved = false;
  for (let i = 0; i < 180; i++) {
    c.update(1 / 60, map);
    if (c.state === 'wandering' || c.x !== 5 || c.y !== 5) moved = true;
  }
  assert.ok(moved, 'colonist should move autonomously when it has no task');
});
