/**
 * Tests for the pause between vacancies
 */
import { describe, test, assert } from 'test-anywhere';
import { ADAPTIVE_PACE, PACING_POLICY_VERSION, DAILY_APPLICATION_LIMIT, LIMIT_COOLDOWN_MS, adaptivePace, limitHeldUntil, nextVacancyAt, pacingResetNeeded, pauseMs, worstCaseApplicationsPerDay } from '../src/pacing.mjs';

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
  test('adaptive jitter never extends a pause beyond four minutes; explicit fixed pauses keep their extra', () => {
    assert.equal(pauseMs({ intervalMs: 230000, maxIntervalMs: ADAPTIVE_PACE.maxMs, random: () => 1 }), 240000);
    assert.equal(pauseMs({ intervalMs: 60000, maxIntervalMs: ADAPTIVE_PACE.maxMs, random: () => 1 }), 75000);
    assert.equal(pauseMs({ intervalMs: 240000, random: () => 1 }), 300000);
  });
});

describe('worstCaseApplicationsPerDay', () => {
  test('the slowest adaptive schedule leaves capacity for the 200-per-day target', () => {
    const capacity = worstCaseApplicationsPerDay(ADAPTIVE_PACE.maxMs, { maxIntervalMs: ADAPTIVE_PACE.maxMs });
    assert.equal(capacity, 360);
    assert.ok(capacity > DAILY_APPLICATION_LIMIT);
  });
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
  test('the adaptive cap includes jitter without dropping the short gap after long manual work', () => {
    assert.equal(nextVacancyAt({ startedAt: 0, intervalMs: 240000, maxIntervalMs: ADAPTIVE_PACE.maxMs, now: 120000, random: () => 1 }), 240000);
    assert.equal(nextVacancyAt({ startedAt: 0, intervalMs: 240000, maxIntervalMs: ADAPTIVE_PACE.maxMs, now: 600000, random: () => 0 }), 630000);
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

  test('a captcha adds one step (up to 4 min) and holds speed-up for 5 min', () => {
    const pace = adaptivePace([reset, captcha(1)]);
    assert.ok(pace.intervalMs >= 130000 && pace.intervalMs <= 140000);
    assert.equal(pace.holdMs, 5 * 60000);
    assert.equal(adaptivePace([reset, captcha(1), sent(5)]).intervalMs, pace.intervalMs);
    assert.ok(adaptivePace([reset, captcha(1), sent(6)]).intervalMs < pace.intervalMs);
    const top = adaptivePace([reset, ...Array.from({ length: 30 }, (_, i) => captcha(i + 1))]);
    assert.equal(top.intervalMs, ADAPTIVE_PACE.maxMs);
  });

  test('continuous captchas cannot slide the hold beyond 15 min from its first captcha', () => {
    const burst = [reset, ...Array.from({ length: 16 }, (_, i) => captcha(i + 1))];
    const held = adaptivePace(burst);
    assert.equal(held.holdUntil, Date.parse(at(16)));
    assert.equal(held.intervalMs, ADAPTIVE_PACE.maxMs);
    const resumed = adaptivePace([...burst, sent(16)]);
    assert.ok(resumed.intervalMs < held.intervalMs);
    assert.equal(resumed.holdUntil, 0);
    const anotherBurst = [...burst, sent(16), ...Array.from({ length: 16 }, (_, i) => captcha(i + 17))];
    assert.equal(adaptivePace(anotherBurst).holdUntil, Date.parse(at(32)));
    assert.ok(adaptivePace([...anotherBurst, sent(32)]).intervalMs < ADAPTIVE_PACE.maxMs);
  });

  test('a successful speed-up clears the old hold anchor, including after a long manual wait', () => {
    const state = adaptivePace([reset, captcha(1), captcha(2), sent(7), captcha(20)]);
    assert.equal(state.holdUntil, Date.parse(at(25)));
    assert.equal(state.holdMs, 5 * 60000);
    assert.equal(adaptivePace([reset, captcha(1), sent(200)]).holdUntil, 0);
  });

  test('migration starts the bounded policy once and old seven-minute reset values are clamped', () => {
    assert.equal(pacingResetNeeded([]), true);
    assert.equal(pacingResetNeeded([reset]), true);
    assert.equal(pacingResetNeeded([{ ...reset, policyVersion: PACING_POLICY_VERSION }]), false);
    assert.equal(adaptivePace([{ ...reset, intervalMs: 420000 }]).intervalMs, ADAPTIVE_PACE.maxMs);
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

describe('limitHeldUntil', () => {
  const now = Date.parse('2026-10-24T08:00:00Z');
  test('2 hours from the latest limit, also for a run started after it', () => {
    const events = [{ at: '2026-10-23T08:00:00Z', type: 'limit_reached' }, { at: '2026-10-24T07:30:00Z', type: 'limit_reached' }, { at: '2026-10-24T07:40:00Z', type: 'application_sent' }];
    assert.equal(LIMIT_COOLDOWN_MS, 2 * 60 * 60 * 1000);
    assert.equal(limitHeldUntil(events, now), Date.parse('2026-10-24T09:30:00Z'));
  });
  test('0 once it is over, or without a limit', () => {
    assert.equal(limitHeldUntil([{ at: '2026-10-24T05:59:00Z', type: 'limit_reached' }], now), 0);
    assert.equal(limitHeldUntil([], now), 0);
  });
});
