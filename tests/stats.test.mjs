/**
 * Tests for the stats of the automation: events by day
 */
import { describe, test, assert } from 'test-anywhere';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captchasByPace, formatDays, readEvents, recordEvent, summarizeByDay } from '../src/stats.mjs';

describe('stats', () => {
  test('events are written as lines and read back', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stats-')), 'stats.jsonl');
    recordEvent('captcha', { ms: 1000, ai: true }, file);
    fs.appendFileSync(file, 'not json\n');
    recordEvent('application_sent', { vacancyId: '1', ms: 2000 }, file);
    assert.deepEqual(readEvents(file).map((event) => event.type), ['captcha', 'application_sent']);
  });

  test('a day is summed up', () => {
    const at = (minutes) => new Date(2026, 9, 16, 10, minutes).toISOString();
    const events = [
      { at: at(0), type: 'application_sent', ms: 60000 },
      { at: at(5), type: 'application_sent', ms: 90000 },
      { at: at(15), type: 'application_sent', ms: 400000 },
      { at: at(16), type: 'captcha', ms: 30000, ai: true },
      { at: at(17), type: 'captcha', ms: 30000, ai: false },
      { at: at(18), type: 'vacancy_skipped', reason: 'deferred' },
      { at: at(18), type: 'vacancy_skipped', reason: 'letter_not_attached' },
      { at: at(19), type: 'rejection_read', live: true },
    ];
    const [day] = summarizeByDay(events);
    assert.equal(day.day, '2026-10-16');
    assert.equal(day.applications, 3);
    assert.equal(day.typicalMs, 90000);
    assert.equal(day.longestMs, 400000);
    assert.equal(day.overTarget, 1);
    assert.equal(day.captchas, 2);
    assert.equal(day.captchasByAi, 1);
    assert.equal(day.skipped, 1);
    assert.equal(day.rejectionsLive, 1);
    assert.equal(day.perHour, 8);
    assert.ok(formatDays([day])[0].includes('3 application(s)'));
  });
});

describe('captcha stats', () => {
  const at = (minutes) => new Date(Date.UTC(2026, 9, 24, 6) + minutes * 60000).toISOString();

  test('a captcha written when shown and once gone counts once a day; one only gone counts too', () => {
    const [day] = summarizeByDay([
      { at: at(0), type: 'application_sent', vacancyId: '1', ms: 1000 },
      { at: at(1), type: 'captcha_shown', host: 'hh.ru', window: 'main' },
      { at: at(2), type: 'captcha', ms: 60000, ai: true, shown: true },
      { at: at(5), type: 'captcha', ms: 60000, ai: false },
    ]);
    assert.equal(day.captchas, 2);
    assert.equal(day.captchasByAi, 1);
    assert.ok(formatDays([day])[0].includes('200.0 per 100 applications'));
  });

  test('captchas by pace: those after each send, by its pace; older sends at the old 240 s', () => {
    const events = [
      { at: at(0), type: 'application_sent', vacancyId: '1' },
      { at: at(4), type: 'application_sent', vacancyId: '2', intervalMs: 65000 },
      { at: at(5), type: 'captcha_shown', host: 'hh.ru', window: 'chat' },
      { at: at(5.5), type: 'captcha', ms: 30000, shown: true, host: 'hh.ru' },
      { at: at(6), type: 'application_sent', vacancyId: '3', intervalMs: 80000 },
      { at: at(7), type: 'captcha_shown', host: 'forms.yandex.ru', window: 'slot' },
    ];
    assert.deepEqual(captchasByPace(events), [
      { fromMs: 60000, applications: 2, captchas: 1 },
      { fromMs: 240000, applications: 1, captchas: 0 },
    ]);
  });
});
