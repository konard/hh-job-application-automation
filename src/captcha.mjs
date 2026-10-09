/**
 * Captcha guard: when hh.ru shows a captcha, the automation does nothing on the page
 * (no clicks, typing or navigation) until the user has solved it in the browser.
 *
 * Detection only reads the DOM (no input events, no requests to hh.ru). The only thing done
 * meanwhile is the optional captcha prefill (captcha-solver.mjs): Haiku's reading may be sent
 * once per captcha; after that the answer is only typed in for the user to send.
 *
 * @module captcha
 */

import { log } from './logging.mjs';

/** Texts of the hh.ru captcha dialog and captcha page */
export const CAPTCHA_TEXTS = ['Пройдите капчу', 'введите текст с картинки', 'что вы не робот'];
/** Elements of a captcha: its image, answer field, or a captcha frame */
export const CAPTCHA_SELECTORS = [
  'img[src*="captcha" i]',
  'input[placeholder="Текст с картинки"]',
  'input[name*="captcha" i]',
  '[data-qa*="captcha" i]',
  'iframe[src*="captcha" i]',
];
const CAPTCHA_URL = /\/(?:account\/)?captcha/i;
const POLL_MS = 5000;
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

let waiting = null;

/**
 * Wait, touching nothing, until no captcha is shown. Concurrent callers share one wait.
 * @param {Object} commander - Browser commander instance (unwrapped)
 * @param {Object} [options]
 * @param {number} [options.pollMs=5000] - How often the page is checked
 * @param {Function} [options.onCaptcha] - Called with the commander and this captcha's state
 *   object (the same one until the captcha is gone) on each check that shows a
 *   captcha, without waiting for it (the answer prefill)
 * @returns {Promise<boolean>} True when a captcha was shown and has been solved
 */
export function waitWhileCaptcha(commander, { pollMs = POLL_MS, onCaptcha } = {}) {
  waiting ??= (async () => {
    if (!await isCaptchaShown(commander)) {
      return false;
    }
    const episode = {};
    console.log('🛑 hh.ru shows a captcha. Solve it in the browser; the automation touches nothing until it is gone.');
    const started = Date.now();
    while (await isCaptchaShown(commander)) {
      onCaptcha?.(commander, episode);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    console.log(`✅ Captcha solved after ${Math.round((Date.now() - started) / 1000)} s, continuing`);
    return true;
  })().finally(() => {
    waiting = null;
  });
  return waiting;
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
        if (await waitWhileCaptcha(target, options)) {
          log.debug(() => `Captcha solved before ${key}`);
        }
        return value.apply(target, args);
      };
    },
  });
}
