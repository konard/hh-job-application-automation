/**
 * Tests for the captcha guard: detection, and no page actions while a captcha is shown
 */
import { describe, test, assert } from 'test-anywhere';
import {
  CAPTCHA_SELECTORS, CAPTCHA_TEXTS, captchaPlace, isCaptchaShown, pageShowsCaptcha, waitWhileCaptcha, withCaptchaGuard,
  isDailyLimitInterrupted,
} from '../src/captcha.mjs';

/** Minimal document: body text plus elements by selector, each visible or not */
function fakeDocument({ text = '', elements = {}, frames = [] } = {}) {
  const element = (visible) => ({ getClientRects: () => (visible ? [{}] : []), visible });
  return {
    body: { innerText: text },
    querySelectorAll: (selector) => (selector === 'iframe'
      ? frames.map((doc) => ({ contentDocument: doc }))
      : (elements[selector] ?? []).map(element)),
  };
}

function runInPage(doc) {
  globalThis.document = doc;
  globalThis.window = { getComputedStyle: (element) => ({ visibility: element.visible ? 'visible' : 'hidden' }) };
  try {
    return pageShowsCaptcha({ texts: CAPTCHA_TEXTS, selectors: CAPTCHA_SELECTORS });
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
}

describe('pageShowsCaptcha', () => {
  test('detects the hh.ru captcha dialog by its text', () => {
    assert.equal(runInPage(fakeDocument({ text: 'Пройдите капчу\nЧтобы подтвердить, что вы не робот, введите текст с картинки:' })), true);
  });

  test('detects a visible captcha answer field', () => {
    assert.equal(runInPage(fakeDocument({ elements: { 'input[placeholder="Текст с картинки"]': [true] } })), true);
  });

  test('ignores hidden captcha elements', () => {
    assert.equal(runInPage(fakeDocument({ elements: { '[data-qa*="captcha" i]': [false] } })), false);
  });

  test('detects a captcha in a same-origin frame', () => {
    assert.equal(runInPage(fakeDocument({ frames: [fakeDocument({ text: 'Пройдите капчу' })] })), true);
  });

  test('a normal application form is not a captcha', () => {
    assert.equal(runInPage(fakeDocument({ text: 'Отклик на вакансию\nСопроводительное письмо\nОткликнуться' })), false);
  });
});

/** Commander whose page shows a captcha for the first `checks` checks */
function fakeCommander({ checks = 0, url = 'https://hh.ru/search/vacancy' } = {}) {
  const calls = [];
  let left = checks;
  return {
    calls,
    getUrl: () => url,
    safeEvaluate: async () => ({ value: left-- > 0 }),
    clickButton: async (options) => {
      calls.push(['clickButton', left]);
      return options;
    },
    goto: async () => calls.push(['goto', left]),
    evaluate: async () => calls.push(['evaluate', left]),
    count: async () => 1,
  };
}

describe('captcha guard', () => {
  test('a disappearing CAPTCHA with a simultaneous refusal is not reported as solved', async () => {
    const commander = fakeCommander({ checks: 1 });
    let checks = 0;
    const limit = { status: 'daily_limit', until: 10000 };
    const result = await waitWhileCaptcha(commander, { onDailyLimit: async () => ++checks >= 2 ? limit : null });
    assert.equal(result, limit);
  });
  test('daily limits cancel queued actions before CAPTCHA assistance or attention notifications', async () => {
    const commander = fakeCommander({ checks: 100 });
    let assisted = 0, alerts = 0, held = 0;
    const limit = { status: 'daily_limit', until: 10000 };
    const guarded = withCaptchaGuard(commander, {
      onDailyLimit: async () => limit,
      waitForDailyLimit: async () => { held++; },
      onCaptcha: async () => { assisted++; }, alert: () => { alerts++; return () => {}; },
    });
    let error;
    try { await guarded.clickButton({ selector: 'button[type=submit]' }); } catch (caught) { error = caught; }
    assert.equal(isDailyLimitInterrupted(error), true);
    assert.equal(error.expectedNavigation, true);
    assert.equal(held, 1);
    assert.equal(assisted, 0);
    assert.equal(alerts, 0);
    assert.deepEqual(commander.calls, []);
  });

  test('a daily limit appearing during a CAPTCHA wait ends its notification without reporting a solve', async () => {
    const commander = fakeCommander({ checks: 100 });
    let checks = 0, closedAlerts = 0, pauses = 0;
    const limit = { status: 'daily_limit', until: 10000 };
    const result = await waitWhileCaptcha(commander, { alertDelayMs: 0,
      onDailyLimit: async () => ++checks >= 3 ? limit : null,
      alert: () => () => { closedAlerts++; },
      pause: async ms => { assert.ok(ms <= 1000); pauses++; },
    });
    assert.equal(result, limit);
    assert.equal(closedAlerts, 1);
    assert.equal(pauses, 1);
    assert.deepEqual(commander.calls, []);
  });
  test('attention notifications wait for background work to settle and only appear if manual input remains', async () => {
    let shown = true, time = 0, ticks = 0, alerts = 0, working = true;
    let finish;
    const processing = new Promise((resolve) => { finish = () => { working = false; resolve(); }; });
    const commander = { getUrl: () => 'https://hh.ru/search/vacancy', safeEvaluate: async () => ({ value: shown }) };
    await waitWhileCaptcha(commander, {
      pollMs: 1, alertDelayMs: 2, now: () => time,
      onCaptcha: () => processing,
      alert: () => { assert.equal(working, false); alerts++; return () => {}; },
      pause: async () => {
        time++; ticks++;
        if (ticks <= 3) assert.equal(alerts, 0);
        if (ticks === 3) finish();
        if (ticks === 6) shown = false;
        await Promise.resolve(); await Promise.resolve();
      },
    });
    assert.equal(alerts, 1);
  });

  test('a page cleared before manual attention is needed produces no notification', async () => {
    let shown = true, alerts = 0;
    const commander = { getUrl: () => 'https://hh.ru/search/vacancy', safeEvaluate: async () => ({ value: shown }) };
    await waitWhileCaptcha(commander, { pollMs: 1, alertDelayMs: 0,
      onCaptcha: async () => { shown = false; }, alert: () => { alerts++; return () => {}; },
      pause: async () => { await Promise.resolve(); await Promise.resolve(); } });
    assert.equal(alerts, 0);
  });

  test('isCaptchaShown recognises a captcha page by its URL', async () => {
    assert.equal(await isCaptchaShown(fakeCommander({ url: 'https://hh.ru/account/captcha?backurl=%2F' })), true);
  });

  test('waitWhileCaptcha returns false right away without a captcha', async () => {
    assert.equal(await waitWhileCaptcha(fakeCommander(), { pollMs: 1 }), false);
  });

  test('an action waits until the captcha is gone', async () => {
    const commander = fakeCommander({ checks: 3 });
    const guarded = withCaptchaGuard(commander, { pollMs: 1 });
    await guarded.clickButton({ selector: 'button' });
    // Checked 4 times: 3 with the captcha, then clear; the click happened only after that
    assert.deepEqual(commander.calls, [['clickButton', -1]]);
  });

  test('navigation waits too', async () => {
    const commander = fakeCommander({ checks: 1 });
    await withCaptchaGuard(commander, { pollMs: 1 }).goto({ url: 'https://hh.ru' });
    assert.deepEqual(commander.calls, [['goto', -1]]);
  });

  test('page scripts wait too, since they also click', async () => {
    const commander = fakeCommander({ checks: 2 });
    await withCaptchaGuard(commander, { pollMs: 1 }).evaluate({ fn: () => {} });
    assert.deepEqual(commander.calls, [['evaluate', -1]]);
  });

  test('read-only methods are not wrapped', async () => {
    const commander = fakeCommander({ checks: 100 });
    assert.equal(await withCaptchaGuard(commander, { pollMs: 1 }).count({ selector: 'a' }), 1);
  });

  test('concurrent actions share one wait', async () => {
    const commander = fakeCommander({ checks: 2 });
    const guarded = withCaptchaGuard(commander, { pollMs: 1 });
    await Promise.all([guarded.clickButton({}), guarded.goto({})]);
    assert.equal(commander.calls.length, 2);
    assert.ok(commander.calls.every(([, left]) => left < 0));
  });
});

describe('captchaPlace', () => {
  test('the site, page and window, never the query', () => {
    assert.deepEqual(captchaPlace('https://hh.ru/account/captcha?backurl=%2Fsearch%3Ftext%3Dme', 'main'), { host: 'hh.ru', path: '/account/captcha', window: 'main' });
    assert.deepEqual(captchaPlace(undefined, 'chat'), { host: 'hh.ru', path: '', window: 'chat' });
  });
});
