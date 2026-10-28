#!/usr/bin/env bun
/**
 * The hh.ru resumes as indented .lino files and back: `bun run cv -- export|import [options]`
 *
 * - export: every resume of the account read (bun run resume -- --all) into <out>/cv.<language>.lino,
 *   examples/cv.ru.lino and examples/cv.en.lino by default; contacts, salary and birth date are
 *   never written (the export stops when a text holds one)
 * - import: the jobs of a CV file brought to its hh.ru resume, each change prefilled in the hh.ru
 *   slot (port 9351) and saved by you with «Сохранить» in the slot window. Title,
 *   «Навыки» and «Обо мне» differences are listed for you to change. After saving, the resume is
 *   read again and what still differs is shown.
 */

import fs from 'fs/promises';
import path from 'path';
import { openSlot, tracingEnabled } from './browser-slots.mjs';
import { seedHhSession } from './login.mjs';
import { enableConfirmations, askUser, withdrawPrompt } from './confirmations.mjs';
import { formatCvChange, parseCvLino, pickResumeFor, planCvImport } from './cv.mjs';
import { exportSavedCvs, writeCvSnapshots, publishCvSnapshots } from './cv-store.mjs';
import { reviewHhCvChange } from './cv-review.mjs';
import { runCvWatch } from './cv-watch.mjs';
import {
  discardHhExperience, hhExperienceFormOpen, saveHhExperience,
} from './experience-sites.mjs';

const USAGE = `Usage: bun run cv -- <export|import|edit|watch> [file] [options]

  export                   Read every hh.ru resume into <out>/cv.<language>.lino
  import [file]            Prefill hh.ru with the jobs of a CV file (default <out>/cv.<lang>.lino), one by one
                           in the hh.ru slot; the owner saves each position in the browser
  edit <change.json>       Prepare one add/update/copy/detach change (fields + target); requires --resume
  watch                   Passively monitor the existing editor and export every confirmed Save

  --lang <ru|en>           The file to import when none is given (default ru)
  --out <dir>              Where the files are (default examples)
  --resume <hash>          The hh.ru resume to import into (default: the one with the file's title, else its language)
  --hh-port <n>            Port of the hh.ru slot (default 9351)
  --hh-browser-port <n>    The hh.ru automation browser the login is copied from (default 9322; it is left untouched)
  --keep-open-hours <n>    Close an unused slot browser after this many hours (default 24)
  --no-trace               Do not record the slot window`;
const WORKFLOW_USAGE = `
  --one                    Prepare and wait for one position only
  --detach-extra           Offer deselecting jobs absent from the desired file (never delete them)
  --confirm-save           Allow terminal y to click Save; default is owner-only browser saving
  --snapshots-out <dir>     Export actual saved CVs here after each import/edit save
  --publish                Commit/push only exported .lino files (explicit opt-in)
  --once                   Stop watch after one verified save
  --state-file <file>      Watch status (default logs/experience/cv-watch.json)`;

function parseArgs(args) {
  const parsed = {
    command: null, file: null, lang: 'ru', out: path.join(process.cwd(), 'examples'), resume: '', hhPort: 9351, hhBrowserPort: 9322,
    keepOpenHours: 24, trace: tracingEnabled(),
    one: false, detachExtra: false, manualSave: true, snapshotsOut: '', publish: false, once: false,
    stateFile: 'logs/experience/cv-watch.json',
  };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => inline ?? args[++i];
    const options = {
      '--lang': () => (parsed.lang = value()),
      '--out': () => (parsed.out = path.resolve(value())),
      '--resume': () => (parsed.resume = value()),
      '--hh-port': () => (parsed.hhPort = Number(value())),
      '--hh-browser-port': () => (parsed.hhBrowserPort = Number(value())),
      '--keep-open-hours': () => (parsed.keepOpenHours = Number(value())),
      '--no-trace': () => (parsed.trace = false),
      '--one': () => (parsed.one = true),
      '--detach-extra': () => (parsed.detachExtra = true),
      '--confirm-save': () => (parsed.manualSave = false),
      '--snapshots-out': () => (parsed.snapshotsOut = path.resolve(value())),
      '--publish': () => (parsed.publish = true),
      '--once': () => (parsed.once = true),
      '--state-file': () => (parsed.stateFile = path.resolve(value())),
    };
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE + WORKFLOW_USAGE);
      process.exit(0);
    } else if (options[flag]) {
      options[flag]();
    } else if (!parsed.command && !flag.startsWith('-')) {
      parsed.command = flag;
    } else if (['import', 'edit'].includes(parsed.command) && !parsed.file && !flag.startsWith('-')) {
      parsed.file = path.resolve(flag);
    } else {
      throw new Error(`Unknown option ${args[i]}\n\n${USAGE}`);
    }
  }
  if (!['export', 'import', 'edit', 'watch'].includes(parsed.command)) {
    console.log(USAGE + WORKFLOW_USAGE);
    process.exit(1);
  }
  return parsed;
}

/** Every hh.ru resume, exported (bun run resume -- --all) and read as a CV */
async function exportResumes(argv) {
  console.log('📄 Reading the hh.ru resumes (bun run resume -- --all)...');
  return exportSavedCvs({ port: argv.hhBrowserPort });
}

