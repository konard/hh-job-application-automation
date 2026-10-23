#!/usr/bin/env bun
/**
 * The hh.ru resumes as indented .lino files and back: `bun run cv -- export|import [options]`
 *
 * - export: every resume of the account read (bun run resume -- --all) into <out>/cv.<language>.lino,
 *   examples/cv.ru.lino and examples/cv.en.lino by default; contacts, salary and birth date are
 *   never written (the export stops when a text holds one)
 * - import: the jobs of a CV file brought to its hh.ru resume, each change prefilled in the hh.ru
 *   slot (port 9351) and saved only on `y`, or by you with «Сохранить» in the slot window. Title,
 *   «Навыки» and «Обо мне» differences are listed for you to change. After saving, the resume is
 *   read again and what still differs is shown.
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { openSlot, tracingEnabled } from './browser-slots.mjs';
import { seedHhSession } from './login.mjs';
import { enableConfirmations, askUser, withdrawPrompt } from './confirmations.mjs';
import { formatCvChange, formatCvLino, parseCvLino, pickResumeFor, planCvImport, privateDetails, resumeToCv } from './cv.mjs';
import {
  discardHhExperience, hhExperienceFormOpen, hhExperienceResumes, prefillHhExperience, saveHhExperience, setHhExperienceResumes,
} from './experience-sites.mjs';

const USAGE = `Usage: bun run cv -- <export|import> [file] [options]

  export                   Read every hh.ru resume into <out>/cv.<language>.lino
  import [file]            Prefill hh.ru with the jobs of a CV file (default <out>/cv.<lang>.lino), one by one
                           in the hh.ru slot; each is saved only after you type y or click «Сохранить» there

  --lang <ru|en>           The file to import when none is given (default ru)
  --out <dir>              Where the files are (default examples)
  --resume <hash>          The hh.ru resume to import into (default: the one with the file's title, else its language)
  --hh-port <n>            Port of the hh.ru slot (default 9351)
  --hh-browser-port <n>    The hh.ru automation browser the login is copied from (default 9322; it is left untouched)
  --keep-open-hours <n>    Close an unused slot browser after this many hours (default 24)
  --no-trace               Do not record the slot window`;

function parseArgs(args) {
  const parsed = {
    command: null, file: null, lang: 'ru', out: path.join(process.cwd(), 'examples'), resume: '', hhPort: 9351, hhBrowserPort: 9322,
    keepOpenHours: 24, trace: tracingEnabled(),
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
    };
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (options[flag]) {
      options[flag]();
    } else if (!parsed.command && !flag.startsWith('-')) {
      parsed.command = flag;
    } else if (parsed.command === 'import' && !parsed.file && !flag.startsWith('-')) {
      parsed.file = path.resolve(flag);
    } else {
      throw new Error(`Unknown option ${args[i]}\n\n${USAGE}`);
    }
  }
  if (!['export', 'import'].includes(parsed.command)) {
    console.log(USAGE);
    process.exit(1);
  }
  return parsed;
}

const EXPORT_DIR = path.join(process.cwd(), 'data', 'resume', 'cv');

/** Every hh.ru resume, exported (bun run resume -- --all) and read as a CV */
async function exportResumes(argv) {
  console.log('📄 Reading the hh.ru resumes (bun run resume -- --all)...');
  await fs.rm(EXPORT_DIR, { recursive: true, force: true });
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./resume-export.mjs', import.meta.url)),
      '--all', '--out', EXPORT_DIR, '--formats', 'txt', '--browser-port', String(argv.hhBrowserPort)], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bun run resume exited with ${code}`))));
  });
  const resumes = [];
  for (const hash of await fs.readdir(EXPORT_DIR)) {
    const resume = JSON.parse(await fs.readFile(path.join(EXPORT_DIR, hash, 'resume.json'), 'utf8'));
    resumes.push({ hash, cv: resumeToCv(resume) });
  }
  return resumes;
}

async function runExport(argv) {
  const resumes = await exportResumes(argv);
  await fs.mkdir(argv.out, { recursive: true });
  const languages = resumes.map((resume) => resume.cv.language);
  for (const { hash, cv } of resumes) {
    const text = formatCvLino(cv);
    const found = privateDetails(text);
    if (found.length > 0) {
      throw new Error(`The resume «${cv.title}» holds ${found.join(', ')}: not written, remove it from the resume or write the file elsewhere`);
    }
    // Two resumes in one language are told apart by the start of their hash
    const name = languages.filter((language) => language === cv.language).length > 1 ? `cv.${cv.language}.${hash.slice(0, 6)}.lino` : `cv.${cv.language}.lino`;
    await fs.writeFile(path.join(argv.out, name), text);
    console.log(`💾 ${path.relative(process.cwd(), path.join(argv.out, name))}: «${cv.title}», ${cv.jobs.length} job(s), ${cv.skills.length} skill(s)`);
  }
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
  const plan = planCvImport(target.cv, wanted);
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
    const notes = await prefillHhExperience(page, change, { resumeHash: target.hash, port: argv.hhPort })
      .catch((error) => [`prefill failed: ${error.message.split('\n')[0]}`]);
    if (!await hhExperienceFormOpen(page)) {
      notes.forEach((note) => console.log(`   ℹ️  ${note}`));
      console.log('   ↪️  Left to you: the form did not open');
      continue;
    }
    // A job is one for the whole profile: a new one goes to this resume only, an edit shows everywhere it is
    if (change.kind === 'add') {
      await setHhExperienceResumes(page, [target.hash]);
    } else {
      const others = (await hhExperienceResumes(page)).filter((resume) => resume.checked && resume.hash !== target.hash);
      const titles = others.map((other) => resumes.find((resume) => resume.hash === other.hash)?.cv.title ?? other.hash);
      if (titles.length > 0) {
        notes.push(`this job is shown in «${titles.join('», «')}» too: saving changes it there as well`);
      }
    }
    notes.forEach((note) => console.log(`   ℹ️  ${note}`));
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

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  return argv.command === 'export' ? runExport(argv) : runImport(argv);
}

main().then(() => process.exit(0)).catch((error) => {
  // Playwright call logs can list request headers; keep the first line so cookies are never printed
  console.error('Error:', error.message.split('\n')[0].replace(/cookie:.*/i, 'cookie: <hidden>'));
  process.exit(1);
});
