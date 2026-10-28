#!/usr/bin/env bun
/**
 * The hh.ru resumes as indented .lino files and back: `bun run cv -- export|import [options]`
 *
 * - export: every resume of the account read (bun run resume -- --all) into <out>/cv.<language>.lino,
 *   examples/cv.ru.lino and examples/cv.en.lino by default; contacts, salary and birth date are
 *   never written (the export stops when a text holds one)
 * - import: jobs and About from a CV file brought to its hh.ru resume, each change prefilled in the hh.ru
 *   slot (port 9351) and saved by you with «Сохранить» in the slot window. Title and
 *   «Навыки» differences are listed for you to change. After saving, the resume is
 *   read again and what still differs is shown.
 */

import fs from 'fs/promises';
import path from 'path';
import { openSlot, tracingEnabled } from './browser-slots.mjs';
import { seedHhSession } from './login.mjs';
import { enableConfirmations, askUser, withdrawPrompt } from './confirmations.mjs';
import { formatCvChange, parseCvLino, pickResumeFor, planCvImport } from './cv.mjs';
import { exportSavedCvs, writeCvSnapshots, publishCvSnapshots } from './cv-store.mjs';
import { reviewHhCvChange, reviewCvSequence, waitForSavedCvCheckpoint } from './cv-review.mjs';
import { runCvWatch } from './cv-watch.mjs';
import { planCvTechnologySync, verifyCvTechnologyCoverage } from './cv-technologies.mjs';
import { loadTechnologyAliases } from './vacancy-analysis.mjs';
import {
  discardHhExperience, hhExperienceFormOpen, saveHhExperience,
} from './experience-sites.mjs';

const USAGE = `Usage: bun run cv -- <export|import|edit|batch|watch|technologies> [file] [options]

  export                   Read every hh.ru resume into <out>/cv.<language>.lino
  import [file]            Prefill jobs and About from a CV file (default <out>/cv.<lang>.lino), one by one
                           in the hh.ru slot; the owner saves each change in the browser
  edit <change.json>       Prepare one add/update/copy/detach/about change (fields + target + resume hash)
  batch <changes.json>     Review a JSON array of changes, including each copy's deselection, one Save at a time
  watch                   Passively monitor the existing editor and export every confirmed Save
  technologies            Audit all position lists and both About inventories; write private drafts and changes.json

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
  --state-file <file>      Watch status (default logs/experience/cv-watch.json)
  --after-checkpoint <f>   Start edit/batch only when the preceding checkpoint is saved_by_user
  --review                Review the technology plan in the browser, one user Save at a time`;

