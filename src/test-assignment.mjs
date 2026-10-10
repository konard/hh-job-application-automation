#!/usr/bin/env bun
/**
 * A test assignment as a GitHub repository with an issue:
 * `bun run test-assignment -- <repository name> [--from <form url | file>] [options]`
 *
 * The assignment is taken from a form open in a form slot (or a text file, or stdin), restated in
 * English in other words by local Claude Code, without anything that names the employer, checked
 * (no employer name, English, not the original wording). The vacancy (--vacancy, or the one of the
 * chat the form was sent in) sets the language and stack: the repository starts from the matching
 * CI/CD template of link-assistant/hive-mind and the issue asks for that stack. Then the repository
 * and its issue are created with gh. Forms prefilled later link to the repository where they ask
 * for the result.
 */

import fs from 'fs/promises';
import { spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { isBrowserRunning } from './browser-session.mjs';
import { openSlot } from './browser-slots.mjs';
import { askClaude } from './form-prefill.mjs';
import { waitForCaptcha } from './form-slots.mjs';
import {
  CI_CD_TEMPLATES, LANGUAGE_TITLES, employerStems, formVacancy, issueProblems, issuePrompt, namedLanguages, parseIssue, parseStack,
  publishAssignment, readAssignment, readAssignments, readVacancy, rememberAssignment, stackPrompt, stackSection, vacancyText,
} from './assignments.mjs';

const USAGE = `Usage: bun run test-assignment -- <repository name> [options]

  --from <url|file|->   The form with the assignment (open in a form slot), a text file, or - for stdin
                        (default: the form slot showing a test assignment)
  --vacancy <id|url>    The hh.ru vacancy of the assignment: its language and stack (default: the vacancy
                        of the chat the form was sent in, when known)
  --language <name>     Language of the CI/CD template: ${Object.keys(CI_CD_TEMPLATES).join(', ')}
                        (default: the one the vacancy names, otherwise the most fitting one)
  --owner <login>       Owner of the repository (default: the gh user)
  --company <name>      Employer name to leave out (repeatable; the form title is added)
  --private             Create a private repository (default: public)
  --dry-run             Show the issue without creating anything`;

function parseArgs(args) {
  const parsed = { name: '', from: '', vacancy: '', language: '', owner: '', companies: [], isPrivate: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => inline ?? args[++i];
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (flag === '--from') {
      parsed.from = value();
    } else if (flag === '--vacancy') {
      parsed.vacancy = value();
    } else if (flag === '--language') {
      parsed.language = value().toLowerCase();
    } else if (flag === '--owner') {
      parsed.owner = value();
    } else if (flag === '--company') {
      parsed.companies.push(value());
    } else if (flag === '--private') {
      parsed.isPrivate = true;
    } else if (flag === '--dry-run') {
      parsed.dryRun = true;
    } else {
      parsed.name = args[i];
    }
  }
  if (!parsed.name && !parsed.dryRun) {
    console.log(USAGE);
    process.exit(1);
  }
  return parsed;
}

/** The assignment of a form open in a form slot (read only), with the form's title */
async function assignmentFromSlots(url) {
  for (let port = 9331; port <= 9339; port++) {
    if (!await isBrowserRunning(port)) {
      continue;
    }
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
      for (const page of browser.contexts()[0].pages()) {
        if (url && !page.url().startsWith(url) && !url.startsWith(page.url())) {
          continue;
        }
        for (const frame of page.frames()) {
          const assignment = await frame.evaluate(readAssignment).catch(() => null);
          if (assignment) {
            return { ...assignment, formTitle: await page.title(), source: page.url() };
          }
        }
      }
    } finally {
      // Disconnects only: the slot stays open
      await browser.close();
    }
  }
  return null;
}

async function loadAssignment(from) {
  if (from === '-') {
    return { text: await fs.readFile('/dev/stdin', 'utf8'), formTitle: '', source: 'stdin' };
  }
  if (from && !/^https?:/.test(from)) {
    return { text: await fs.readFile(from, 'utf8'), formTitle: '', source: from };
  }
  return assignmentFromSlots(from);
}

/** An hh.ru vacancy, read once in the chat slot (logged in to hh.ru) */
async function loadVacancy(vacancy) {
  const url = /^\d+$/.test(vacancy) ? `https://hh.ru/vacancy/${vacancy}` : vacancy;
  const session = await openSlot({ name: 'chat-slot', port: 9340 });
  try {
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!await waitForCaptcha(session.page, console.log)) {
      return null;
    }
    await session.page.waitForSelector('[data-qa="vacancy-description"]', { timeout: 20000 }).catch(() => {});
    return { url, ...await session.page.evaluate(readVacancy) };
  } finally {
    await session.release();
  }
}

