/**
 * Tests for the pause between vacancies
 */
import { describe, test, assert } from 'test-anywhere';
import { DAILY_APPLICATION_LIMIT, nextVacancyAt, pauseMs, worstCaseApplicationsPerDay } from '../src/pacing.mjs';

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
    assert.equal(perDay, 288);
    assert.ok(perDay >= DAILY_APPLICATION_LIMIT * 1.25);
  });
});

describe('nextVacancyAt', () => {
  const minute = 60000;
  test('the pause counts from the start of work: an application takes under 7 minutes', () => {
    const at = nextVacancyAt({ startedAt: 0, intervalMs: DEFAULT_INTERVAL_MS, now: 2 * minute, random: () => 1 });
    assert.equal(at, 300000);
    assert.ok(at < 7 * minute);
  });

  test('a long piece of work is followed by a short gap, not a whole pause', () => {
    const at = nextVacancyAt({ startedAt: 0, intervalMs: DEFAULT_INTERVAL_MS, now: 6 * minute, random: () => 0 });
    assert.equal(at, 6 * minute + 30000);
  });
});
