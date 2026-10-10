/**
 * Captcha prefill: read the captcha with two local AI CLIs and type their guess into the
 * captcha field, so the user only checks it and sends it. Nothing is ever submitted.
 *
 * - The models get only the captcha picture, in its original size (250x90 on hh.ru): the
 *   already loaded image is copied through a canvas in the page, since loading it again could
 *   make hh.ru issue a new captcha. If the copy is not possible, a screenshot of the picture
 *   element is used instead; never a screenshot of the page
 * - Claude Code (Haiku) and Codex (the latest Luna model) read it in parallel, the way
 *   https://github.com/link-assistant/image-to-number does: the image is copied under a
 *   neutral name into a private temporary directory and the model is asked for the
 *   characters only
 * - The first picture of a captcha: Haiku's reading is typed in and sent once (sendOnce). If hh.ru
 *   does not accept it, nothing more is sent: later pictures are only prefilled for the user
 * - Prefill: both agree, their answer; they disagree, both, as "haiku|luna"
 * - The field is filled only while it is empty and not focused; a picture is read until there is
 *   an answer, at most three times
 *
 * @module captcha-solver
 */

import { execFile } from 'child_process';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { log } from './logging.mjs';

/**
 * The captcha picture and its answer field on hh.ru. The dialog first shows the picture with an
 * empty src and sets /captcha/picture?key=... later (19 s in the first one recorded)
 */
export const CAPTCHA_IMAGE_SELECTOR = 'img[data-qa="account-captcha-picture"], img[src*="captcha" i]';
export const CAPTCHA_INPUT_SELECTOR =
  'input[data-qa="account-captcha-input"], input[placeholder="Текст с картинки"], input[name*="captcha" i]';

export const CLAUDE_MODEL = 'claude-haiku-5-5';
/** Used when the Codex model catalog cannot be read */
export const FALLBACK_LUNA_MODEL = 'gpt-6-luna';
const SOLVER_TIMEOUT_MS = 90000;
/** Reasoning effort of both readers, set here so it does not depend on the user's CLI settings */
export const READER_EFFORT = 'low';
const IMAGE_NAME = 'image.png';

const PROMPT = 'I am logged in to my own hh.ru account and it shows me a captcha. Your reading is typed into ' +
  'the captcha field for me and sent once; if it is not accepted, I solve the captcha myself. ' +
  'The image is the captcha. It usually shows one or two Russian words in Cyrillic ' +
  'letters, curved or distorted. Output ONLY the text shown in it, exactly as written (the same letters, digits, ' +
  'case and spaces between words), with no quotes, comments or explanation, also when unsure.';
/** Reads of one captcha picture when the models give no answer (Haiku sometimes declines) */
const MAX_ATTEMPTS = 3;
/** The dialog fades in; the picture is taken once it is shown in full */
const SETTLE_MS = 1000;

/**
 * A captcha answer is one to three short Russian or English words ("злеат вьюнить", hh.ru's
 * "English" captcha); anything else (a refusal, an explanation, other scripts) is not one
 */
const PLAUSIBLE_ANSWER = /^(?=.{2,30}$)[а-яёa-z0-9]+(?: [а-яёa-z0-9]+){0,2}$/i;

/**
 * The answer in a model reply: its last line that looks like a captcha answer, without quotes
 * or a final period (a comment such as "the first word is cut off" is skipped)
 * @param {string|null|undefined} reply
 * @returns {string|null} Null when no line is a plausible captcha answer
 */
