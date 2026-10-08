/**
 * Interactive confirmations on stdin, configured per step.
 *
 * Steps (`--confirm`, comma-separated):
 * - `answers`      - text typed into a question and radio/checkbox choices on the full form
 * - `cover-letter` - the cover letter typed into the full form
 * - `send`         - the click that sends a form with questions (full form or popup)
 * - `popup`        - everything in the short application popup on the vacancy list
 *
 * Before a confirmed step the field is scrolled into view, the step is printed and the
 * run waits for a line on stdin: `y` does it, `q` stops the run. Other buttons are
 * clicked without asking. In interactive runs the user is also asked to answer
 * questions that have no saved answer, instead of the vacancy being skipped.
 *
 * @module confirmations
 */

import readline from 'readline';
import { SELECTORS, URL_PATTERNS } from './hh-selectors.mjs';

export const CONFIRM_STEPS = ['answers', 'cover-letter', 'send', 'popup'];

// Clicks that only dismiss overlays enter no data
const UNCONFIRMED_SELECTORS = new Set([SELECTORS.cookiesAccept, SELECTORS.additionalDataClose]);
const SUBMIT_SELECTORS = new Set([
  SELECTORS.submitButtonPopup,
  SELECTORS.submitButtonLetter,
  SELECTORS.submitButtonWithoutQuestions,
  'button[type="submit"]',
]);
const COVER_LETTER_SELECTORS = new Set([SELECTORS.coverLetterTextareaPopup, SELECTORS.coverLetterTextareaForm]);
const STEP_PAUSE_MS = 2000;

let interactive = false;
let steps = new Set();
let stop = () => {};
let lines = null;
// A line typed while no prompt was waiting, or after a prompt was withdrawn, goes to the next prompt
let pendingLine = null;
let withdrawCurrent = null;

/** Thrown by a confirmed step whose prompt was withdrawn because the page changed */
export class PromptWithdrawnError extends Error {
  constructor() {
    super('The confirmation prompt was withdrawn because the page changed');
    this.name = 'PromptWithdrawnError';
  }
}

/**
 * Withdraw the prompt that waits on stdin, e.g. when the form was sent or left in the browser
 */
export function withdrawPrompt() {
  withdrawCurrent?.();
}

/**
 * Turn interactive confirmations on
 * @param {Object} options
 * @param {string[]} options.steps - Steps to confirm (see CONFIRM_STEPS)
 * @param {Function} options.onStop - Called when the user answers `q`
 */
export function enableConfirmations({ steps: confirmSteps, onStop }) {
  interactive = true;
  steps = new Set(confirmSteps);
  stop = onStop;
}

/** Whether someone answers on stdin, so the run can wait for them */
export const isInteractive = () => interactive;

/**
 * Print a message and wait until the user types `y` (no-op in unattended runs)
 * @param {string} description
 * @returns {Promise<boolean>} True when confirmed, false when the prompt was withdrawn
 */
export async function waitForUser(description) {
  if (!interactive) {
    return true;
  }
  lines ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const withdrawn = new Promise((resolve) => {
    withdrawCurrent = () => resolve(null);
  });
  try {
    for (;;) {
      console.log(`❓ ${description}\n   Type y to continue, q to stop:`);
      pendingLine ??= lines.next();
      const line = await Promise.race([pendingLine, withdrawn]);
      if (line === null) {
        console.log('↪️  Prompt withdrawn: the page changed in the browser');
        return false;
      }
      pendingLine = null;
      const answer = line.done ? 'q' : line.value.trim().toLowerCase();
      if (answer === 'y') {
        return true;
      }
      if (answer === 'q') {
        await stop();
        return new Promise(() => {});
      }
    }
  } finally {
    withdrawCurrent = null;
  }
}

/**
 * Wait for confirmation of a step when that step is configured
 * @param {string} step - One of CONFIRM_STEPS
 * @param {string} description
 * @returns {Promise<boolean>} False when the prompt was withdrawn
 */
export function confirmStep(step, description) {
  return steps.has(step) ? waitForUser(description) : Promise.resolve(true);
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
 * Wrap a commander so that configured steps wait for confirmation
 * @param {Object} commander - Browser commander instance
 * @returns {Object} The same commander when nothing is confirmed
 */
export function withConfirmations(commander) {
  if (steps.size === 0) {
    return commander;
  }
  // The short application popup is opened over the vacancy list
  const inPopup = () => URL_PATTERNS.searchVacancy.test(commander.getUrl());

  // fillTextArea with checkEmpty leaves a non-empty textarea alone, so there is nothing to confirm
  const isFilled = ({ selector, checkEmpty }) => checkEmpty && typeof selector === 'string' && commander.evaluate({
    fn: (sel) => Boolean(document.querySelector(sel)?.value?.trim()),
    args: [selector],
  }).catch(() => false);

  // Clicks that choose a form value (radio/checkbox) are answers; other buttons are just clicked
  const isFormField = ({ selector }) => typeof selector === 'string' && commander.evaluate({
    fn: (sel) => Boolean(document.querySelector(sel)?.matches('input, textarea, select')),
    args: [selector],
  }).catch(() => false);

  // Test questions are rendered as task bodies, in the popup and on the full form
  const hasQuestions = () => commander.evaluate({
    fn: (questionBlock) => Boolean(document.querySelector(questionBlock)),
    args: [SELECTORS.questionBlock],
  }).catch(() => true);

  const clickStep = async (options) => {
    if (SUBMIT_SELECTORS.has(options.selector)) {
      if (await hasQuestions()) {
        return 'send';
      }
      return inPopup() ? 'popup' : null;
    }
    if (UNCONFIRMED_SELECTORS.has(options.selector) || !await isFormField(options)) {
      return null;
    }
    return inPopup() ? 'popup' : 'answers';
  };
  const fillStep = async (options) => {
    if (await isFilled(options)) {
      return null;
    }
    if (inPopup()) {
      return 'popup';
    }
    return COVER_LETTER_SELECTORS.has(options.selector) ? 'cover-letter' : 'answers';
  };

  const confirmed = (method, describe, stepOf) => async (options) => {
    const step = await stepOf(options);
    if (steps.has(step)) {
      if (!await confirmStep(step, await describe(options))) {
        throw new PromptWithdrawnError();
      }
      const result = await method(options);
      await commander.wait({ ms: STEP_PAUSE_MS, reason: 'pause after a confirmed step' });
      return result;
    }
    return method(options);
  };
  const wrapped = {
    clickButton: confirmed(
      commander.clickButton,
      async ({ selector }) => (SUBMIT_SELECTORS.has(selector)
        ? `Send the application: click ${await describeElement(commander, selector)}`
        : `Choose ${await describeElement(commander, selector)}`),
      clickStep,
    ),
    fillTextArea: confirmed(
      (options) => commander.fillTextArea({ ...options, simulateTyping: true }),
      async ({ selector, text }) => `Type into ${await describeElement(commander, selector)}:\n   >>> ${text}`,
      fillStep,
    ),
  };
  return new Proxy(commander, { get: (target, key) => wrapped[key] ?? target[key] });
}
