// Logic tests for crop definitions. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { CROP_TYPES, CROP_IDS, getCrop, isRipe } from '../src/crops.js';

test('every crop id resolves to a crop with the required fields', () => {
  for (const id of CROP_IDS) {
    const crop = getCrop(id);
    assert.ok(crop, `no crop for ${id}`);
    assert.equal(crop.id, id);
    assert.ok(crop.label);
    assert.ok(crop.growthTime > 0);
    assert.ok(crop.yield > 0);
  }
});

test('CROP_IDS covers exactly the defined crop types', () => {
  assert.deepEqual([...CROP_IDS].sort(), Object.keys(CROP_TYPES).sort());
});

test('isRipe is true only for a fully grown crop', () => {
  assert.equal(isRipe({ kind: 'crop', growth: 1 }), true);
  assert.equal(isRipe({ kind: 'crop', growth: 1.5 }), true);
  assert.equal(isRipe({ kind: 'crop', growth: 0.5 }), false);
  assert.equal(isRipe({ kind: 'wild' }), false);
  assert.equal(isRipe(null), false);
});
