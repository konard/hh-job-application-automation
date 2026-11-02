import { describe, test, expect } from 'bun:test';
import { applicationStateReadError, isApplicationStateNavigation, isDailyApplicationLimit, prepareApplicationLimit, waitForApplicationLimit, createDailyLimitPriority } from '../src/application-limits.mjs';
import { createSubmissionRetries, deferFailedSubmission } from '../src/submission-retries.mjs';
import { LIMIT_COOLDOWN_MS, limitHeldUntil } from '../src/pacing.mjs';
import { waitForManualResponse } from '../src/vacancy-response.mjs';
import { waitForApplicationModal } from '../src/vacancies.mjs';
import { createOrchestrator } from '../src/orchestrator.mjs';
import { withCaptchaGuard } from '../src/captcha.mjs';

const url = 'https://hh.ru/applicant/vacancy_response?vacancyId=123';
function fixture() {
  const events = [], actions = [];
  let now = 1000, currentUrl = url;
  let error = { code: 'negotiations-limit-exceeded', text: 'Daily application limit reached',
    url, vacancyId: '123', documentId: 'document-1', hasForm: true };
  const commander = { getUrl: () => currentUrl,
    safeEvaluate: async ({ operationName, defaultValue }) => ({ value: operationName === 'daily application limit check' || operationName === 'popup error check' ? error : defaultValue }),
    wait: async ({ ms }) => { actions.push(['wait', ms]); now += ms; },
    goto: async ({ url }) => { actions.push(['goto', url]); currentUrl = url; } };
  const options = { commander, getEvents: () => events, now: () => now,
    saveAnswers: async () => { actions.push(['answers']); }, saveDraft: async () => { actions.push(['draft']); },
    record: (type, data) => { actions.push(['event']); events.push({ type, at: new Date(now).toISOString(), ...data }); } };
  return { commander, options, events, actions, setError: (value) => { error = value; }, getError: () => error,
    now: () => now, advance: (ms) => { now += ms; }, navigate: (url) => { currentUrl = url; } };
}

