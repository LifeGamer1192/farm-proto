// Logic tests for the i18n helper. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { t, setLang, getLang } from '../src/i18n.js';

test('t returns a string and changes with the language', () => {
  setLang('en');
  assert.equal(getLang(), 'en');
  const en = t('task.sow');
  setLang('ja');
  const ja = t('task.sow');
  assert.ok(en.length > 0 && ja.length > 0);
  assert.notEqual(en, ja);
  setLang('en');
});

test('t substitutes {placeholders}', () => {
  setLang('en');
  assert.ok(t('val.day', { n: 5 }).includes('5'));
});

test('an unknown key returns the key itself', () => {
  assert.equal(t('does.not.exist'), 'does.not.exist');
});

test('an unknown language is ignored', () => {
  setLang('en');
  setLang('klingon');
  assert.equal(getLang(), 'en');
});
