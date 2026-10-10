/**
 * Answers the user sends in a prefilled external form are learned (data/qa.lino), the same way the
 * hh.ru forms save what the user typed.
 *
 * The prefill exits while the form waits for the user, so a small detached watcher per slot
 * (src/form-watch.mjs, like the idle watchdog of the slot browser) attaches over CDP, reads the
 * values of the controls the prefill marked with data-prefill-id (nothing visible on the page), and
 * keeps the answers of every page (Google Forms «Далее»). Only a real submission is learned: the
 * form's controls are gone after a click on its send button, or its confirmation shows («Ваш ответ
 * записан», «Спасибо»). Then the watcher saves the answers and exits; it also exits when the slot
 * browser closes or a newer prefill of the slot takes over.
 *
 * @module form-answers
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { isAssignmentLinkQuestion } from './assignments.mjs';
import { findBestMatch } from './qa-database.mjs';
import { answerText } from './qa.mjs';
import { readFormFields, TO_CHECK } from './form-prefill.mjs';

const WATCH_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'form-watch.mjs');
const POLL_MS = 2000;
/** An answer changed by the user is saved before the form is sent once it stays the same this long */
export const EDIT_STABLE_MS = 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Text the forms show once the answer is sent; Google Forms speaks the browser's language
 * (Vietnamese here: «Câu trả lời của bạn đã được ghi lại»)
 */
export const CONFIRMATION = /ваш ответ (записан|отправлен|принят)|ответ (записан|отправлен|принят)|(анкета|форма|заявка) отправлена|спасибо|благодарим|your response has been (recorded|submitted)|response (was )?(submitted|sent|recorded)|thank you|thanks|câu trả lời của bạn đã được (ghi lại|gửi)|cảm ơn/iu;

/** The page a sent form lands on, whatever the language: Google Forms' /formResponse */
export const SENT_URL = /^https:\/\/docs\.google\.com\/forms\/[^?#]*\/formResponse(?:[?#]|$)/;

/** The prefill's own answers that are not learned unless the user changes them */
const NOT_LEARNED_SOURCES = new Set(['profile', 'company from the chat', 'test assignment repository']);

const isEmpty = (answer) => [answer].flat().every((item) => !String(item ?? '').trim());
const normalized = (answer) => [answer].flat().map((item) => String(item).replace(/\s+/g, ' ').trim()).sort().join('\n');

/**
 * Whether two answers are the same (whitespace and the order of checked options aside)
 * @param {string|string[]} a
 * @param {string|string[]} b
 * @returns {boolean}
 */
export const sameAnswer = (a, b) => normalized(a) === normalized(b);

/**
 * Whether a clicked button sends the form (not «Далее» or «Назад»)
 * @param {string} label
 * @returns {boolean}
 */
export function isSubmitClick(label) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim();
  return /^(отправить|submit|send|готово|завершить|finish|done|gửi|nộp)(?!\p{L})/iu.test(text) && !/далее|next|назад|back|tiếp|quay lại/iu.test(text);
}

/**
 * The answers of a form page: each question with its value, as hh.ru form answers are saved (one
 * checked option as a string, several as a list)
 * @param {Array<{id: string, kind: string, title: string, options?: string[], optionIds?: string[]}>} fields - readFormFields()
 * @param {Object<string, {value?: string, checked?: boolean, type?: string}>} values - watchFormValues().values
 * @returns {Array<{title: string, kind: string, answer: string|string[]}>}
 */
export function answersFromSnapshot(fields, values) {
  const byTitle = new Map();
  for (const field of fields ?? []) {
    if (field.kind === 'file') {
      continue;
    }
    let answer;
    if (field.kind === 'radio' || field.kind === 'checkbox') {
      const checked = (field.optionIds ?? []).flatMap((id, index) => (values[id]?.checked ? [field.options[index]] : []));
      answer = checked.length === 1 || field.kind === 'radio' ? checked[0] ?? '' : checked;
    } else {
      const value = values[field.id];
      if (!value) {
        continue;
      }
      answer = String(value.value ?? '').trim();
      // A date input holds 1990-03-02; answers are written 02.03.1990
      const iso = value.type === 'date' && answer.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) {
        answer = `${iso[3]}.${iso[2]}.${iso[1]}`;
      }
    }
    const known = byTitle.get(field.title);
    if (!known || isEmpty(known.answer)) {
      byTitle.set(field.title, { title: field.title, kind: field.kind, answer });
    } else if (typeof answer === 'string' && answer && (known.kind === 'radio' || known.kind === 'checkbox')) {
      // The «Другое» box of a choice question: its text stands for that option
      const other = (option) => /^(другое|другой|other|свой вариант)/i.test(option);
      known.answer = Array.isArray(known.answer) ? known.answer.map((option) => (other(option) ? answer : option))
        : other(known.answer) ? answer : known.answer;
    }
  }
  return [...byTitle.values()];
}

