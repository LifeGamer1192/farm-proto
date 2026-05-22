// Logic tests for the season clock and weather. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clockInfo,
  temperatureAt,
  daylightAt,
  tempGrowthFactor,
  sunGrowthFactor,
  SEASON_LENGTH,
} from '../src/season.js';

test('the clock advances through seasons and years', () => {
  assert.equal(clockInfo(0).season, 'spring');
  assert.equal(clockInfo(0).year, 1);
  assert.equal(clockInfo(SEASON_LENGTH * 1.5).season, 'summer');
  assert.equal(clockInfo(SEASON_LENGTH * 2.5).season, 'autumn');
  assert.equal(clockInfo(SEASON_LENGTH * 3.5).season, 'winter');

  const nextYear = clockInfo(SEASON_LENGTH * 4);
  assert.equal(nextYear.season, 'spring');
  assert.equal(nextYear.year, 2);
});

test('the day stays within 1..DAYS_PER_SEASON', () => {
  for (let t = 0; t < SEASON_LENGTH; t += SEASON_LENGTH / 50) {
    const day = clockInfo(t).day;
    assert.ok(day >= 1 && day <= 10);
  }
});

test('temperature is warm near summer and cold near winter', () => {
  const summer = temperatureAt(0.25); // spring→summer turn (warmest)
  const winter = temperatureAt(0.75); // autumn→winter turn (coldest)
  assert.ok(summer > 20, `expected a warm summer, got ${summer}`);
  assert.ok(winter < 5, `expected a cold winter, got ${winter}`);
});

test('daylight stays within 0..1 all year', () => {
  for (let yp = 0; yp <= 1.0001; yp += 0.05) {
    const d = daylightAt(yp);
    assert.ok(d >= 0 && d <= 1, `daylight ${d} out of range at ${yp}`);
  }
});

test('crops are dormant when freezing and full speed when mild', () => {
  assert.equal(tempGrowthFactor(-5), 0);
  assert.equal(tempGrowthFactor(0), 0);
  assert.equal(tempGrowthFactor(20), 1);
  const cool = tempGrowthFactor(9);
  assert.ok(cool > 0 && cool < 1);
});

test('sunlight factor rises with tile sunlight and with daylight', () => {
  assert.ok(sunGrowthFactor(1, 1) > sunGrowthFactor(0.2, 1));
  assert.ok(sunGrowthFactor(1, 1) > sunGrowthFactor(1, 0.5));
  const f = sunGrowthFactor(0.5, 0.8);
  assert.ok(f >= 0 && f <= 1);
});
