/**
 * Test mode: one application, every value entered into a form field confirmed first.
 *
 * Buttons are clicked without asking. Before text is typed or a radio/checkbox
 * option is chosen, the value is printed and the run waits for a line on stdin:
 * `y` enters it, `q` stops the run.
 *
 * @module test-mode
 */

import readline from 'readline';
import { SELECTORS } from './hh-selectors.mjs';

// Clicks that only dismiss overlays enter no data
const UNCONFIRMED_SELECTORS = new Set([SELECTORS.cookiesAccept, SELECTORS.additionalDataClose]);
const STEP_PAUSE_MS = 2000;

let enabled = false;
let stop = () => {};
let lines = null;

/**
 * Turn test mode on
 * @param {Object} options
 * @param {Function} options.onStop - Called when the user answers `q`
 */
export function enableTestMode({ onStop }) {
  enabled = true;
  stop = onStop;
}

export const isTestMode = () => enabled;

/**
 * Print a step and wait for its confirmation (no-op outside test mode)
 * @param {string} description
 */
export async function confirmStep(description) {
  if (!enabled) {
    return;
  }
  lines ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  for (;;) {
    console.log(`❓ [test mode] ${description}\n   Type y to do it, q to stop:`);
    const { value, done } = await lines.next();
    const answer = done ? 'q' : value.trim().toLowerCase();
    if (answer === 'y') {
      return;
    }
    if (answer === 'q') {
      await stop();
      return new Promise(() => {});
    }
  }
}

/**
 * Describe the element a selector points to: its own text or label, and the question around it
 */
function describeElement(commander, selector) {
  if (typeof selector !== 'string') {
    return Promise.resolve(String(selector));
  }
  return commander.evaluate({
    fn: (sel) => {
      const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
      const element = document.querySelector(sel);
      if (!element) {
        return sel;
      }
      // Bring the target into view; no visual markers, so recordings and screenshots stay clean
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const own = clean(element.labels?.[0]?.textContent || element.getAttribute('aria-label') ||
        (element.matches('textarea, input') ? element.placeholder : element.textContent));
      let context = '';
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const text = clean(node.textContent);
        if (text.length > own.length + 10) {
          context = text.slice(0, 200);
          break;
        }
      }
      return [own && `"${own}"`, context && `in: ${context}`].filter(Boolean).join(' ');
    },
    args: [selector],
  }).catch(() => selector);
}

/**
 * Wrap a commander so that entered values wait for confirmation in test mode
 * @param {Object} commander - Browser commander instance
 * @returns {Object} The same commander outside test mode
 */
export function withConfirmations(commander) {
  if (!enabled) {
    return commander;
  }
  // fillTextArea with checkEmpty leaves a non-empty textarea alone, so there is nothing to confirm
  const isFilled = ({ selector, checkEmpty }) => checkEmpty && typeof selector === 'string' && commander.evaluate({
    fn: (sel) => Boolean(document.querySelector(sel)?.value?.trim()),
    args: [selector],
  }).catch(() => false);

  // Only clicks that choose a form value (radio/checkbox) are entries; buttons are just clicked
  const isFormField = ({ selector }) => typeof selector === 'string' && commander.evaluate({
    fn: (sel) => Boolean(document.querySelector(sel)?.matches('input, textarea, select')),
    args: [selector],
  }).catch(() => false);

  const confirmed = (method, describe, needsConfirmation) => async (options) => {
    if (await needsConfirmation(options)) {
      await confirmStep(await describe(options));
    }
    const result = await method(options);
    await commander.wait({ ms: STEP_PAUSE_MS, reason: 'test mode pause after a step' });
    return result;
  };
  const wrapped = {
    clickButton: confirmed(
      commander.clickButton,
      async ({ selector }) => `Choose ${await describeElement(commander, selector)}`,
      async (options) => !UNCONFIRMED_SELECTORS.has(options.selector) && await isFormField(options),
    ),
    fillTextArea: confirmed(
      (options) => commander.fillTextArea({ ...options, simulateTyping: true }),
      async ({ selector, text }) => `Type into ${await describeElement(commander, selector)}:\n   >>> ${text}`,
      async (options) => !await isFilled(options),
    ),
  };
  return new Proxy(commander, { get: (target, key) => wrapped[key] ?? target[key] });
}