/**
 * The question-answer pairs worth saving: not empty, without «[уточнить: …]» marks, not the
 * prefill's own contacts or company left unchanged, not a test assignment link (it is the link of
 * one assignment), and not an answer qa.lino already gives the same question
 * @param {Array<{title: string, answer: string|string[]}>} answers
 * @param {Object} options
 * @param {Map<string, string|string[]>} options.qaMap - Saved answers, contacts filled in
 * @param {Array<{title: string, answer: string|string[]}>} [options.prefilled] - Answers not learned while unchanged
 * @returns {Array<{question: string, answer: string|string[]}>}
 */
export function pairsToSave(answers, { qaMap, prefilled = [] }) {
  return answers.filter(({ title, answer }) => {
    if (!title || isEmpty(answer) || answerText(answer).includes(`[${TO_CHECK}`) || isAssignmentLinkQuestion(title)) {
      return false;
    }
    if (prefilled.some((item) => item.title === title && sameAnswer(item.answer, answer))) {
      return false;
    }
    const match = findBestMatch(title, qaMap);
    return !(match && sameAnswer(match.answer, answer));
  }).map(({ title, answer }) => ({ question: title, answer }));
}

/**
 * Answers the user changed and then left as they are for `stableMs`: saved before the form is
 * sent, so an edit is kept even when the form is never sent. Each value is given once; the
 * prefill's own answers (`initial`) are not, as long as they are unchanged.
 * @param {Map<string, {answer: string|string[], since: number, given: boolean}>} tracked - Kept between polls
 * @param {Array<{title: string, answer: string|string[]}>} answers - The form's answers now
 * @param {Object} options
 * @param {number} options.now
 * @param {number} [options.stableMs=EDIT_STABLE_MS]
 * @param {Array<{title: string, answer: string|string[]}>} [options.initial] - The answers as prefilled
 * @returns {Array<{title: string, answer: string|string[]}>}
 */
export function stableEdits(tracked, answers, { now, stableMs = EDIT_STABLE_MS, initial = [] }) {
  const ready = [];
  for (const answer of answers) {
    const seen = tracked.get(answer.title);
    if (!seen || !sameAnswer(seen.answer, answer.answer)) {
      tracked.set(answer.title, { answer: answer.answer, since: now, given: false });
      continue;
    }
    const asPrefilled = initial.some((item) => item.title === answer.title && sameAnswer(item.answer, answer.answer));
    if (!seen.given && !asPrefilled && !isEmpty(answer.answer) && now - seen.since >= stableMs) {
      seen.given = true;
      ready.push(answer);
    }
  }
  return ready;
}

/**
 * The prefill's answers that are not learned unless the user changes them (contacts from the
 * profile, the company of a poll, a test assignment's repository link)
 * @param {Array<Object>} planned - planAnswers() fields after the prefill
 * @returns {Array<{title: string, answer: string|string[]}>}
 */
export function notLearned(planned) {
  return planned.filter((field) => NOT_LEARNED_SOURCES.has(field.source) && !field.open)
    .map((field) => ({ title: field.title, answer: field.choices ?? field.answer ?? '' }));
}

/**
 * Whether the form was sent: it was seen, its pages are loaded, none of its controls is left, and
 * either its send button was clicked or its confirmation shows
 * @param {Object} state
 * @param {boolean} state.formSeen
 * @param {number} state.fields - Controls of the form's sites shown now
 * @param {boolean} state.ready - The form's pages have loaded
 * @param {string} state.text - The text of the form's pages
 * @param {boolean} state.submitClicked
 * @param {string[]} [state.urls] - The form's pages shown now (a /formResponse page means sent)
 * @returns {boolean}
 */
export function isSubmitted({ formSeen, fields, ready, text, submitClicked, urls = [] }) {
  return Boolean(formSeen && ready && fields === 0 && (submitClicked || CONFIRMATION.test(text ?? '') || urls.some((url) => SENT_URL.test(url))));
}