async function runExport(argv) {
  const resumes = await exportResumes(argv);
  const files = await writeCvSnapshots(resumes, argv.out);
  if (argv.publish) {
    await publishCvSnapshots(files);
  }
  files.forEach((file) => console.log(`💾 ${path.relative(process.cwd(), file)}`));
}

/** What still differs between the file and its hh.ru resume */
function printPlan({ changes, notes }) {
  changes.forEach((change) => console.log(`${formatCvChange(change)}\n`));
  notes.forEach((note) => console.log(`ℹ️  ${note}`));
}

async function runImport(argv) {
  const file = argv.file ?? path.join(argv.out, `cv.${argv.lang}.lino`);
  const wanted = parseCvLino(await fs.readFile(file, 'utf8'));
  const resumes = await exportResumes(argv);
  const target = pickResumeFor(resumes, wanted, argv.resume);
  if (!target) {
    throw new Error(`No hh.ru resume for «${wanted.title}» (${wanted.language}); pass --resume with one of: ${resumes.map((resume) => `${resume.hash} «${resume.cv.title}»`).join(', ')}`);
  }
  const plan = planCvImport(target.cv, wanted, { detachExtra: argv.detachExtra });
  console.log(`\n🔁 ${path.relative(process.cwd(), file)} → hh.ru «${target.cv.title}»: ${plan.changes.length} job change(s)\n`);
  printPlan(plan);
  if (plan.changes.length === 0) {
    console.log('✅ The jobs on hh.ru match the file');
    return;
  }

  const session = await openSlot({ name: 'hh-experience-slot', port: argv.hhPort, keepOpenHours: argv.keepOpenHours, trace: argv.trace });
  const { page } = session;
  // Only the hh.ru cookies are copied; the automation browser keeps running untouched
  await seedHhSession({ page, fromPort: argv.hhBrowserPort });
  enableConfirmations({
    steps: [],
    onStop: async () => {
      console.log('⏹️  Stopped: the current form stays prefilled in the slot window for you to review and save yourself');
      await session.release();
      process.exit(0);
    },
  });
  let touched = 0;
  for (const [index, change] of plan.changes.entries()) {
    console.log(`\n[${index + 1}/${plan.changes.length}] ${formatCvChange(change).split('\n')[0]}`);
    if (await reviewHhCvChange(page, change, argv, target.hash)) {
      touched++;
      if (argv.one) {
        break;
      }
      continue;
    }
    // «Сохранить» or «Отменить» clicked in the slot window answers the question too
    let closedInBrowser = false;
    const watch = setInterval(async () => {
      if (!closedInBrowser && !await hhExperienceFormOpen(page)) {
        closedInBrowser = true;
        clearInterval(watch);
        withdrawPrompt('the form was closed in the slot window');
      }
    }, 2000);
    const answer = await askUser(`Prefilled on hh.ru (slot window on port ${argv.hhPort}): check it, then save it?`, {
      skip: 'leave it unsaved', port: argv.hhPort,
    }).finally(() => clearInterval(watch));
    if (answer === 'continue') {
      await saveHhExperience(page);
      console.log('💾 Saved');
      touched++;
    } else if (closedInBrowser) {
      console.log('↪️  Closed in the slot window (the check below shows whether it was saved)');
      touched++;
    } else {
      await discardHhExperience(page).catch(() => {});
      console.log('↪️  Not saved');
    }
    if (argv.one) {
      break;
    }
  }
  await session.release();
  if (touched > 0) {
    const again = pickResumeFor(await exportResumes(argv), wanted, target.hash);
    const left = planCvImport(again.cv, wanted);
    console.log(`\n${left.changes.length === 0 ? '✅ The jobs on hh.ru now match the file' : `🔁 Still different on hh.ru: ${left.changes.length} job change(s)\n`}`);
    if (left.changes.length > 0) {
      printPlan({ changes: left.changes, notes: [] });
    }
  }
}

async function runEdit(argv) {
  if (!argv.file || !argv.resume) {
    throw new Error('edit requires a change.json file and --resume <hash>');
  }
  const change = JSON.parse(await fs.readFile(argv.file, 'utf8'));
  if (!['add', 'update', 'copy', 'detach'].includes(change.kind) || !change.fields || (change.kind !== 'add' && !change.target?.company)) {
    throw new Error('Invalid change: kind add/update/copy/detach, fields, and target.company for an existing position are required');
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${argv.hhPort}`);
  try {
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => /hh\.ru\/(resume|profile\/edit\/experience)/.test(candidate.url()));
    if (!page) {
      throw new Error('No existing resume editor page; open the CV in the editor slot first');
    }
    await reviewHhCvChange(page, change, { ...argv, manualSave: true }, argv.resume);
  } finally {
    await browser.close();
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  if (argv.command === 'watch') {
    return runCvWatch(argv);
  }
  if (argv.command === 'edit') {
    return runEdit(argv);
  }
  return argv.command === 'export' ? runExport(argv) : runImport(argv);
}

main().then(() => process.exit(0)).catch((error) => {
  // Playwright call logs can list request headers; keep the first line so cookies are never printed
  console.error('Error:', error.message.split('\n')[0].replace(/cookie:.*/i, 'cookie: <hidden>'));
  process.exit(1);
});