const argv = parseArgs(process.argv.slice(2));
const assignment = await loadAssignment(argv.from);
if (!assignment?.text?.trim()) {
  console.log(`❌ No test assignment found${argv.from ? ` in ${argv.from}` : ' in the form slots'}: prefill the form first (bun run prefill-form) or pass --from <file>`);
  process.exit(1);
}
const vacancyUrl = argv.vacancy || await formVacancy(assignment.source);
const vacancy = vacancyUrl ? await loadVacancy(vacancyUrl) : null;
if (vacancy?.description) {
  console.log(`💼 Vacancy: ${vacancy.title} (${vacancy.url})`);
} else {
  console.log(`⚠️  ${vacancyUrl ? `Could not read the vacancy ${vacancyUrl}` : 'The vacancy is not known (pass --vacancy <id>)'}: the stack is chosen from the assignment alone`);
}
// «Натур Пласт — анкета AI Solution Architect»: the company is the title before the dash
const names = [...argv.companies, assignment.formTitle.split(/\s+[—–-]\s+/)[0], vacancy?.company].filter(Boolean);
const stems = employerStems(names, assignment.text);
console.log(`🧪 Test assignment from ${assignment.source} (${assignment.text.length} characters); left out: ${stems.join(', ') || '-'}`);

const named = namedLanguages(vacancyText(vacancy));
let stack = null;
for (let attempt = 0; attempt < 2 && !stack; attempt++) {
  console.log(`🧰 Choosing the stack${named.length ? ` (the vacancy names ${named.join(', ')})` : ' (the vacancy names no language)'}...`);
  stack = parseStack(await askClaude(stackPrompt({ vacancy: vacancyText(vacancy), assignment: assignment.text, named })));
}
if (argv.language) {
  stack = { language: argv.language, stack: stack?.stack ?? '', reason: stack?.reason ?? '' };
}
if (!stack || !CI_CD_TEMPLATES[stack.language]) {
  console.log(`❌ No stack chosen${argv.language ? `: unknown language ${argv.language}` : ''}; pass --language <${Object.keys(CI_CD_TEMPLATES).join('|')}>`);
  process.exit(1);
}
console.log(`🧰 ${LANGUAGE_TITLES[stack.language]}: ${stack.stack}; template ${CI_CD_TEMPLATES[stack.language]}`);

let issue = null;
let problems = [];
for (let attempt = 0; attempt < 2 && (!issue || problems.length > 0); attempt++) {
  console.log('🤖 Restating it in English with local Claude Code...');
  const retry = problems.length ? `\nThe previous version was rejected because it ${problems.join('; ')}. Fix that.\n` : '';
  issue = parseIssue(await askClaude(issuePrompt(assignment.text, names) + retry));
  if (issue) {
    issue.body = `${issue.body}\n\n${stackSection(stack)}`;
  }
  problems = issue ? issueProblems(issue, { stems, original: `${assignment.text}\n${vacancy?.description ?? ''}` }) : ['is not valid JSON'];
}
if (problems.length > 0) {
  console.log(`❌ The issue was not created: it ${problems.join('; ')}`);
  process.exit(1);
}
console.log(`\n# ${issue.title}\n\n${issue.body}\n`);
if (argv.dryRun) {
  console.log('ℹ️  Dry run: nothing created');
  process.exit(0);
}

const owner = argv.owner || spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).stdout.trim();
const repo = `${owner}/${argv.name}`;
// The issue created for this assignment before is updated, whatever its title was
const before = (await readAssignments())[assignment.source];
const issueNumber = before?.repo === repo ? Number(before.issueUrl.split('/').pop()) : undefined;
const { repoUrl, issueUrl, created } = publishAssignment({
  repo, issue, template: CI_CD_TEMPLATES[stack.language], issueNumber, isPrivate: argv.isPrivate,
});
await rememberAssignment(assignment.source, { repo, repoUrl, issueUrl, vacancy: vacancy?.url ?? null, language: stack.language });
console.log(`✅ ${created.length ? `Created the ${created.join(' and ')}` : 'Already there'}: ${repoUrl}\n   Issue: ${issueUrl}`);
process.exit(0);