/**
 * Runs in the page: the values of the controls marked by readFormFields, the page text, and the
 * last click on a button (kept in sessionStorage and sent to the watcher's binding when there is
 * one, since a send navigates away at once). Only listeners and storage are added, nothing visible
 * @returns {{url: string, ready: boolean, text: string, values: Object, click: Object|null}}
 */
export function watchFormValues() {
  const KEY = 'hh-automation-form-click';
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const valueOf = (element) => {
    const role = element.getAttribute('role');
    if (role === 'radio' || role === 'checkbox') {
      return { checked: element.getAttribute('aria-checked') === 'true' };
    }
    if (element.type === 'radio' || element.type === 'checkbox') {
      return { checked: element.checked };
    }
    if (element.tagName === 'SELECT') {
      const option = element.selectedOptions[0];
      return { value: option && option.value !== '' ? clean(option.text) : '' };
    }
    if (role === 'listbox') {
      // Google Forms: the chosen option is selected; the «Выбрать» placeholder has an empty data-value
      const option = element.querySelector('[role="option"][aria-selected="true"]');
      return { value: option && option.getAttribute('data-value') !== '' ? clean(option.getAttribute('data-value') ?? option.innerText) : '' };
    }
    return { value: element.type === 'file' ? '' : String(element.value ?? ''), type: element.type };
  };
  const read = () => Object.fromEntries([...document.querySelectorAll('[data-prefill-id]')]
    .map((element) => [element.getAttribute('data-prefill-id'), valueOf(element)]));
  if (!window.hhAutomationFormWatch) {
    window.hhAutomationFormWatch = true;
    const record = (label) => {
      const click = { label: clean(label).slice(0, 80), at: Date.now(), values: read() };
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify(click));
      } catch {
        // Storage blocked: the binding still gets it
      }
      try {
        window.hhAutomationFormSent?.(click);
      } catch {
        // No watcher attached
      }
    };
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('button, [role="button"], input[type="submit"], input[type="button"]');
      if (button) {
        record(button.innerText || button.value || button.getAttribute('aria-label'));
      }
    }, true);
    document.addEventListener('submit', (event) => record(event.submitter?.innerText || event.submitter?.value || 'submit'), true);
  }
  let click = null;
  try {
    click = JSON.parse(window.sessionStorage.getItem(KEY));
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing recorded
  }
  return { url: window.location.href, ready: document.readyState === 'complete', text: clean(document.body?.innerText).slice(0, 3000), values: read(), click };
}

const originOf = (url) => {
  try {
    const { protocol, origin } = new URL(url);
    return /^(https?|file):$/.test(protocol) ? (origin === 'null' ? url.split('?')[0] : origin) : null;
  } catch {
    return null;
  }
};

/**
 * Watch a slot browser until its form is sent: attach over CDP, keep the answers of every page,
 * and return them once the form is sent
 * @param {Object} options
 * @param {number} options.port - The slot's remote debugging port
 * @param {number} [options.timeoutMs] - Give up after this long
 * @param {number} [options.pollMs=2000]
 * @param {Function} [options.isCurrent] - false once a newer watcher took the slot over
 * @param {Function} [options.log]
 * @returns {Promise<{submitted: boolean, answers: Array<{title: string, kind: string, answer: string|string[]}>}>}
 */
