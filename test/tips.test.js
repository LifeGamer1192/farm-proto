// Logic tests for the alpha-15 tip pool. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { TIPS, CATS, randomTipIndex } from '../src/tips.js';

test('the tip pool is sizeable and every tip is well-formed', () => {
  assert.ok(TIPS.length >= 90, `expected about 100 tips, got ${TIPS.length}`);
  for (const tip of TIPS) {
    assert.ok(CATS.includes(tip.cat), `unknown category: ${tip.cat}`);
    assert.ok(typeof tip.en === 'string' && tip.en.length > 0, 'a tip needs English text');
    assert.ok(typeof tip.ja === 'string' && tip.ja.length > 0, 'a tip needs Japanese text');
  }
});

test('all three tip categories are represented', () => {
  for (const cat of CATS) {
    assert.ok(
      TIPS.some((tip) => tip.cat === cat),
      `no tips in category ${cat}`,
    );
  }
});

test('randomTipIndex stays in range and avoids the excluded index', () => {
  for (let i = 0; i < 80; i++) {
    const idx = randomTipIndex(5);
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < TIPS.length, `idx ${idx} out of range`);
    assert.notEqual(idx, 5, 'next tip should differ from the current one');
  }
});
