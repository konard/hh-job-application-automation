/**
 * Prefilled forms in browser slots: each form opens in its own Chrome (slot n: port 9330+n,
 * profile ~/.hh-automation/form-slot-<n>) and is filled from the resume contacts, data/qa.lino and
 * drafts; nothing is submitted. Used by `bun run prefill-form` and by the chat answers, which
 * prefill the forms employers send in chats.
 *
 * @module form-slots
 */

import path from 'path';
import fs from 'fs/promises';
import { isAssignmentLinkQuestion, readAssignment, readAssignments } from './assignments.mjs';
import { copySession, openSlot, slotDir } from './browser-slots.mjs';
import { isBrowserRunning } from './browser-session.mjs';
import { loadContacts, withContacts } from './contacts.mjs';
import { startFormWatch } from './form-answers.mjs';
import { createQADatabase } from './qa-database.mjs';
import {
  askClaude, draftPrompt, loadProfile, pickOptions, plainText, planAnswers, readFormFields, relatedAnswers, TO_CHECK,
} from './form-prefill.mjs';

const DATA = path.join(process.cwd(), 'data');

/** Slot n is port 9330+n; slots 1-9 are for forms */
const FORM_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const CAPTCHA_URL = /showcaptcha|\/sorry\/|captcha/i;
const CAPTCHA_WAIT_MS = 30 * 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** data/profile.lino (optional, not committed): key and value, e.g. "city\n  Нячанг, Вьетнам" */
async function readProfileOverrides() {
  const entries = await createQADatabase(path.join(DATA, 'profile.lino')).readQADatabase();
  return Object.fromEntries([...entries].map(([key, value]) => [key, key === 'links' ? [value].flat() : [value].flat().join('\n')]));
}

export async function waitForCaptcha(page, log) {
  const started = Date.now();
  let told = false;
  while (CAPTCHA_URL.test(page.url()) && Date.now() - started < CAPTCHA_WAIT_MS) {
    if (!told) {
      log('🛑 The site shows a captcha: solve it in this slot\'s browser, the prefill goes on after it');
      told = true;
    }
    await sleep(2000);
  }
  if (told) {
    log(CAPTCHA_URL.test(page.url()) ? '⚠️  The captcha is still shown, giving up on this form' : '✅ Captcha passed');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }
  return !CAPTCHA_URL.test(page.url());
}

async function fill(field) {
  const locator = (id) => field.frame.locator(`[data-prefill-id="${id}"]`).first();
  if (field.file) {
    await locator(field.id).setInputFiles(field.file);
    return;
  }
  if (field.choices) {
    for (const choice of field.choices) {
      const index = field.options.indexOf(choice);
      if (field.kind === 'select') {
        await locator(field.id).selectOption({ label: choice });
      } else {
        const option = locator(field.optionIds[index]);
        const checked = await option.getAttribute('aria-checked') === 'true' || await option.isChecked().catch(() => false);
        if (!checked) {
          await option.click();
        }
      }
    }
    return;
  }
  const control = locator(field.id);
  if ((await control.inputValue().catch(() => '')).trim()) {
    field.note = 'already filled, left as it is';
    return;
  }
  // A date input takes 1990-03-02, not 02.03.1990
  const date = await control.getAttribute('type') === 'date' && field.answer.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  await control.fill(date ? `${date[3]}-${date[2]}-${date[1]}` : field.answer);
}