export async function watchSentAnswers({
  port, timeoutMs = 24 * 3600000, pollMs = POLL_MS, isCurrent = () => true, log = console.log, initial = [], onEdit = null,
}) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const answers = new Map();
  const fieldsByOrigin = new Map();
  const clicks = [];
  const seenClicks = new Set();
  let submitClicked = false;
  let shownSinceClick = 0;
  let streak = 0;
  const edits = new Map();
  const started = Date.now();
  // A send that navigates to another site leaves no storage behind: the binding gets the click first
  await context.exposeBinding('hhAutomationFormSent', ({ frame }, click) => clicks.push({ origin: originOf(frame.url()), click }))
    .catch((error) => log(`⚠️  No click binding (${error.message.split('\n')[0]}): clicks are read from the page`));
  const takeClick = ({ origin, click }) => {
    if (!click || seenClicks.has(click.at)) {
      return;
    }
    seenClicks.add(click.at);
    // The values as they were at the click, under the questions of that page
    answersFromSnapshot(fieldsByOrigin.get(origin), click.values ?? {}).forEach((answer) => answers.set(answer.title, answer));
    if (isSubmitClick(click.label)) {
      submitClicked = true;
      shownSinceClick = 0;
    } else if (/далее|next|назад|back|tiếp|quay lại/iu.test(click.label)) {
      submitClicked = false;
    }
  };
  try {
    while (browser.isConnected() && Date.now() - started < timeoutMs && isCurrent()) {
      let fields = 0;
      let ready = true;
      let text = '';
      const urls = [];
      clicks.splice(0).forEach(takeClick);
      const frames = browser.isConnected() ? context.pages().flatMap((page) => page.frames()) : [];
      for (const frame of frames) {
        const origin = originOf(frame.url());
        const state = origin && await frame.evaluate(watchFormValues).catch(() => null);
        if (!state) {
          continue;
        }
        takeClick({ origin, click: state.click });
        // A frame that navigates meanwhile is read on the next poll
        const read = await frame.evaluate(readFormFields).catch(() => null);
        const now = read?.fields.length && await frame.evaluate(watchFormValues).catch(() => null);
        if (now) {
          fieldsByOrigin.set(origin, read.fields);
          fields += read.fields.length;
          answersFromSnapshot(read.fields, now.values).forEach((answer) => answers.set(answer.title, answer));
        }
        if (fieldsByOrigin.has(origin)) {
          ready &&= state.ready;
          text += ` ${state.text}`;
          urls.push(state.url);
        }
      }
      // The form still shown a while after the click: it was not sent (a required answer is missing)
      if (submitClicked && fields > 0 && ++shownSinceClick >= 3) {
        submitClicked = false;
      }
      // Twice in a row, so a page between two others is not taken for the end
      streak = isSubmitted({ formSeen: fieldsByOrigin.size > 0, fields, ready, text, submitClicked, urls }) ? streak + 1 : 0;
      if (streak >= 2) {
        return { submitted: true, answers: [...answers.values()] };
      }
      // Answers changed and left as they are: saved now, before the form is sent
      const edited = onEdit && fields > 0 ? stableEdits(edits, [...answers.values()], { now: Date.now(), initial }) : [];
      if (edited.length > 0) {
        await onEdit(edited);
      }
      await sleep(pollMs);
    }
    return { submitted: false, answers: [...answers.values()] };
  } finally {
    // Disconnects only: the slot browser keeps running
    await browser.close().catch(() => {});
  }
}

/**
 * Save the sent answers to qa.lino (withContacts: contacts become {{placeholders}}, an answer that
 * reads the same as its saved template is not rewritten)
 * @param {Array<{title: string, answer: string|string[]}>} answers
 * @param {Object} options
 * @param {{readQADatabase: Function, addOrUpdateQA: Function}} options.qaDatabase
 * @param {Array<{title: string, answer: string|string[]}>} [options.prefilled]
 * @returns {Promise<Array<{question: string, answer: string|string[]}>>} The saved pairs
 */
export async function saveSentAnswers(answers, { qaDatabase, prefilled = [] }) {
  const pairs = pairsToSave(answers, { qaMap: await qaDatabase.readQADatabase(), prefilled });
  for (const { question, answer } of pairs) {
    await qaDatabase.addOrUpdateQA(question, answer);
  }
  return pairs;
}

/**
 * Start the detached watcher of a slot; a watcher already on the slot gives way to it
 * @param {Object} options
 * @param {number} options.slot
 * @param {number} options.port
 * @param {string} options.userDataDir - The slot's profile, where the watcher's state is kept
 * @param {Array<Object>} options.planned - The prefill's fields
 * @param {string} [options.reportFile] - The prefill report the saved questions are added to
 * @param {number} [options.keepOpenHours=24]
 */
export function startFormWatch({ slot, port, userDataDir, planned = [], reportFile, keepOpenHours = 24 }) {
  const stateFile = path.join(userDataDir, 'hh-automation-form-watch.json');
  const logDir = path.join(process.cwd(), 'logs', 'forms');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    id: `${Date.now()}-${process.pid}`, slot, port, reportFile, timeoutMs: keepOpenHours * 3600000, prefilled: notLearned(planned),
    initial: planned.map((field) => ({ title: field.title, answer: field.choices ?? field.answer ?? '' })),
  }));
  const output = fs.openSync(path.join(logDir, `watch-slot-${slot}.log`), 'a');
  spawn(process.execPath, [WATCH_SCRIPT, stateFile], { detached: true, stdio: ['ignore', output, output], cwd: process.cwd() }).unref();
  fs.closeSync(output);
}
