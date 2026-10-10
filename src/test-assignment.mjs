#!/usr/bin/env bun
/**
 * A test assignment as a GitHub repository with an issue:
 * `bun run test-assignment -- <repository name> [--from <form url | file>] [options]`
 *
 * The assignment is taken from a form open in a form slot (or a text file, or stdin), restated in
 * English in other words by local Claude Code, without anything that names the employer, checked
 * (no employer name, English, not the original wording), then the repository and its issue are
 * created with gh. Forms prefilled later link to the repository where they ask for the result.
 */

import fs from 'fs/promises';
import { spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { isBrowserRunning } from './browser-session.mjs';
import { askClaude } from './form-prefill.mjs';
import {
  employerStems, issueProblems, issuePrompt, parseIssue, publishAssignment, readAssignment, rememberAssignment,
} from './assignments.mjs';

const USAGE = `Usage: bun run test-assignment -- <repository name> [options]

  --from <url|file|->   The form with the assignment (open in a form slot), a text file, or - for stdin
                        (default: the form slot showing a test assignment)
  --owner <login>       Owner of the repository (default: the gh user)
  --company <name>      Employer name to leave out (repeatable; the form title is added)
  --private             Create a private repository (default: public)
  --dry-run             Show the issue without creating anything`;

function parseArgs(args) {
  const parsed = { name: '', from: '', owner: '', companies: [], isPrivate: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => inline ?? args[++i];
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (flag === '--from') {
      parsed.from = value();
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

const argv = parseArgs(process.argv.slice(2));
const assignment = await loadAssignment(argv.from);
if (!assignment?.text?.trim()) {
  console.log(`❌ No test assignment found${argv.from ? ` in ${argv.from}` : ' in the form slots'}: prefill the form first (bun run prefill-form) or pass --from <file>`);
  process.exit(1);
}
// «Натур Пласт — анкета AI Solution Architect»: the company is the title before the dash
const names = [...argv.companies, assignment.formTitle.split(/\s+[—–-]\s+/)[0]].filter(Boolean);
const stems = employerStems(names, assignment.text);
console.log(`🧪 Test assignment from ${assignment.source} (${assignment.text.length} characters); left out: ${stems.join(', ') || '-'}`);

let issue = null;
let problems = [];
for (let attempt = 0; attempt < 2 && (!issue || problems.length > 0); attempt++) {
  console.log('🤖 Restating it in English with local Claude Code...');
  const retry = problems.length ? `\nThe previous version was rejected because it ${problems.join('; ')}. Fix that.\n` : '';
  issue = parseIssue(await askClaude(issuePrompt(assignment.text, names) + retry));
  problems = issue ? issueProblems(issue, { stems, original: assignment.text }) : ['is not valid JSON'];
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
const { repoUrl, issueUrl, created } = publishAssignment({ repo, issue, isPrivate: argv.isPrivate });
await rememberAssignment(assignment.source, { repo, repoUrl, issueUrl });
console.log(`✅ ${created.length ? `Created the ${created.join(' and ')}` : 'Already there'}: ${repoUrl}\n   Issue: ${issueUrl}`);
process.exit(0);