function parseArgs(args) {
  const parsed = {
    command: null, file: null, lang: 'ru', out: path.join(process.cwd(), 'examples'), resume: '', hhPort: 9351, hhBrowserPort: 9322,
    keepOpenHours: 24, trace: tracingEnabled(),
    one: false, detachExtra: false, manualSave: true, snapshotsOut: '', publish: false, once: false,
    stateFile: 'logs/experience/cv-watch.json', afterCheckpoint: '', review: false, outExplicit: false,
  };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => inline ?? args[++i];
    const options = {
      '--lang': () => (parsed.lang = value()),
      '--out': () => { parsed.out = path.resolve(value()); parsed.outExplicit = true; },
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
      '--after-checkpoint': () => (parsed.afterCheckpoint = path.resolve(value())),
      '--review': () => (parsed.review = true),
    };
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE + WORKFLOW_USAGE);
      process.exit(0);
    } else if (options[flag]) {
      options[flag]();
    } else if (!parsed.command && !flag.startsWith('-')) {
      parsed.command = flag;
    } else if (['import', 'edit', 'batch'].includes(parsed.command) && !parsed.file && !flag.startsWith('-')) {
      parsed.file = path.resolve(flag);
    } else {
      throw new Error(`Unknown option ${args[i]}\n\n${USAGE}`);
    }
  }
  if (!['export', 'import', 'edit', 'batch', 'watch', 'technologies'].includes(parsed.command)) {
    console.log(USAGE + WORKFLOW_USAGE);
    process.exit(1);
  }
  if (parsed.command === 'technologies' && !parsed.outExplicit) parsed.out = path.join(process.cwd(), 'data', 'resume', 'technology-plan');
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
  if (!argv.file) {
    throw new Error('edit/batch requires a change JSON file');
  }
  const input = JSON.parse(await fs.readFile(argv.file, 'utf8'));
  const changes = argv.command === 'batch' ? input : [input];
  if (!Array.isArray(changes) || changes.length === 0 || changes.some((change) =>
    !['add', 'update', 'copy', 'detach', 'about'].includes(change.kind) || !change.fields ||
    (change.kind === 'about' ? typeof change.fields.about !== 'string' : change.kind !== 'add' && !change.target?.company) ||
    !(change.resumeHash ?? argv.resume))) {
    throw new Error('Invalid changes: kind, fields, target for an existing position, and a resume hash are required');
  }
  if (argv.afterCheckpoint) {
    console.log(`Waiting for the preceding verified Save: ${argv.afterCheckpoint}`);
    await waitForSavedCvCheckpoint(argv.afterCheckpoint);
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${argv.hhPort}`);
  try {
    const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => /hh\.ru\/(resume|profile\/edit\/experience)/.test(candidate.url()));
    if (!page) {
      throw new Error('No existing resume editor page; open the CV in the editor slot first');
    }
    const review = (change) => reviewHhCvChange(page, change, { ...argv, manualSave: true }, change.resumeHash ?? argv.resume);
    if (argv.command === 'batch') {
      await reviewCvSequence(changes, review);
      console.log('All queued CV changes were saved and verified.');
    } else {
      await review(changes[0]);
    }
  } finally {
    await browser.close();
  }
}

async function runTechnologies(argv) {
  const resumes = await exportResumes(argv);
  const catalog = await loadTechnologyAliases();
  const plan = planCvTechnologySync(resumes, catalog);
  await fs.mkdir(argv.out, { recursive: true });
  await fs.writeFile(path.join(argv.out, 'audit.json'), `${JSON.stringify(plan, null, 2)}\n`);
  const file = path.join(argv.out, 'changes.json');
  await fs.writeFile(file, `${JSON.stringify(plan.changes, null, 2)}\n`);
  for (const proposal of plan.proposals) await fs.writeFile(path.join(argv.out, `about.${proposal.language}.txt`), `${proposal.about}\n`);
  console.log(`Technology audit: ${plan.technologies.length} unique entries, ${plan.aboutDuplicates.length} About duplicates, ${plan.positionDuplicates.length} position duplicates.`);
  plan.proposals.forEach((proposal) => console.log(`  ${proposal.language}: ${proposal.missing.length} entries absent from About, proposed length ${proposal.about.length}.`));
  console.log(`  Reviewed steps: ${plan.changes.length}; draft plan: ${file}`);
  if (plan.unmatched.length) throw new Error('Some positions could not be paired unambiguously; inspect audit.json before reviewing');
  if (argv.review && plan.changes.length) {
    await runEdit({ ...argv, command: 'batch', file, manualSave: true });
    const result = verifyCvTechnologyCoverage(await exportResumes(argv), catalog);
    await fs.writeFile(path.join(argv.out, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(result.complete ? 'All position lists and both About inventories passed the technology audit.' : 'Saved changes retained; the technology audit still has differences. See verification.json.');
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  if (argv.command === 'watch') {
    return runCvWatch(argv);
  }
  if (argv.command === 'technologies') return runTechnologies(argv);
  if (argv.command === 'edit' || argv.command === 'batch') {
    return runEdit(argv);
  }
  return argv.command === 'export' ? runExport(argv) : runImport(argv);
}

main().then(() => process.exit(0)).catch((error) => {
  // Playwright call logs can list request headers; keep the first line so cookies are never printed
  console.error('Error:', error.message.split('\n')[0].replace(/cookie:.*/i, 'cookie: <hidden>'));
  process.exit(1);
});