async function prefillSlot(url, slot, { qaMap, profile, resume }, { draft, keepOpenHours, company }) {
  const log = (message) => console.log(`[slot ${slot}] ${message}`);
  const port = 9330 + slot;
  const session = await openSlot({ name: `form-slot-${slot}`, port, keepOpenHours });
  const { page } = session;
  log(`🌐 ${url} (browser on port ${port})`);
  // hh.ru's own pages (the employer rating poll) need the hh.ru login of the automation browser
  if (/(^|\.)hh\.ru$/.test(new URL(url).hostname)) {
    const copied = await copySession({ fromPort: 9322, page, domain: /(^|\.)hh\.ru$/ });
    log(copied > 0 ? `🔑 Logged in with the hh.ru session (${copied} cookies, values not shown)` : '⚠️  Log in to hh.ru in this slot if needed');
  }
  if (page.url() !== url) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((error) => log(`⚠️  ${error.message.split('\n')[0]}`));
  }
  if (!await waitForCaptcha(page, log)) {
    return { url, slot, fields: [] };
  }
  await sleep(2000);

  // The form may be in a frame (Yandex Forms on practicum.yandex.ru): every frame is read
  const frames = [];
  for (const frame of page.frames()) {
    const read = await frame.evaluate(readFormFields).catch(() => null);
    if (read?.fields.length) {
      frames.push({ frame, read });
    }
  }
  const form = {
    title: frames.find(({ frame }) => frame === page.mainFrame())?.read.title ?? frames[0]?.read.title ?? await page.title(),
    description: '',
    fields: frames.flatMap(({ frame, read }) => read.fields.map((field) => ({ ...field, frame }))),
    hasNextPage: frames.some(({ read }) => read.hasNextPage),
  };
  log(`📝 "${form.title}": ${form.fields.length} question(s)${frames.some(({ frame }) => frame !== page.mainFrame()) ? ' (in a frame)' : ''}`);
  const planned = planAnswers(form.fields, { profile, qaMap, company });

  // A test assignment comes first: its repository is where the form's result link points
  const assignment = (await Promise.all(frames.map(({ frame }) => frame.evaluate(readAssignment).catch(() => null)))).find(Boolean);
  if (assignment) {
    const assignments = await readAssignments();
    const record = assignments[url] ?? assignments[page.url()];
    if (record) {
      log(`🧪 Test assignment «${assignment.title}»: repository ${record.repoUrl}`);
      planned.filter((field) => isAssignmentLinkQuestion(field.title) && field.kind !== 'file')
        .forEach((field) => Object.assign(field, { open: false, answer: record.repoUrl, source: 'test assignment repository' }));
    } else {
      // The assignment comes before any answer: the form is left as it is until its repository exists
      log(`🧪 Test assignment «${assignment.title}»: create its repository first, then prefill again: bun run test-assignment -- <repository name> --from ${url}`);
      await session.release();
      return { url, pageUrl: page.url(), slot, title: form.title, fields: planned.map((field) => ({ ...field, open: true, note: 'waits for the test assignment repository' })) };
    }
  }

  if (draft) {
    const open = planned.filter((field) => field.open && field.kind !== 'file');
    if (open.length > 0) {
      log(`🤖 Drafting ${open.length} answer(s) with local Claude Code from the resume and qa.lino...`);
    }
    await Promise.all(open.map(async (field) => {
      const drafted = await askClaude(draftPrompt({ form, field, resume, related: relatedAnswers(field.title, qaMap) }));
      if (!drafted) {
        return;
      }
      if (field.options?.length) {
        // The draft names options; matched like saved answers, so a small difference still fits
        const choices = pickOptions(field.options, drafted.split('\n').map((line) => line.replace(/^[-•]\s*/, '').trim()).filter(Boolean));
        if (choices.length > 0) {
          Object.assign(field, { open: false, choices, source: 'draft' });
        }
      } else {
        Object.assign(field, { open: false, answer: plainText(drafted), source: 'draft' });
      }
    }));
  }

  for (const field of planned.filter((item) => !item.open)) {
    try {
      await fill(field);
    } catch (error) {
      field.note = `not filled: ${error.message.split('\n')[0]}`;
    }
  }
  if (form.hasNextPage) {
    log('ℹ️  The form has a next page ("Далее"): open it yourself and run the prefill again for it; the answers of every page are saved when you send it');
  }
  await session.release();
  return { url, pageUrl: page.url(), slot, title: form.title, fields: planned };
}

