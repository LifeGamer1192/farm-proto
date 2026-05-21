// Logic tests for task creation. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTask, TaskType, TASK_LABELS } from '../src/tasks.js';

test('createTask produces a queued task with the given target', () => {
  const task = createTask(TaskType.HARVEST, 7, 3);
  assert.equal(task.type, TaskType.HARVEST);
  assert.equal(task.x, 7);
  assert.equal(task.y, 3);
  assert.equal(task.status, 'queued');
  assert.equal(task.outcome, '');
});

test('a sow task carries the crop id; others default to null', () => {
  assert.equal(createTask(TaskType.SOW, 1, 2, 'wheat').cropId, 'wheat');
  assert.equal(createTask(TaskType.MOVE, 0, 0).cropId, null);
});

test('each task gets a unique id', () => {
  const a = createTask(TaskType.MOVE, 0, 0);
  const b = createTask(TaskType.MOVE, 0, 0);
  assert.notEqual(a.id, b.id);
});

test('every task type has a display label', () => {
  for (const type of Object.values(TaskType)) {
    assert.ok(TASK_LABELS[type], `missing label for ${type}`);
  }
});
