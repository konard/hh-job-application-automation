/**
 * Captcha guard: when hh.ru shows a captcha, the automation does nothing on the page
 * (no clicks, typing or navigation) until the user has solved it in the browser. A confirmed
 * application-account limit takes priority: its handler saves the form and dismisses the
 * unusable dialog, then holds submissions without CAPTCHA assistance or attention alerts.
 *
 * Detection only reads the DOM (no input events, no requests to hh.ru). The only thing done
 * meanwhile is the optional captcha prefill (captcha-solver.mjs): Haiku's reading may be sent
 * once per captcha; after that the answer is only typed in for the user to send.
 *
 * @module captcha
 */

import { log } from './logging.mjs';
import { alertUser } from './notify.mjs';
import { recordEvent } from './stats.mjs';
import { CAPTCHA_TEXTS } from './hh-words.mjs';

export { CAPTCHA_TEXTS };
/** Elements of a captcha: its image, answer field, or a captcha frame */
export const CAPTCHA_SELECTORS = [
  'img[src*="captcha" i]',
  'input[placeholder="Текст с картинки"]',
  'input[placeholder="Text from the picture"]',
  'input[name*="captcha" i]',
  '[data-qa*="captcha" i]',
  'iframe[src*="captcha" i]',
];
const CAPTCHA_URL = /\/(?:account\/)?captcha/i;
const POLL_MS = 5000;
/** A captcha still shown after this long is yours to solve: the alert sounds */
export const CAPTCHA_ALERT_MS = 30000;
const NAVIGATION_RETRIES = 5;
const NAVIGATION_RETRY_MS = 1000;

/**
 * Commander methods that act on the page. evaluate/safeEvaluate are included because page
 * scripts also click (vacancy buttons, pagination); pure reads such as count are left alone.
 */
export const GUARDED_METHODS = new Set([
  'click', 'clickButton', 'clickElement', 'fill', 'fillTextArea', 'performFill', 'typeText', 'pressKey',
  'keyDown', 'keyUp', 'goto', 'scrollIntoView', 'scrollIntoViewIfNeeded', 'setContent', 'unfocusAddressBar',
  'emulateMedia', 'evaluate', 'safeEvaluate',
]);

/**
 * Runs in the page: whether a captcha text or a visible captcha element is shown
 * @param {{texts: string[], selectors: string[]}} markers
 * @returns {boolean}
 */
export function pageShowsCaptcha({ texts, selectors }) {
  // Same-origin frames count too; a cross-origin captcha frame is matched by its src
  const documents = [document, ...[...document.querySelectorAll('iframe')]
    .map((frame) => {
      try {
        return frame.contentDocument;
      } catch {
        return null;
      }
    })
    .filter(Boolean)];
  const text = documents.map((doc) => doc.body?.innerText ?? '').join(' ').replace(/\s+/g, ' ').toLowerCase();
  const isVisible = (element) => element.getClientRects().length > 0 &&
    window.getComputedStyle(element).visibility !== 'hidden';
  return texts.some((item) => text.includes(item.toLowerCase())) ||
    documents.some((doc) => selectors.some((selector) => [...doc.querySelectorAll(selector)].some(isVisible)));
}

/**
 * Whether a captcha is shown on the page
 * @param {Object} commander - Browser commander instance (unwrapped)
 * @returns {Promise<boolean>}
 */
export async function isCaptchaShown(commander) {
  // A navigation during the check says nothing about the new page, so it is checked again
  for (let attempt = 0; attempt < NAVIGATION_RETRIES; attempt++) {
    if (CAPTCHA_URL.test(commander.getUrl())) {
      return true;
    }
    const { value, navigationError } = await commander.safeEvaluate({
      fn: pageShowsCaptcha,
      args: [{ texts: CAPTCHA_TEXTS, selectors: CAPTCHA_SELECTORS }],
      defaultValue: false,
      operationName: 'captcha check',
      silent: true,
    });
    if (!navigationError) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, NAVIGATION_RETRY_MS));
  }
  log.debug(() => 'Captcha check kept being interrupted by navigation; assuming no captcha');
  return false;
}

const waiting = new WeakMap();

export const isDailyLimitInterrupted = error => error?.code === 'DAILY_APPLICATION_LIMIT_INTERRUPTED';

