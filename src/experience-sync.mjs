#!/usr/bin/env bun
/**
 * Work experience of hh.ru and LinkedIn: export both, show the differences, and sync one side
 * to the other with translation: `bun run experience -- export|diff|sync [options]`
 *
 * - export: hh.ru from `bun run resume` (data/resume/resume.json, exported first when missing),
 *   LinkedIn from the profile's experience page in its own browser slot (port 9350); both are
 *   saved to data/resume/experience.json (personal data, not committed)
 * - diff: jobs matched across the sides, titles and descriptions compared through translations
 *   by Haiku, Luna and Formal AI (shown side by side); a report goes to logs/experience/
 * - sync --to linkedin|hh: the changes that bring that side in line with the other, translated,
 *   prefilled one by one in the target site's form in a browser slot. Each is saved only when
 *   you type `y`; `s` skips it, `q` stops and leaves the current form prefilled for you.
 *   `--auto` runs the export, the diff and the sync in one go, still asking before each save.
 *
 * Formal AI failures are reported to its repository (deduplicated), see translation.mjs.
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { openSlot, copySession } from './browser-slots.mjs';
import { enableConfirmations, askUser } from './confirmations.mjs';
import {
  applySyncDecision, detectLanguage, diffExperience, formatChange, formatDiffReport, linkedInItemsFromText, normalizeHhJobs, normalizeLinkedInJobs,
  planSync,
} from './experience.mjs';
import {
  discardHhExperience, discardLinkedInPosition, hasFillableFields, LINKEDIN_PROFILE, prefillHhExperience, prefillLinkedInPosition,
  readLinkedInExperience, saveHhExperience, saveLinkedInPosition,
} from './experience-sites.mjs';
import { createTranslator, reportFormalAiFailures, TRANSLATORS, FORMAL_AI_REPO } from './translation.mjs';

const USAGE = `Usage: bun run experience -- <export|diff|sync> [options]

  export                   Export work experience of hh.ru and LinkedIn to data/resume/experience.json
  diff                     Show the differences (exports first when there is no export yet)
  sync --to linkedin|hh    Prefill the changes on that site, saving each only after you type y

  --to <linkedin|hh>       The side to change (sync)
  --auto                   Export again, diff and sync in one go (still asks before every save)
  --refresh-hh             Export the hh.ru resume again (bun run resume) instead of reading resume.json
  --skip-linkedin          Use the LinkedIn part of the last export
  --profile <url>          LinkedIn profile (default ${LINKEDIN_PROFILE})
  --translators <list>     Comma-separated: ${TRANSLATORS.join(', ')} (default: all)
  --no-report-formal-ai    Do not report Formal AI failures to ${FORMAL_AI_REPO}
  --dry-run-issues         Only print the Formal AI issues that would be filed
  --linkedin-port <n>      Port of the LinkedIn slot (default 9350)
  --hh-port <n>            Port of the hh.ru slot used by sync --to hh (default 9351)
  --hh-browser-port <n>    The hh.ru automation browser the login is copied from (default 9322; it is left untouched)
  --keep-open-hours <n>    Close an unused slot browser after this many hours (default 24)`;

/** Plain flags: the command, and the options above */
function parseArgs(args) {
  const parsed = {
    command: null, to: null, auto: false, refreshHh: false, skipLinkedin: false, profile: LINKEDIN_PROFILE,
    translators: TRANSLATORS, reportFormalAi: true, dryRunIssues: false, linkedinPort: 9350, hhPort: 9351,
    hhBrowserPort: 9322, keepOpenHours: 24,
  };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => inline ?? args[++i];
    const options = {
      '--to': () => (parsed.to = value()),
      '--auto': () => (parsed.auto = true),
      '--refresh-hh': () => (parsed.refreshHh = true),
      '--skip-linkedin': () => (parsed.skipLinkedin = true),
      '--profile': () => (parsed.profile = value()),
      '--translators': () => (parsed.translators = value().split(',').map((name) => name.trim()).filter(Boolean)),
      '--no-report-formal-ai': () => (parsed.reportFormalAi = false),
      '--dry-run-issues': () => (parsed.dryRunIssues = true),
      '--linkedin-port': () => (parsed.linkedinPort = Number(value())),
      '--hh-port': () => (parsed.hhPort = Number(value())),
      '--hh-browser-port': () => (parsed.hhBrowserPort = Number(value())),
      '--keep-open-hours': () => (parsed.keepOpenHours = Number(value())),
    };
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (options[flag]) {
      options[flag]();
    } else if (!parsed.command && !flag.startsWith('-')) {
      parsed.command = flag;
    } else {
      throw new Error(`Unknown option ${args[i]}\n\n${USAGE}`);
    }
  }
  if (!['export', 'diff', 'sync'].includes(parsed.command)) {
    console.log(USAGE);
    process.exit(1);
  }
  if (parsed.command === 'sync' && !['linkedin', 'hh'].includes(parsed.to)) {
    throw new Error('sync needs --to linkedin or --to hh');
  }
  const unknown = parsed.translators.filter((name) => !TRANSLATORS.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown translator(s): ${unknown.join(', ')}. Use: ${TRANSLATORS.join(', ')}`);
  }
  return parsed;
}

const RESUME_DIR = path.join(process.cwd(), 'data', 'resume');
const EXPORT_FILE = path.join(RESUME_DIR, 'experience.json');
const readJson = (file) => fs.readFile(file, 'utf8').then(JSON.parse, () => null);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** hh.ru's resume export, running `bun run resume` when there is none (or on --refresh-hh) */
async function exportHh(argv) {
  const file = path.join(RESUME_DIR, 'resume.json');
  if (argv.refreshHh || !await readJson(file)) {
    console.log('📄 Exporting the hh.ru resume (bun run resume)...');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./resume-export.mjs', import.meta.url)),
        '--browser-port', String(argv.hhBrowserPort)], { stdio: 'inherit' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`bun run resume exited with ${code}`))));
    });
  }
  const resume = await readJson(file);
  return { url: resume.url, hash: resume.hash, jobs: normalizeHhJobs(resume) };
}

/** LinkedIn's experience page in its slot (the slot stays open, logged in, for later runs) */
async function exportLinkedIn(argv) {
  const session = await openSlot({ name: 'linkedin-slot', port: argv.linkedinPort, keepOpenHours: argv.keepOpenHours });
  try {
    console.log(`🌐 LinkedIn slot on port ${argv.linkedinPort}: ${argv.profile}`);
    const { items, text, url } = await readLinkedInExperience(session.page, { profileUrl: argv.profile, port: argv.linkedinPort });
    let jobs = normalizeLinkedInJobs(items);
    // LinkedIn's markup changes; its text keeps the same order of lines
    if (jobs.length === 0) {
      jobs = normalizeLinkedInJobs(linkedInItemsFromText(text));
      if (jobs.length > 0) {
        console.log(`ℹ️  The page's items were not recognized: ${jobs.length} position(s) read from its text`);
      }
    }
    // The page text is kept so the parsing can be checked against what LinkedIn showed
    await fs.writeFile(path.join(RESUME_DIR, 'linkedin-experience.txt'), text);
    if (jobs.length === 0) {
      console.log('⚠️  No positions were read from the LinkedIn page; its text is in data/resume/linkedin-experience.txt');
    }
    return { url, profile: argv.profile, jobs, items };
  } finally {
    await session.release();
  }
}

