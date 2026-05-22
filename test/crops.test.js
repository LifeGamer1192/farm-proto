// Logic tests for crop definitions, suitability and survival.
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_TYPES,
  CROP_IDS,
  getCrop,
  isRipe,
  cropSuitability,
  survivalChance,
} from '../src/crops.js';

test('every crop id resolves to a crop with the required fields', () => {
  for (const id of CROP_IDS) {
    const crop = getCrop(id);
    assert.ok(crop, `no crop for ${id}`);
    assert.equal(crop.id, id);
    assert.ok(crop.label);
    assert.ok(crop.growthTime > 0);
    assert.ok(crop.yield > 0);
    assert.ok(crop.soil, 'crop should declare soil preferences');
  }
});

test('CROP_IDS covers exactly the defined crop types', () => {
  assert.deepEqual([...CROP_IDS].sort(), Object.keys(CROP_TYPES).sort());
});

test('isRipe is true only for a fully grown, non-withered crop', () => {
  assert.equal(isRipe({ kind: 'crop', growth: 1 }), true);
  assert.equal(isRipe({ kind: 'crop', growth: 0.5 }), false);
  assert.equal(isRipe({ kind: 'crop', growth: 1, withered: true }), false);
  assert.equal(isRipe({ kind: 'wild' }), false);
  assert.equal(isRipe(null), false);
});

test('cropSuitability blends the tile parameters and stays in 0..1', () => {
  const wheat = getCrop('wheat');
  assert.equal(cropSuitability(wheat, { fertility: 0, moisture: 0, sunlight: 0 }), 0);
  assert.equal(cropSuitability(wheat, { fertility: 1, moisture: 1, sunlight: 1 }), 1);
  const mid = cropSuitability(wheat, { fertility: 0.5, moisture: 0.5, sunlight: 0.5 });
  assert.ok(mid > 0 && mid < 1);
});

test('a richer tile suits a crop better', () => {
  const potato = getCrop('potato');
  const poor = cropSuitability(potato, { fertility: 0.2, moisture: 0.2, sunlight: 0.2 });
  const rich = cropSuitability(potato, { fertility: 0.9, moisture: 0.9, sunlight: 0.9 });
  assert.ok(rich > poor);
});

test('survival chance rises with suitability and stays in 0..1', () => {
  const low = survivalChance(0);
  const high = survivalChance(1);
  assert.ok(low >= 0 && low <= 1);
  assert.ok(high >= 0 && high <= 1);
  assert.ok(high > low);
  // Initial strains are weak: even ideal soil is not a sure thing.
  assert.ok(high < 0.75);
});

test('a tilled-soil bonus raises the survival chance', () => {
  assert.ok(survivalChance(0.5, 0.15) > survivalChance(0.5));
  assert.ok(survivalChance(1, 0.15) <= 1);
});
