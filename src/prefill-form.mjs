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

import { prefillForms } from './form-slots.mjs';

const USAGE = `Usage: bun run prefill-form -- <url> [<url> ...] [options]

  --first-slot <n>       Slot of the first form: port 9330+n, profile ~/.hh-automation/form-slot-<n> (default: the first free one)
  --no-draft             Do not draft unknown answers with local Claude Code
  --keep-open-hours <n>  Close an unused slot browser after this many hours (default 24)`;

/** Plain flags: the URLs, and the options above */
function parseArgs(args) {
  const parsed = { _: [], firstSlot: undefined, draft: true, keepOpenHours: 24 };
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
const { text, reportFile } = await prefillForms(argv._.map(String), argv);
console.log(`\n${text}\n📄 Report: ${reportFile}`);
process.exit(0);
