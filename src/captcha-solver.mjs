/**
 * Captcha prefill: read the captcha with two local AI CLIs and type their guess into the
 * captcha field, so the user only checks it and sends it. Nothing is ever submitted.
 *
 * - The captcha image is taken from a screenshot of its element: loading the image again
 *   could make hh.ru issue a new captcha
 * - Claude Code (Haiku) and Codex (the latest Luna model) read it in parallel, the way
 *   https://github.com/link-assistant/image-to-number does: the image is copied under a
 *   neutral name into a private temporary directory and the model is asked for the
 *   characters only
 * - Both agree: their answer is prefilled; they disagree: both, as "haiku|luna"
 * - The field is filled only while it is empty and not focused, once per captcha image
 *
 * @module captcha-solver
 */

import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { log } from './logging.mjs';

/** The captcha picture and its answer field on hh.ru */
export const CAPTCHA_IMAGE_SELECTOR = 'img[src*="captcha" i]';
export const CAPTCHA_INPUT_SELECTOR = 'input[placeholder="Текст с картинки"], input[name*="captcha" i]';

export const CLAUDE_MODEL = 'claude-haiku-5-5';
/** Used when the Codex model catalog cannot be read */
export const FALLBACK_LUNA_MODEL = 'gpt-6-luna';
const SOLVER_TIMEOUT_MS = 90000;
const IMAGE_NAME = 'image.png';

const PROMPT = 'The image is a captcha from a website. Output ONLY the text shown in it, exactly as written ' +
  '(the same letters, digits and case), with no quotes or explanation.';

/** A captcha answer is one short word; anything else (a refusal, an explanation) is not one */
const PLAUSIBLE_ANSWER = /^[\p{L}\p{N}]{2,12}$/u;

/**
 * The answer in a model reply: its last non-empty line without quotes or a final period
 * @param {string|null|undefined} reply
 * @returns {string|null} Null when the reply is not a plausible captcha answer
 */
export function cleanAnswer(reply) {
  const line = String(reply ?? '').split('\n').map((item) => item.trim()).filter(Boolean).pop();
  const answer = line?.replace(/^["'`«»“”]+|["'`«»“”.]+$/g, '').trim();
  return answer && PLAUSIBLE_ANSWER.test(answer) ? answer : null;
}

/**
 * What to prefill: the common answer, or every distinct one separated by |
 * @param {Array<string|null>} answers - In order: Haiku, Luna
 * @returns {string|null}
 */
export function combineAnswers(answers) {
  const distinct = [];
  for (const answer of answers.filter(Boolean)) {
    if (!distinct.some((item) => item.toLowerCase() === answer.toLowerCase())) {
      distinct.push(answer);
    }
  }
  return distinct.length > 0 ? distinct.join('|') : null;
}

/**
 * The newest gpt-<version>-luna slug in a Codex model catalog
 * @param {string} catalogJson - Output of `codex debug models`
 * @returns {string|null}
 */
export function latestLunaModel(catalogJson) {
  const slugs = [...String(catalogJson).matchAll(/"slug"\s*:\s*"(gpt-([\d.]+)-luna)"/g)];
  const version = (text) => text.split('.').map(Number);
  const newer = (a, b) => {
    const [x, y] = [version(a[2]), version(b[2])];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) {
        return (x[i] ?? 0) > (y[i] ?? 0) ? a : b;
      }
    }
    return a;
  };
  return slugs.length > 0 ? slugs.reduce(newer)[1] : null;
}

/**
 * Run a command, resolving with its stdout
 */
function run(command, args, { cwd, timeout = SOLVER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message.split('\n')[0]} ${String(stderr).trim().split('\n').pop() ?? ''}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdin?.end();
  });
}

let lunaModel = null;

/**
 * The newest Luna model the Codex account offers, looked up once
 * @returns {Promise<string>}
 */
async function resolveLunaModel() {
  lunaModel ??= await run('codex', ['debug', 'models'], { timeout: 30000 })
    .then((catalog) => latestLunaModel(catalog) ?? FALLBACK_LUNA_MODEL)
    .catch(() => FALLBACK_LUNA_MODEL);
  return lunaModel;
}

/**
 * The answer of a reader, reporting a reply that is not one (e.g. a refusal)
 */
function readAnswer(name, reply) {
  const answer = cleanAnswer(reply);
  if (!answer) {
    console.log(`🤖 ${name} gave no captcha answer: ${String(reply).trim().split('\n').pop()?.slice(0, 120)}`);
  }
  return answer;
}

/** Ask Claude Code (Haiku) for the text in image.png of the directory */
async function askClaude(dir) {
  return readAnswer('Haiku', await run('claude', [
    '-p', `${IMAGE_NAME}\n\n${PROMPT}`, '--model', CLAUDE_MODEL, '--allowedTools', 'Read', '--output-format', 'text',
  ], { cwd: dir }));
}