export function cleanAnswer(reply) {
  const answers = String(reply ?? '').split('\n')
    .map((line) => line.trim().replace(/^["'`«»“”]+|["'`«»“”.]+$/g, '').trim())
    .filter((line) => PLAUSIBLE_ANSWER.test(line));
  return answers.pop() ?? null;
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
 * Run a command, resolving with its stdout (also used by the translators of translation.mjs)
 * @param {string} command
 * @param {string[]} args
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @param {number} [options.timeout=90000]
 * @param {Object} [options.env] - Variables added to the environment
 * @returns {Promise<string>}
 */
export function run(command, args, { cwd, timeout = SOLVER_TIMEOUT_MS, env } = {}) {
  return new Promise((resolve, reject) => {
    const options = { cwd, timeout, maxBuffer: 10 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) };
    const child = execFile(command, args, options, (error, stdout, stderr) => {
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
 * The newest Luna model the Codex account offers, looked up once (also used by translation.mjs)
 * @returns {Promise<string>}
 */
export async function resolveLunaModel() {
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
    '-p', `${IMAGE_NAME}\n\n${PROMPT}`, '--model', CLAUDE_MODEL, '--effort', READER_EFFORT,
    '--allowedTools', 'Read', '--output-format', 'text',
  ], { cwd: dir }));
}

/** Ask Codex (the latest Luna) for the text in image.png of the directory */
async function askCodex(dir) {
  const answerFile = path.join(dir, 'codex-answer.txt');
  await run('codex', [
    'exec', '-m', await resolveLunaModel(), '-c', `model_reasoning_effort=${READER_EFFORT}`, '--skip-git-repo-check', '--ephemeral',
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
 * @returns {{src: string, ready: boolean, value: string, focused: boolean}|null}
 */
export function readCaptchaForm({ imageSelector, inputSelector }) {
  const isVisible = (element) => element.getClientRects().length > 0 &&
    window.getComputedStyle(element).visibility !== 'hidden';
  const image = [...document.querySelectorAll(imageSelector)].find(isVisible);
  const input = [...document.querySelectorAll(inputSelector)].find(isVisible);
  if (!image || !input) {
    return null;
  }
  // Loaded, and not faded out (the dialog fades in)
  let opacity = 1;
  for (let element = image; element; element = element.parentElement) {
    opacity *= Number(window.getComputedStyle(element).opacity);
  }
  return {
    src: image.currentSrc || image.src,
    ready: image.complete && image.naturalWidth > 0 && opacity > 0.99,
    value: input.value,
    focused: document.activeElement === input,
  };
}

/**
 * Runs in the page: the loaded captcha picture in its original size, as a PNG data URL. hh.ru
 * serves it from its own origin, so the canvas can be read; no request is made
 * @param {{imageSelector: string}} selectors
 * @returns {string|null}
 */
export function copyCaptchaImage({ imageSelector }) {
  const image = [...document.querySelectorAll(imageSelector)]
    .find((element) => element.getClientRects().length > 0 && element.complete && element.naturalWidth > 0);
  if (!image) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    // A picture from another origin cannot be read back
    return null;
  }
}

/**
 * The captcha picture: copied in its original size, or else a screenshot of its element
 * @returns {Promise<Buffer|null>}
 */
async function takeCaptchaImage(commander, page) {
  const { value: dataUrl } = await commander.safeEvaluate({
    fn: copyCaptchaImage,
    args: [{ imageSelector: CAPTCHA_IMAGE_SELECTOR }],
    defaultValue: null,
    operationName: 'captcha image copy',
    silent: true,
  });
  if (dataUrl?.startsWith('data:image/png;base64,')) {
    return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  }
  log.debug(() => 'Captcha picture could not be copied, taking a screenshot of its element');
  for (const handle of await page.$$(CAPTCHA_IMAGE_SELECTOR)) {
    if (await handle.boundingBox()) {
      return handle.screenshot({ type: 'png' });
    }
  }
  return null;
}

/**
 * Runs in the page: the button that sends the captcha answer, as a selector, or null. It is the
 * submit button of the form (or dialog) holding the answer field, else its "Отправить" button
 * @param {{inputSelector: string}} selectors
 * @returns {string|null}
 */
export function findCaptchaSendButton({ inputSelector }) {
  const input = [...document.querySelectorAll(inputSelector)].find((element) => element.getClientRects().length > 0);
  const scope = input?.closest('form') ?? input?.closest('[role="dialog"]');
  if (!scope) {
    return null;
  }
  const scopeSelector = scope.matches('form') ? 'form' : '[role="dialog"]';
  const inputMark = (input.getAttribute('data-qa') && `[data-qa="${input.getAttribute('data-qa')}"]`) ||
    (input.name && `[name="${input.name}"]`);
  if (!inputMark) {
    return null;
  }
  const buttons = [...scope.querySelectorAll('button')].filter((button) => button.getClientRects().length > 0);
  const submit = buttons.find((button) => button.type === 'submit');
  if (submit) {
    return `${scopeSelector}:has(${inputMark}) button[type="submit"]`;
  }
  const send = buttons.find((button) => button.innerText.trim() === 'Отправить');
  return send?.getAttribute('data-qa') ? `button[data-qa="${send.getAttribute('data-qa')}"]` : null;
}

/**
 * Create the prefill step, called on every captcha check while a captcha is shown
 * @param {Object} options
 * @param {Object} options.page - Raw Playwright/Puppeteer page, for the element screenshot fallback
 * @param {Function} [options.solve=solveCaptchaImage]
 * @param {string|null} [options.saveDir] - Where the captcha pictures are kept for checking (logs/captcha)
 * @param {number} [options.settleMs=1000] - Pause before the picture is taken
 * @param {boolean} [options.sendOnce=true] - Send Haiku's reading of a captcha's first picture once
 * @returns {(commander: Object, episode?: Object) => Promise<void>} Takes the unguarded commander and
 *   the state of this captcha (from waitWhileCaptcha)
 */
export function createCaptchaPrefill({
  page, solve = solveCaptchaImage, saveDir = path.join(process.cwd(), 'logs', 'captcha'), settleMs = SETTLE_MS,
  sendOnce = true,
}) {
  let currentSrc = null;
  let attempts = 0;
  let running = null;

  const readForm = async (commander) => (await commander.safeEvaluate({
    fn: readCaptchaForm,
    args: [{ imageSelector: CAPTCHA_IMAGE_SELECTOR, inputSelector: CAPTCHA_INPUT_SELECTOR }],
    defaultValue: null,
    operationName: 'captcha form read',
    silent: true,
  })).value;

  async function prefill(commander, episode) {
    let form = await readForm(commander);
    // A new picture after the send means hh.ru did not accept it
    if (episode.sent && !episode.reported && form?.src && form.src !== episode.sentSrc) {
      episode.reported = true;
      console.log('🛑 hh.ru did not accept Haiku\'s reading; the captcha is yours to solve (it is only prefilled now)');
    }
    if (form && form.src !== currentSrc) {
      currentSrc = form.src;
      attempts = 0;
    }
    // A picture is read until there is an answer (at most twice), and never over what the user types
    if (!form?.ready || attempts >= MAX_ATTEMPTS || form.value || form.focused) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    form = await readForm(commander);
    if (!form?.ready || form.src !== currentSrc || form.value || form.focused) {
      return;
    }
    attempts++;

    const png = await takeCaptchaImage(commander, page);
    if (!png) {
      log.debug(() => 'Captcha image not found for the prefill');
      return;
    }
    if (saveDir) {
      const file = path.join(saveDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await mkdir(saveDir, { recursive: true });
      await writeFile(file, png);
      log.debug(() => `Captcha picture saved to ${file}`);
    }

    const trySend = sendOnce && !episode.sent;
    console.log(`🤖 Reading the captcha with Haiku and Luna (${trySend ? 'Haiku\'s reading is sent once' : 'it is only prefilled, you send it'})...`);
    const { haiku, luna, model, text } = await solve(png);
    console.log(`🤖 Captcha guesses: Haiku "${haiku ?? '-'}", ${model} "${luna ?? '-'}"`);
    if (!text) {
      return;
    }
    attempts = MAX_ATTEMPTS;

    const now = await readForm(commander);
    if (now?.src !== form.src || now.value || now.focused) {
      console.log('🤖 The captcha changed or you started typing, so it is not prefilled');
      return;
    }
    const sendButton = trySend && haiku && (await commander.safeEvaluate({
      fn: findCaptchaSendButton,
      args: [{ inputSelector: CAPTCHA_INPUT_SELECTOR }],
      defaultValue: null,
      operationName: 'captcha send button',
      silent: true,
    })).value;
    const answer = sendButton ? haiku : text;
    await commander.fillTextArea({
      selector: CAPTCHA_INPUT_SELECTOR, text: answer, checkEmpty: true, scrollIntoView: false, simulateTyping: true,
    });
    if (!sendButton) {
      if (trySend && haiku) {
        console.log('🤖 The captcha send button was not found, so nothing is sent');
      }
      console.log(`✍️  Prefilled the captcha with "${answer}": check it, fix it if needed and send it yourself`);
      return;
    }
    // Once per captcha: if hh.ru does not accept it, everything after this is up to the user
    if ((await readForm(commander))?.value !== answer) {
      console.log('🤖 The captcha field does not hold Haiku\'s reading, so nothing is sent');
      return;
    }
    episode.sent = true;
    episode.sentSrc = form.src;
    console.log(`📨 Sending Haiku's reading of the captcha (once): "${answer}"`);
    await commander.clickButton({ selector: sendButton, scrollIntoView: false });
  }

  return (commander, episode = {}) => {
    running ??= prefill(commander, episode)
      .catch((error) => console.log(`⚠️  Captcha prefill failed: ${error.message}`))
      .finally(() => {
        running = null;
      });
    return running;
  };
}
