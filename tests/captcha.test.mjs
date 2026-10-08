/**
 * Tests for the captcha guard: detection, and no page actions while a captcha is shown
 */
import { describe, test, assert } from 'test-anywhere';
import {
  CAPTCHA_SELECTORS, CAPTCHA_TEXTS, isCaptchaShown, pageShowsCaptcha, waitWhileCaptcha, withCaptchaGuard,
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