async function runExport(argv) {
  await fs.mkdir(RESUME_DIR, { recursive: true });
  const previous = await readJson(EXPORT_FILE);
  const hh = await exportHh(argv);
  const linkedin = argv.skipLinkedin && previous?.linkedin ? previous.linkedin : await exportLinkedIn(argv);
  const data = { exportedAt: new Date().toISOString(), hh, linkedin };
  await fs.writeFile(EXPORT_FILE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`💾 ${EXPORT_FILE}: ${hh.jobs.length} hh.ru job(s), ${linkedin.jobs.length} LinkedIn job(s)`);
  return data;
}

/** Diff both sides; texts in Russian are compared through their English translations */
async function runDiff(argv, data) {
  const translator = await createTranslator({ translators: argv.translators, cachePath: path.join(RESUME_DIR, 'translations.json') });
  const allJobs = [...data.hh.jobs, ...data.linkedin.jobs];
  await translator.translate(allJobs.flatMap((job) => [job.title, job.description]).filter((text) => text && detectLanguage(text) === 'ru'), 'en');
  const diff = diffExperience(data.hh.jobs, data.linkedin.jobs, { translationsOf: (text) => translator.translationsOf(text, 'en') });
  const report = formatDiffReport(diff, { variantsOf: (text) => (detectLanguage(text) === 'ru' ? translator.variantsOf(text, 'en') : []) });
  return { diff, report, translator };
}

