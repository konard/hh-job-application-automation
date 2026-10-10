#!/usr/bin/env bun
/**
 * Prefill external application forms for review: `bun run prefill-form -- <url> [<url> ...]`
 *
 * Each form opens in its own browser slot (a separate Chrome with its own profile and port,
 * apart from the hh.ru automation browser), so they can be reviewed side by side. The answers
 * come from the exported resume (contacts, resume file), data/qa.lino (similar questions), and
 * for the rest drafts by local Claude Code from the resume and saved answers, with «[уточнить: …]»
 * where only the user knows the fact. Nothing is submitted; the browsers stay open.
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { connectOrLaunchBrowser } from './browser-session.mjs';
import { loadContacts, withContacts } from './contacts.mjs';
import { createQADatabase } from './qa-database.mjs';
import {
  askClaude, draftPrompt, loadProfile, pickOptions, planAnswers, readFormFields, relatedAnswers, TO_CHECK,
} from './form-prefill.mjs';

const USAGE = `Usage: bun run prefill-form -- <url> [<url> ...] [options]

  --first-slot <n>       Slot of the first form: port 9330+n, profile ~/.hh-automation/form-slot-<n> (default 1)
  --no-draft             Do not draft unknown answers with local Claude Code
  --keep-open-hours <n>  Close an unused slot browser after this many hours (default 24)`;

/** Plain flags: the URLs, and the options above */
function parseArgs(args) {
  const parsed = { _: [], firstSlot: 1, draft: true, keepOpenHours: 24 };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=');
    const value = () => Number(inline ?? args[++i]);
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (flag === '--first-slot') {
      parsed.firstSlot = value();
    } else if (flag === '--no-draft') {
      parsed.draft = false;
    } else if (flag === '--keep-open-hours') {
      parsed.keepOpenHours = value();
    } else {
      parsed._.push(args[i]);
    }
  }
  if (parsed._.length === 0) {
    console.log(USAGE);
    process.exit(1);
  }
  return parsed;
}

const argv = parseArgs(process.argv.slice(2));

const DATA = path.join(process.cwd(), 'data');
const CAPTCHA_URL = /showcaptcha|\/sorry\/|captcha/i;
const CAPTCHA_WAIT_MS = 30 * 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** data/profile.lino (optional, not committed): key and value, e.g. "city\n  Нячанг, Вьетнам" */
async function readProfileOverrides() {
  const entries = await createQADatabase(path.join(DATA, 'profile.lino')).readQADatabase();
  return Object.fromEntries([...entries].map(([key, value]) => [key, key === 'links' ? [value].flat() : [value].flat().join('\n')]));
}

async function waitForCaptcha(page, log) {
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

async function prefillSlot(url, slot, { qaMap, profile, resume }) {
  const log = (message) => console.log(`[slot ${slot}] ${message}`);
  const port = 9330 + slot;
  const session = await connectOrLaunchBrowser({
    engine: 'playwright',
    userDataDir: path.join(os.homedir(), '.hh-automation', `form-slot-${slot}`),
    port,
    keepOpen: true,
    idleTimeoutMinutes: argv.keepOpenHours * 60,
    singleTab: true,
  });
  const { page } = session;
  log(`🌐 ${url} (browser on port ${port})`);
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
  const planned = planAnswers(form.fields, { profile, qaMap });

  if (argv.draft) {
    const open = planned.filter((field) => field.open && field.kind !== 'file');
    if (open.length > 0) {
      log(`🤖 Drafting ${open.length} answer(s) with local Claude Code from the resume and qa.lino...`);
    }
    await Promise.all(open.map(async (field) => {
      const draft = await askClaude(draftPrompt({ form, field, resume, related: relatedAnswers(field.title, qaMap) }));
      if (!draft) {
        return;
      }
      if (field.options?.length) {
        // The draft names options; matched like saved answers, so a small difference still fits
        const choices = pickOptions(field.options, draft.split('\n').map((line) => line.replace(/^[-•]\s*/, '').trim()).filter(Boolean));
        if (choices.length > 0) {
          Object.assign(field, { open: false, choices, source: 'draft' });
        }
      } else {
        Object.assign(field, { open: false, answer: draft, source: 'draft' });
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
    log('ℹ️  The form has a next page ("Далее"): open it yourself and run the prefill again for it');
  }
  await session.release();
  return { url, slot, title: form.title, fields: planned };
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

const contacts = await loadContacts(path.join(DATA, 'contacts.lino'));
const qaMap = await withContacts(createQADatabase(path.join(DATA, 'qa.lino')), contacts).readQADatabase();
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

const results = await Promise.all(argv._.map((url, index) => prefillSlot(String(url), argv.firstSlot + index, { qaMap, profile, resume })
  .catch((error) => {
    console.log(`[slot ${argv.firstSlot + index}] ❌ ${error.message}`);
    return { url, slot: argv.firstSlot + index, fields: [] };
  })));

const text = `# Prefilled forms (${new Date().toISOString()})\n\nNothing was submitted: review each slot's browser, change what is needed and send it yourself.\n\n${results.map(report).join('\n\n')}\n`;
const reportDir = path.join(process.cwd(), 'logs', 'forms');
await fs.mkdir(reportDir, { recursive: true });
const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
await fs.writeFile(reportFile, text);
console.log(`\n${text}\n📄 Report: ${reportFile}`);
process.exit(0);