function report({ url, slot, title, fields }) {
  const lines = [`## Slot ${slot}: ${title ?? url}`, '', url, ''];
  for (const field of fields) {
    const value = field.file ?? field.choices?.join('; ') ?? field.answer ?? '';
    const flag = field.open ? '❓ open' : field.source === 'draft' ? '🤖 draft, check it' : `✅ ${field.source}`;
    const todo = value.includes(`[${TO_CHECK}`) ? ' — has [уточнить] marks' : '';
    lines.push(`- ${flag}${todo}${field.note ? ` (${field.note})` : ''}: **${field.title}**`);
    if (field.matched) {
      lines.push(`  - saved question: ${field.matched}`);
    }
    if (value) {
      lines.push(`  - ${value.replace(/\n/g, '\n    ')}`);
    }
  }
  return lines.join('\n');
}


/**
 * Everything answers come from: contacts, saved answers (contacts filled in), the resume
 * @returns {Promise<{contacts: Object, qaDatabase: Object, qaMap: Map, profile: Object, resume: string}>}
 */
export async function loadAnswerSources() {
  const contacts = await loadContacts(path.join(DATA, 'contacts.lino'));
  const qaDatabase = withContacts(createQADatabase(path.join(DATA, 'qa.lino')), contacts);
  const { profile, resume } = await loadProfile({
    resumeMarkdown: path.join(DATA, 'resume', 'resume.md'),
    resumeJson: path.join(DATA, 'resume', 'resume.json'),
    resumeFile: path.join(DATA, 'resume', 'resume.pdf'),
    coverLetter: path.join(DATA, 'cover-letter.txt'),
    contacts,
    profileOverrides: await readProfileOverrides(),
  });
  if (!resume) {
    console.log('⚠️  data/resume/resume.md is missing: run `bun run resume` first for contacts and drafts');
  }
  return { contacts, qaDatabase, qaMap: await qaDatabase.readQADatabase(), profile, resume };
}

/**
 * The first form slot whose browser is not running
 * @returns {Promise<number>}
 */
export async function nextFreeSlot() {
  for (const slot of FORM_SLOTS) {
    if (!await isBrowserRunning(9330 + slot)) {
      return slot;
    }
  }
  return FORM_SLOTS[FORM_SLOTS.length - 1];
}

/**
 * Prefill forms, one slot each, and write the report to logs/forms/
 * @param {string[]} urls
 * @param {Object} options
 * @param {number} [options.firstSlot] - Default: the first free slot
 * @param {boolean} [options.draft=true]
 * @param {number} [options.keepOpenHours=24]
 * @param {Object} [options.sources] - loadAnswerSources()
 * @param {string} [options.company] - The employer, for a poll that asks to find it (rating.hh.ru)
 * @param {boolean} [options.learn=true] - Save the answers the user sends to qa.lino (a detached watcher per slot)
 * @returns {Promise<{text: string, reportFile: string}>}
 */
export async function prefillForms(urls, { firstSlot, draft = true, keepOpenHours = 24, sources, company, learn = true } = {}) {
  const known = sources ?? await loadAnswerSources();
  const first = firstSlot ?? await nextFreeSlot();
  const results = await Promise.all(urls.map((url, index) => prefillSlot(String(url), first + index, known, { draft, keepOpenHours, company })
    .catch((error) => {
      console.log(`[slot ${first + index}] ❌ ${error.message}`);
      return { url, slot: first + index, fields: [], failed: true };
    })));
  const learned = learn ? ' What you send is saved to data/qa.lino.' : '';
  const text = `# Prefilled forms (${new Date().toISOString()})\n\nNothing was submitted: review each slot's browser, change what is needed and send it yourself.${learned}\n\n${results.map(report).join('\n\n')}\n`;
  const reportDir = path.join(process.cwd(), 'logs', 'forms');
  await fs.mkdir(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  await fs.writeFile(reportFile, text);
  if (learn) {
    // The prefill exits while the forms wait for the user: a watcher per slot learns what is sent
    for (const result of results.filter((item) => !item.failed)) {
      startFormWatch({
        slot: result.slot, port: 9330 + result.slot, userDataDir: slotDir(`form-slot-${result.slot}`), planned: result.fields, reportFile, keepOpenHours,
      });
    }
  }
  return { text, reportFile, results };
}