/** Report Formal AI's failures (deduplicated) and return the report lines */
async function reportFailures(argv, translator) {
  const failures = translator.failures().map((failure) => ({
    ...failure,
    others: translator.variantsOf(failure.text, failure.to).filter((variant) => !variant.name.startsWith('Formal AI') && variant.text)
      .map((variant) => `${variant.name}: ${variant.text.replace(/\n/g, ' ')}`),
  }));
  if (failures.length === 0) {
    return translator.models['formal-ai'] ? ['## Formal AI', '', `Formal AI ${translator.models['formal-ai']} translated every text.`] : [];
  }
  const lines = ['## Formal AI', '', `Formal AI ${translator.models['formal-ai']} failed on ${failures.length} text(s).`, ''];
  if (!argv.reportFormalAi) {
    return [...lines, 'Not reported (--no-report-formal-ai).'];
  }
  const results = await reportFormalAiFailures({ failures, version: translator.models['formal-ai'], dryRun: argv.dryRunIssues })
    .catch((error) => [{ kind: 'all', action: `not reported: ${error.message.split('\n')[0]}`, url: null }]);
  for (const result of results) {
    const line = `- ${result.kind}: ${result.action}${result.url ? ` ${result.url}` : ''}${result.title ? ` («${result.title}»)` : ''}`;
    console.log(`🐞 Formal AI ${line.slice(2)}`);
    lines.push(line);
  }
  return lines;
}

