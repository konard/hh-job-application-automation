/**
 * Tests for the pause between vacancies
 */
import { describe, test, assert } from 'test-anywhere';
import { DAILY_APPLICATION_LIMIT, pauseMs, worstCaseApplicationsPerDay } from '../src/pacing.mjs';

const DEFAULT_INTERVAL_MS = 240000;

describe('pauseMs', () => {
  test('is the interval with no random extra', () => {
    assert.equal(pauseMs({ intervalMs: DEFAULT_INTERVAL_MS, random: () => 0 }), 240000);
  });

  test('adds at most a quarter of the interval', () => {
    assert.equal(pauseMs({ intervalMs: DEFAULT_INTERVAL_MS, random: () => 1 }), 300000);
  });

  test('is longer than 3 minutes by default', () => {
    assert.ok(pauseMs({ intervalMs: DEFAULT_INTERVAL_MS, random: () => 0 }) > 180000);
  });
});

describe('worstCaseApplicationsPerDay', () => {
  test('the default pace fits hh.ru\'s daily limit with room to spare', () => {
    const perDay = worstCaseApplicationsPerDay(DEFAULT_INTERVAL_MS);
    assert.equal(perDay, 261);
    assert.ok(perDay >= DAILY_APPLICATION_LIMIT * 1.25);
  });
});
