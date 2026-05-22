// Logic tests for task creation. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTask, TaskType, WORK_TYPES } from '../src/tasks.js';

test('createTask produces a queued task with the given target', () => {
  const task = createTask(TaskType.SOW, 7, 3, { cropId: 'wheat' });
  assert.equal(task.type, TaskType.SOW);
  assert.equal(task.x, 7);
  assert.equal(task.y, 3);
  assert.equal(task.cropId, 'wheat');
  assert.equal(task.status, 'queued');
  assert.equal(task.outcome, '');
});

test('a task is addressed to the whole colony by default', () => {
  const task = createTask(TaskType.MOVE, 1, 1);
  assert.equal(task.assignee, null);
});

test('each task gets a unique id', () => {
  const a = createTask(TaskType.MOVE, 0, 0);
  const b = createTask(TaskType.MOVE, 0, 0);
  assert.notEqual(a.id, b.id);
});

test('WORK_TYPES are player-placed types and exclude personal tasks', () => {
  for (const ty of WORK_TYPES) {
    assert.ok(Object.values(TaskType).includes(ty));
  }
  assert.ok(WORK_TYPES.includes(TaskType.TILL));
  assert.ok(WORK_TYPES.includes(TaskType.WATER));
  assert.ok(WORK_TYPES.includes(TaskType.HUNT));
  assert.ok(WORK_TYPES.includes(TaskType.BUILD));
  assert.ok(!WORK_TYPES.includes(TaskType.EAT));
  assert.ok(!WORK_TYPES.includes(TaskType.SLEEP));
});

test('a hunt task carries the target animal id', () => {
  const task = createTask(TaskType.HUNT, 4, 9, { animalId: 3 });
  assert.equal(task.type, TaskType.HUNT);
  assert.equal(task.animalId, 3);
  assert.equal(task.cropId, null);
});

test('a build task carries its structure and its assignee', () => {
  const task = createTask(TaskType.BUILD, 5, 5, { structure: 'fence', assignee: 'Ada' });
  assert.equal(task.type, TaskType.BUILD);
  assert.equal(task.structure, 'fence');
  assert.equal(task.assignee, 'Ada');
});
