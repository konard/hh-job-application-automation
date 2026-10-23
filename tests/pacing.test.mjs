/**
 * Tests for the pause between vacancies
 */
import { describe, test, assert } from 'test-anywhere';
import { ADAPTIVE_PACE, DAILY_APPLICATION_LIMIT, adaptivePace, nextVacancyAt, pauseMs, worstCaseApplicationsPerDay } from '../src/pacing.mjs';

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

describe('adaptivePace', () => {
  const at = (minutes) => new Date(Date.UTC(2026, 9, 24) + minutes * 60000).toISOString();
  const reset = { type: 'pacing_reset', at: at(0), intervalMs: 120000 };
  const sent = (minutes, vacancyId = String(minutes)) => ({ type: 'application_sent', at: at(minutes), vacancyId });
  const captcha = (minutes) => ({ type: 'captcha_shown', at: at(minutes), host: 'hh.ru', window: 'main' });

  test('starts at 2 min, and only once a reset is written', () => {
    assert.equal(adaptivePace([]).intervalMs, 120000);
    assert.equal(adaptivePace([sent(1)]).applications, 0);
  });

  test('each application takes 10-20 s off, down to 1 min', () => {
    const one = adaptivePace([reset, sent(1)]).intervalMs;
    assert.ok(one >= 100000 && one <= 110000);
    const many = adaptivePace([reset, ...Array.from({ length: 20 }, (_, i) => sent(i + 1))]);
    assert.equal(many.intervalMs, ADAPTIVE_PACE.minMs);
    assert.equal(many.applications, 20);
  });

  test('a captcha adds twice a step (up to 7 min) and holds the pace for 15 min', () => {
    const pace = adaptivePace([reset, captcha(1)]);
    assert.ok(pace.intervalMs >= 140000 && pace.intervalMs <= 160000);
    assert.equal(pace.holdMs, 15 * 60000);
    assert.equal(adaptivePace([reset, captcha(1), sent(5)]).intervalMs, pace.intervalMs);
    assert.ok(adaptivePace([reset, captcha(1), sent(17)]).intervalMs < pace.intervalMs);
    const top = adaptivePace([reset, ...Array.from({ length: 30 }, (_, i) => captcha(i + 1))]);
    assert.equal(top.intervalMs, ADAPTIVE_PACE.maxMs);
  });

  test('captchas that keep coming double the hold, up to a day; a quiet stretch starts it over', () => {
    assert.equal(adaptivePace([reset, captcha(1), captcha(20)]).holdMs, 30 * 60000);
    assert.equal(adaptivePace([reset, captcha(1), captcha(20), captcha(70)]).holdMs, 60 * 60000);
    const burst = [reset, ...Array.from({ length: 12 }, (_, i) => captcha(i + 1))];
    assert.equal(adaptivePace(burst).holdMs, ADAPTIVE_PACE.maxHoldMs);
    assert.equal(adaptivePace([reset, captcha(1), captcha(200)]).holdMs, 15 * 60000);
  });

  test('a captcha counts once, on hh.ru only, from the last reset', () => {
    const shownThenGone = [reset, captcha(1), { type: 'captcha', at: at(2), ms: 60000, shown: true, host: 'hh.ru' }];
    assert.equal(adaptivePace(shownThenGone).captchas, 1);
    assert.equal(adaptivePace([reset, { type: 'captcha', at: at(2), ms: 60000 }]).captchas, 1);
    assert.equal(adaptivePace([reset, { ...captcha(1), host: 'forms.yandex.ru' }]).captchas, 0);
    assert.equal(adaptivePace([captcha(1), reset]).captchas, 0);
    assert.equal(adaptivePace([reset, sent(1)]).intervalMs, adaptivePace([reset, sent(1)]).intervalMs);
  });
});