async function writeReport(name, text) {
  const dir = path.join(process.cwd(), 'logs', 'experience');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${stamp()}${name ? `-${name}` : ''}.md`);
  await fs.writeFile(file, text);
  return file;
}

/** Prefill each change in the target site's slot and save it only on the user's `y` */
async function runSync(argv, data, diff, translator) {
  const lang = argv.to === 'linkedin' ? 'en' : 'ru';
  const sourceJobs = argv.to === 'linkedin' ? data.hh.jobs : data.linkedin.jobs;
  await translator.translate(sourceJobs.flatMap((job) => [job.title, job.description]), lang);
  const changes = planSync(diff, argv.to, (text, to) => translator.chosen(text, to));
  const site = argv.to === 'linkedin' ? 'LinkedIn' : 'hh.ru';
  console.log(`\n🔁 ${changes.length} change(s) to bring ${site} in line with ${argv.to === 'linkedin' ? 'hh.ru' : 'LinkedIn'}:\n`);
  changes.forEach((change) => console.log(`${formatChange(change, argv.to)}\n`));
  const planText = changes.map((change) => formatChange(change, argv.to)).join('\n\n');
  if (changes.length === 0) {
    return { changes, planText, done: [] };
  }

  const session = argv.to === 'linkedin'
    ? await openSlot({ name: 'linkedin-slot', port: argv.linkedinPort, keepOpenHours: argv.keepOpenHours })
    : await openSlot({ name: 'hh-experience-slot', port: argv.hhPort, keepOpenHours: argv.keepOpenHours });
  const { page } = session;
  if (argv.to === 'hh') {
    // Only the hh.ru cookies are copied; the automation browser keeps running untouched
    const copied = await copySession({ fromPort: argv.hhBrowserPort, page, domain: /(^|\.)hh\.ru$/ });
    console.log(copied > 0 ? `🔑 hh.ru login copied from the browser on port ${argv.hhBrowserPort}` : `⚠️  No browser on port ${argv.hhBrowserPort} to copy the hh.ru login from: log in in the slot window`);
  }
  const done = [];
  enableConfirmations({
    steps: [],
    onStop: async () => {
      console.log('⏹️  Stopped: the current form stays prefilled in the slot window for you to review and save yourself');
      await session.release();
      process.exit(0);
    },
  });
  for (const [index, change] of changes.entries()) {
    console.log(`\n[${index + 1}/${changes.length}] ${formatChange(change, argv.to).split('\n')[0]}`);
    if (!hasFillableFields(change, argv.to)) {
      // Nothing for the form (e.g. hh.ru keeps skills per resume): a note for the user, no form opened
      change.notes.forEach((note) => console.log(`   ℹ️  ${note}`));
      done.push({ change, result: 'left to you (nothing to fill in the form)', notes: change.notes });
      continue;
    }
    const notes = argv.to === 'linkedin'
      ? await prefillLinkedInPosition(page, change, { profileUrl: argv.profile, port: argv.linkedinPort }).catch((error) => [`prefill failed: ${error.message.split('\n')[0]}`])
      : await prefillHhExperience(page, change, { resumeHash: data.hh.hash }).catch((error) => [`prefill failed: ${error.message.split('\n')[0]}`]);
    notes.forEach((note) => console.log(`   ℹ️  ${note}`));
    const answer = await askUser(`Prefilled on ${site} (slot window on port ${argv.to === 'linkedin' ? argv.linkedinPort : argv.hhPort}): check it, then save it?`, {
      skip: 'skip it (nothing is saved)',
    });
    const outcome = await applySyncDecision(
      answer, change, notes,
      () => (argv.to === 'linkedin' ? saveLinkedInPosition(page) : saveHhExperience(page)),
      // Nothing of a skipped/withdrawn change stays in the form
      () => (argv.to === 'linkedin' ? discardLinkedInPosition(page) : discardHhExperience(page)),
    );
    if (outcome.result === 'saved') {
      console.log('💾 Saved');
    }
    done.push(outcome);
  }
  await session.release();
  return { changes, planText, done };
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  let data = argv.command === 'export' || argv.auto ? null : await readJson(EXPORT_FILE);
  data ??= await runExport(argv);
  if (argv.command === 'export') {
    return;
  }
  if (data.linkedin.jobs.length === 0) {
    throw new Error('The LinkedIn export has no positions; run `bun run experience -- export` again after logging in');
  }
  const { diff, report, translator } = await runDiff(argv, data);
  // The translations side by side are in the report file; the console gets the differences
  console.log(`\n${formatDiffReport(diff)}`);
  let text = report;
  if (argv.command === 'sync') {
    const { planText, done } = await runSync(argv, data, diff, translator);
    text += `\n## Sync to ${argv.to === 'linkedin' ? 'LinkedIn' : 'hh.ru'}\n\n${planText ? `\`\`\`\n${planText}\n\`\`\`` : 'Nothing to change.'}\n`;
    if (done.length > 0) {
      text += `\n${done.map(({ change, result }) => `- ${result}: ${change.kind} ${(change.target ?? change.source).company}`).join('\n')}\n`;
    }
  }
  const formalAi = await reportFailures(argv, translator);
  if (formalAi.length > 0) {
    text += `\n${formalAi.join('\n')}\n`;
  }
  console.log(`📄 Report: ${await writeReport(argv.command, text)}`);
}

main().then(() => process.exit(0)).catch((error) => {
  // Playwright call logs can list request headers; keep the first line so cookies are never printed
  console.error('Error:', error.message.split('\n')[0].replace(/cookie:.*/i, 'cookie: <hidden>'));
  process.exit(1);
});