/** Ask Codex (the latest Luna) for the text in image.png of the directory */
async function askCodex(dir) {
  const answerFile = path.join(dir, 'codex-answer.txt');
  await run('codex', [
    'exec', '-m', await resolveLunaModel(), '-c', 'model_reasoning_effort=low', '--skip-git-repo-check', '--ephemeral',
    '-s', 'read-only', '-i', IMAGE_NAME, '-o', answerFile, PROMPT,
  ], { cwd: dir });
  return readAnswer('Luna', await readFile(answerFile, 'utf8'));
}

/**
 * Read a captcha image with both models
 * @param {Buffer} png - The captcha image
 * @param {Object} [solvers] - For tests: { claude, codex } functions of the directory
 * @returns {Promise<{haiku: string|null, luna: string|null, model: string, text: string|null}>}
 */
export async function solveCaptchaImage(png, { claude = askClaude, codex = askCodex } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hh-captcha-'));
  try {
    await writeFile(path.join(dir, IMAGE_NAME), png);
    const settle = (name, promise) => promise.catch((error) => {
      console.log(`⚠️  Captcha reader ${name} failed: ${error.message}`);
      return null;
    });
    const [haiku, luna] = await Promise.all([settle('Haiku', claude(dir)), settle('Luna', codex(dir))]);
    return { haiku, luna, model: lunaModel ?? FALLBACK_LUNA_MODEL, text: combineAnswers([haiku, luna]) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Runs in the page: the visible captcha image and its answer field
 * @param {{imageSelector: string, inputSelector: string}} selectors
 * @returns {{src: string, value: string, focused: boolean}|null}
 */
export function readCaptchaForm({ imageSelector, inputSelector }) {
  const isVisible = (element) => element.getClientRects().length > 0 &&
    window.getComputedStyle(element).visibility !== 'hidden';
  const image = [...document.querySelectorAll(imageSelector)].find(isVisible);
  const input = [...document.querySelectorAll(inputSelector)].find(isVisible);
  if (!image || !input) {
    return null;
  }
  return { src: image.currentSrc || image.src, value: input.value, focused: document.activeElement === input };
}

/**
 * Create the prefill step, called on every captcha check while a captcha is shown
 * @param {Object} options
 * @param {Object} options.page - Raw Playwright/Puppeteer page, for the element screenshot
 * @param {Function} [options.solve=solveCaptchaImage]
 * @returns {(commander: Object) => Promise<void>} Takes the unguarded commander
 */
export function createCaptchaPrefill({ page, solve = solveCaptchaImage }) {
  let handledSrc = null;
  let running = null;

  const readForm = async (commander) => (await commander.safeEvaluate({
    fn: readCaptchaForm,
    args: [{ imageSelector: CAPTCHA_IMAGE_SELECTOR, inputSelector: CAPTCHA_INPUT_SELECTOR }],
    defaultValue: null,
    operationName: 'captcha form read',
    silent: true,
  })).value;

  async function prefill(commander) {
    const form = await readForm(commander);
    // Once per captcha image, and never over what the user types
    if (!form || form.src === handledSrc) {
      return;
    }
    handledSrc = form.src;
    if (form.value || form.focused) {
      return;
    }

    let png = null;
    for (const handle of await page.$$(CAPTCHA_IMAGE_SELECTOR)) {
      if (!png && await handle.boundingBox()) {
        png = await handle.screenshot({ type: 'png' });
      }
    }
    if (!png) {
      log.debug(() => 'Captcha image not found for the prefill');
      return;
    }

    console.log('🤖 Reading the captcha with Haiku and Luna (it is only prefilled, you send it)...');
    const { haiku, luna, model, text } = await solve(png);
    console.log(`🤖 Captcha guesses: Haiku "${haiku ?? '-'}", ${model} "${luna ?? '-'}"`);
    if (!text) {
      return;
    }

    const now = await readForm(commander);
    if (now?.src !== form.src || now.value || now.focused) {
      console.log('🤖 The captcha changed or you started typing, so it is not prefilled');
      return;
    }
    await commander.fillTextArea({
      selector: CAPTCHA_INPUT_SELECTOR, text, checkEmpty: true, scrollIntoView: false, simulateTyping: true,
    });
    console.log(`✍️  Prefilled the captcha with "${text}": check it, fix it if needed and send it yourself`);
  }

  return (commander) => {
    running ??= prefill(commander)
      .catch((error) => console.log(`⚠️  Captcha prefill failed: ${error.message}`))
      .finally(() => {
        running = null;
      });
    return running;
  };
}