/**
 * Wait, touching nothing, until no captcha is shown. Concurrent callers share one wait.
 * @param {Object} commander - Browser commander instance (unwrapped)
 * @param {Object} [options]
 * @param {number} [options.pollMs=5000] - How often the page is checked
 * @param {Function} [options.onCaptcha] - Called with the commander and this captcha's state
 *   object (the same one until the captcha is gone) on each check that shows a
 *   captcha, without waiting for it (the answer prefill)
 * @returns {Promise<boolean|Object>} True when the captcha cleared; a daily-limit result interrupts the queued action
 */
export function waitWhileCaptcha(commander, { pollMs = POLL_MS, onCaptcha, alert = alertUser,
  onDailyLimit,
  alertDelayMs = CAPTCHA_ALERT_MS, now = Date.now, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (waiting.has(commander)) return waiting.get(commander);
  const operation = (async () => {
    const initialLimit = await onDailyLimit?.(commander);
    if (initialLimit) return initialLimit;
    if (!await isCaptchaShown(commander)) {
      return await onDailyLimit?.(commander) ?? false;
    }
    const episode = {};
    console.log('🛑 hh.ru shows a captcha. Solve it in the browser; the automation touches nothing until it is gone.');
    const started = now();
    const where = captchaPlace(commander.getUrl?.(), 'main');
    // Written at once: a run stopped before the captcha is gone still counts it
    recordEvent('captcha_shown', where);
    // A clock alone cannot tell whether background processing is finished. Notify only once
    // it has settled and the page still needs manual attention; never while it is running.
    let background = null;
    let settled = !onCaptcha;
    let endAlert = null;
    try {
      while (await isCaptchaShown(commander)) {
        const limit = await onDailyLimit?.(commander);
        if (limit) {
          episode.cancelled = true;
          recordEvent('captcha', { ms: now() - started, ai: false, ...where, solved: false, shown: true, reason: 'daily_limit' });
          return limit;
        }
        if (!endAlert && settled && !background && now() - started >= alertDelayMs) endAlert = alert();
        if (onCaptcha && !background) {
          settled = false;
          background = Promise.resolve().then(() => onCaptcha(commander, episode))
            .catch((error) => console.log(`⚠️  Background CAPTCHA step failed; manual input is required: ${error.message.split('\n')[0]}`))
            .finally(() => { settled = true; background = null; });
        }
        await pause(onDailyLimit ? Math.min(pollMs, 1000) : pollMs);
      }
    } finally {
      endAlert?.();
    }
    const finalLimit = await onDailyLimit?.(commander);
    if (finalLimit) {
      episode.cancelled = true;
      recordEvent('captcha', { ms: now() - started, ai: false, ...where, solved: false, shown: true, reason: 'daily_limit' });
      return finalLimit;
    }
    console.log(`✅ Captcha solved after ${Math.round((now() - started) / 1000)} s, continuing`);
    // Solved by AI: its reading was sent and hh.ru showed no new picture after it
    recordEvent('captcha', { ms: now() - started, ai: Boolean(episode.sent && !episode.reported), ...where, solved: true, shown: true });
    return true;
  })().finally(() => {
    waiting.delete(commander);
  });
  waiting.set(commander, operation);
  return operation;
}

/**
 * Where a captcha shows, for the stats: the site and page (no query, which may hold personal data)
 * and the window
 * @param {string} [url]
 * @param {string} window - main, chat or slot
 * @returns {{host: string, path: string, window: string}}
 */
export function captchaPlace(url, window) {
  try {
    const { host, pathname } = new URL(url);
    return { host, path: pathname, window };
  } catch {
    return { host: 'hh.ru', path: '', window };
  }
}

/**
 * Wrap a commander so that every page action first waits while a captcha is shown
 * @param {Object} commander - Browser commander instance
 * @param {Object} [options] - Passed to waitWhileCaptcha
 * @returns {Object}
 */
export function withCaptchaGuard(commander, options = {}) {
  return new Proxy(commander, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function' || !GUARDED_METHODS.has(key)) {
        return value;
      }
      return async (...args) => {
        const result = await waitWhileCaptcha(target, options);
        if (result?.status === 'daily_limit') {
          await options.waitForDailyLimit?.(target, result);
          // The queued action belongs to the refused form. A fresh handler must re-evaluate it.
          const error = new Error('Daily application limit interrupted the queued page action');
          error.code = 'DAILY_APPLICATION_LIMIT_INTERRUPTED';
          error.expectedNavigation = true;
          throw error;
        }
        if (result) {
          log.debug(() => `Captcha solved before ${key}`);
        }
        return value.apply(target, args);
      };
    },
  });
}