describe('account-wide application limits', () => {
  test('a recorded active hold survives a hidden banner/restart without affecting login or extending expiry', async () => {
    let time = 1000, saves = 0, silenced = 0;
    const events = [{ type: 'limit_reached', at: new Date(time).toISOString(), until: 61000 }];
    const commander = { getUrl: () => url, safeEvaluate: async () => ({ value: { hasForm: false } }) };
    const hooks = createDailyLimitPriority({ prepare: async () => null, getEvents: () => events, now: () => time,
      saveAnswers: async () => { saves++; }, silence: () => { silenced++; }, log: () => {} });
    expect(await hooks.onDailyLimit(commander)).toMatchObject({ status: 'daily_limit', until: 61000, visible: false });
    expect(saves).toBe(1);
    expect(silenced).toBe(1);
    expect(await hooks.onDailyLimit({ ...commander, getUrl: () => 'https://hh.ru/account/login' })).toBeNull();
    time = 61001;
    expect(await hooks.onDailyLimit(commander)).toBeNull();
    expect(events).toHaveLength(1);
  });

  test('the application loop reevaluates an interrupted action instead of dying or counting it as sent', async () => {
    let waits = 0;
    const commander = { getUrl: () => 'https://hh.ru/search/vacancy?resume=ru',
      shouldAbort: () => false, safeEvaluate: async ({ defaultValue }) => ({ value: defaultValue }),
      wait: async () => {
        if (++waits === 1) throw Object.assign(new Error('Account pause interrupted the action'), { code: 'DAILY_APPLICATION_LIMIT_INTERRUPTED' });
        throw new Error('Finished observing resumed loop');
      } };
    const worker = createOrchestrator({ commander, page: {}, argv: { jobApplicationInterval: 60, browserPort: 9573 },
      qaDB: { addOrUpdateQA: async () => {} }, getEvents: () => [{ type: 'limit_reached', until: Date.now() + 60000 }] });
    await expect(worker.runMainLoop()).rejects.toThrow('Finished observing resumed loop');
    expect(waits).toBe(2);
  });
  test('CAPTCHA priority saves before dismissal, silences alerts and shares one account hold', async () => {
    const f = fixture();
    const safe = f.commander.safeEvaluate;
    let dismissed = false, waited = 0, finish;
    f.commander.safeEvaluate = async options => options.operationName === 'dismiss captcha for daily application limit'
      ? (f.actions.push(['dismiss']), { value: { captchaCloseRequested: !dismissed && (dismissed = true) } }) : safe(options);
    const hooks = createDailyLimitPriority({ prepare: args => prepareApplicationLimit({ ...f.options, ...args }),
      saveAnswers: async raw => { expect(raw).toBe(f.commander); f.actions.push(['answers']); },
      silence: () => f.actions.push(['silence']), record: () => {}, log: () => {},
      wait: async () => { waited++; await new Promise(resolve => { finish = resolve; }); },
    });
    const limit = await hooks.onDailyLimit(f.commander);
    expect(f.actions.map(([name]) => name)).toEqual(['answers', 'draft', 'event', 'silence', 'dismiss']);
    const first = hooks.waitForDailyLimit(f.commander, limit);
    const second = hooks.waitForDailyLimit(f.commander, limit);
    expect(first).toBe(second);
    expect(waited).toBe(1);
    finish(); await first;
    expect(await hooks.onDailyLimit({ getUrl: () => 'https://example.test/' })).toBeNull();
  });
  test('uses the canonical code and Russian/English errors, without treating other limits as the daily limit', () => {
    for (const error of [
      { code: 'negotiations-limit-exceeded', text: 'Localized text can change' },
      { text: 'You cannot send more than 200 applications per 24-hour period. You have reached your application limit, try sending a new application later.' },
      { text: 'Превышен лимит: не более 200 откликов за сутки.' },
      { text: 'Daily application limit reached' },
    ]) expect(isDailyApplicationLimit(error)).toBe(true);
    for (const error of [null, { code: 'unknown', text: 'An error occurred' },
      { code: 'too-many-requests', text: 'Too many requests; wait 200 seconds' },
      { text: 'Application letter must have no more than 200 characters' },
      { text: 'You cannot send more than 200 characters in an application' },
      { text: 'You cannot send more than 200 applications per hour' },
      { text: '200 applications supported; 24-hour customer service available' },
      { text: 'Salary limit 200000 rubles per month' },
    ]) expect(isDailyApplicationLimit(error)).toBe(false);
  });

  test('saves answers and full recovery data before recording a pause, without closing the form or retrying', async () => {
    const f = fixture();
    const limit = await prepareApplicationLimit(f.options);
    expect(f.actions.map(([name]) => name)).toEqual(['answers', 'draft', 'event']);
    expect(limit).toMatchObject({ status: 'daily_limit', until: 1000 + LIMIT_COOLDOWN_MS, vacancyId: '123', visible: true });
    expect(f.commander.getUrl()).toBe(url);
    expect(f.events).toHaveLength(1);
    const retries = createSubmissionRetries();
    expect(await deferFailedSubmission({ commander: f.commander, retries,
      saveAnswers: () => { throw new Error('Daily limits must bypass generic RAM deferral'); } })).toBe(false);
    expect(retries.ids()).toEqual([]);
  });

  test('polling and a restarted worker reuse the same deadline, even if the stale error outlives it', async () => {
    const f = fixture();
    const first = await prepareApplicationLimit(f.options);
    f.advance(60000);
    expect((await prepareApplicationLimit(f.options)).until).toBe(first.until);
    expect(f.events).toHaveLength(1);
    const restarted = { ...f.commander };
    expect((await prepareApplicationLimit({ ...f.options, commander: restarted })).until).toBe(first.until);
    expect(f.events).toHaveLength(1);
    f.advance(LIMIT_COOLDOWN_MS);
    expect((await prepareApplicationLimit({ ...f.options, forceCapture: true })).until).toBe(first.until);
    expect(limitHeldUntil(f.events, f.now())).toBe(0);
    // A fresh server refusal in a new document is a new episode, not a stale banner.
    f.setError({ ...f.getError(), documentId: 'document-2' });
    expect((await prepareApplicationLimit(f.options)).until).toBe(f.now() + LIMIT_COOLDOWN_MS);
    expect(f.events).toHaveLength(2);
  });

  test('another document or vacancy cannot extend an active account pause, including legacy events', async () => {
    const f = fixture();
    f.events.push({ type: 'limit_reached', at: new Date(f.now() - 1000).toISOString() });
    const until = limitHeldUntil(f.events, f.now());
    expect((await prepareApplicationLimit(f.options)).until).toBe(until);
    f.advance(3000);
    f.setError({ ...f.getError(), documentId: 'other-document', vacancyId: '456' });
    expect((await prepareApplicationLimit(f.options)).until).toBe(until);
    expect(limitHeldUntil(f.events, f.now())).toBe(until);
  });

  test('a standalone limit has no form to back up, but still holds the account', async () => {
    const f = fixture();
    f.setError({ ...f.getError(), hasForm: false, vacancyId: null, url: 'https://hh.ru/search/vacancy' });
    f.navigate('https://hh.ru/search/vacancy');
    const result = await prepareApplicationLimit(f.options);
    expect(result.status).toBe('daily_limit');
    expect(f.actions.map(([name]) => name)).toEqual(['answers', 'event']);
  });

  test('failed saving or changed pages never navigate or claim a safe retry', async () => {
    const f = fixture();
    await expect(prepareApplicationLimit({ ...f.options, saveDraft: async () => { throw new Error('Disk full'); } })).rejects.toThrow('Disk full');
    expect(f.events).toEqual([]);
    expect(f.commander.getUrl()).toBe(url);
    expect(await prepareApplicationLimit({ ...f.options, saveAnswers: async () => { f.navigate('https://hh.ru/chat/42'); } })).toBe(null);
    expect(f.events).toEqual([]);
  });

  test('concurrent error observers share one capture', async () => {
    const f = fixture();
    const results = await Promise.all([prepareApplicationLimit(f.options), prepareApplicationLimit(f.options)]);
    expect(results[0]).toBe(results[1]);
    expect(f.actions.map(([name]) => name)).toEqual(['answers', 'draft', 'event']);
  });

  test('the paused form stays untouched until expiry, then is backed up again before refreshing', async () => {
    const f = fixture();
    const limit = await prepareApplicationLimit(f.options);
    f.actions.length = 0;
    const resumed = await waitForApplicationLimit({ ...f.options, limit, prepare: (args) => prepareApplicationLimit({ ...f.options, ...args }) });
    expect(resumed).toBe(true);
    const waits = f.actions.filter(([name]) => name === 'wait');
    expect(waits.every(([, ms]) => ms <= 30000)).toBe(true);
    expect(waits.reduce((sum, [, ms]) => sum + ms, 0)).toBe(LIMIT_COOLDOWN_MS);
    expect(f.actions.slice(-3).map(([name]) => name)).toEqual(['answers', 'draft', 'goto']);
    expect(f.events).toHaveLength(1);
  });

  test('navigation/closure during the pause does not pull the user back', async () => {
    for (const close of [false, true]) {
      const f = fixture();
      const limit = await prepareApplicationLimit(f.options);
      let closed = false;
      f.commander.wait = async () => { if (close) closed = true; else f.navigate('https://hh.ru/chat/42'); };
      expect(await waitForApplicationLimit({ ...f.options, limit, isPageClosed: () => closed })).toBe(false);
      expect(f.actions.some(([name]) => name === 'goto')).toBe(false);
    }
  });

  test('a dismissed error at expiry does not refresh a now-edited or submitted form', async () => {
    const f = fixture();
    const limit = await prepareApplicationLimit(f.options);
    f.setError(null);
    f.advance(LIMIT_COOLDOWN_MS);
    expect(await waitForApplicationLimit({ ...f.options, limit, prepare: (args) => prepareApplicationLimit({ ...f.options, ...args }) })).toBe(true);
    expect(f.actions.some(([name]) => name === 'goto')).toBe(false);
  });

  test('native manual submissions can report a daily limit instead of waiting forever for success', async () => {
    const f = fixture();
    expect(await waitForManualResponse({ commander: f.commander })).toBe('daily_limit');
    expect(f.actions).toEqual([]);
  });

  test('a standalone alert is recognized before waiting for a nonexistent application popup', async () => {
    const f = fixture();
    expect(await waitForApplicationModal({ commander: f.commander })).toEqual({ appeared: false, limitError: true, status: 'limit_error' });
    expect(f.actions).toEqual([]);
  });

  test('expected navigation remains distinguishable from a real unreadable state', () => {
    const interrupted = applicationStateReadError({ getUrl: () => url }, { navigationError: true }, url);
    const unreadable = applicationStateReadError({ getUrl: () => url }, {}, url);
    expect(interrupted.expectedNavigation).toBe(true);
    expect(isApplicationStateNavigation(interrupted)).toBe(true);
    expect(unreadable.expectedNavigation).toBe(false);
    expect(isApplicationStateNavigation(unreadable)).toBe(false);
    expect(isApplicationStateNavigation({ expectedNavigation: true })).toBe(false);
  });

  test('a guarded daily-limit read interrupted by navigation does not terminate or resume the queued action', async () => {
    let checks = 0, sent = 0;
    const actions = [];
    const raw = { getUrl: () => 'https://hh.ru/search/vacancy?resume=ru', shouldAbort: () => false,
      safeEvaluate: async ({ operationName, defaultValue }) => {
        if (operationName === 'daily application limit check' && ++checks === 1) {
          return { success: false, navigationError: true, value: null };
        }
        return { success: true, value: defaultValue };
      },
      wait: async () => { throw new Error('Finished observing recovered loop'); },
      goto: async () => actions.push('navigate'), clickButton: async () => actions.push('submit'),
    };
    const hooks = createDailyLimitPriority({ getEvents: () => [], record: () => {}, log: () => {} });
    const commander = withCaptchaGuard(raw, hooks);
    const worker = createOrchestrator({ commander, page: {}, argv: { jobApplicationInterval: 60, browserPort: 9573 },
      qaDB: { addOrUpdateQA: async () => actions.push('save') }, getEvents: () => [], onApplicationSent: () => sent++ });
    await expect(worker.runMainLoop()).rejects.toThrow('Finished observing recovered loop');
    expect(checks).toBeGreaterThan(1);
    expect(actions).toEqual([]);
    expect(sent).toBe(0);
  });

  test('a failed application-state read without navigation evidence still stops before any page action', async () => {
    const actions = [];
    const commander = { getUrl: () => 'https://hh.ru/search/vacancy?resume=ru', shouldAbort: () => false,
      safeEvaluate: async () => ({ success: false, navigationError: false, value: null }),
      wait: async () => actions.push('wait'), goto: async () => actions.push('navigate'),
    };
    const worker = createOrchestrator({ commander, page: {}, argv: { jobApplicationInterval: 60, browserPort: 9573 },
      qaDB: { addOrUpdateQA: async () => {} }, getEvents: () => [] });
    await expect(worker.runMainLoop()).rejects.toThrow('Could not read application errors');
    expect(actions).toEqual([]);
  });

  test('a restarted orchestrator blocks both search and open-form routes even without a visible banner', async () => {
    for (const formOpen of [false, true]) {
      const future = Date.now() + 120000;
      let waits = 0;
      const touched = [];
      const commander = {
        getUrl: () => formOpen ? url : 'https://hh.ru/search/vacancy?resume=ru', shouldAbort: () => false,
        safeEvaluate: async ({ defaultValue }) => ({ value: defaultValue }), evaluate: async () => [],
        goto: async () => { touched.push('navigation'); }, count: async () => { touched.push('element lookup'); return 0; },
        clickButton: async () => { touched.push('click'); },
        wait: async ({ reason }) => {
          expect(reason).toBe('daily application limit cooldown');
          waits++;
          // Interrupting an action must not let the full-form handler pass the account gate.
          if (waits === 1) return { aborted: true };
          throw new Error('Finished observing the held worker');
        },
      };
      const worker = createOrchestrator({ commander, page: {}, argv: { url: 'https://hh.ru/search/vacancy?resume=ru', jobApplicationInterval: 60, browserPort: 9573 },
        qaDB: { addOrUpdateQA: async () => {} }, getEvents: () => [{ type: 'limit_reached', at: new Date().toISOString(), until: future }] });
      await expect(worker.runMainLoop()).rejects.toThrow('Finished observing the held worker');
      expect(waits).toBe(2);
      expect(touched).toEqual([]);
    }
  });
});
