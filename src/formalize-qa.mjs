/**
 * Every question and answer of data/qa.lino formalized by Formal AI's JavaScript version
 * (github.com/link-assistant/formal-ai, nothing to compile), and what it gets wrong counted:
 *
 *   node src/formalize-qa.mjs [--formal-ai <dir>] [--limit <pairs>]
 *
 * Formal AI is cloned into ~/.hh-automation/formal-ai the first time (--formal-ai for another
 * copy). The counts and examples are printed; every result goes to logs/formalize-qa.json.
 *
 * @module formalize-qa
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createQADatabase } from './qa-database.mjs';
import { loadContacts, withContacts } from './contacts.mjs';
import { formalProblems } from './formal-check.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const formalAi = option('--formal-ai', path.join(os.homedir(), '.hh-automation', 'formal-ai'));
const limit = Number(option('--limit', Infinity));

if (!existsSync(path.join(formalAi, 'js', 'server', 'worker-host.mjs'))) {
  console.log(`📥 Cloning Formal AI into ${formalAi}`);
  execFileSync('git', ['clone', '--depth', '1', 'https://github.com/link-assistant/formal-ai', formalAi], { stdio: 'inherit' });
}
const version = execFileSync('git', ['-C', formalAi, 'log', '-1', '--format=%s']).toString().match(/v(\d+\.\d+\.\d+)/)?.[1] ?? '?';
const commit = execFileSync('git', ['-C', formalAi, 'rev-parse', '--short', 'HEAD']).toString().trim();
const { WorkerHost } = await import(pathToFileURL(path.join(formalAi, 'js', 'server', 'worker-host.mjs')).href);
const host = new WorkerHost();
await host.boot();
const formalize = async (text) => JSON.parse(await host.run(
  'JSON.stringify(crateModule("crate/text_formalization.mjs").formalizeText(__text))', { __text: text }));

// The answers as they are sent: their placeholders filled in from data/contacts.lino
const contacts = await loadContacts(path.join(process.cwd(), 'data', 'contacts.lino'));
const qa = [...await withContacts(createQADatabase(path.join(process.cwd(), 'data', 'qa.lino')), contacts).readQADatabase()]
  .slice(0, limit);
console.log(`🧮 Formal AI ${version} (${commit}): formalizing ${qa.length} questions and their answers`);
const results = [];
const counts = {};
const examples = {};
for (const [question, answer] of qa) {
  for (const [role, text] of [['question', question], ['answer', String(answer)]]) {
    const statements = await formalize(text).catch((error) => ({ error: error.message }));
    const problems = statements.error
      ? [{ check: 'error', detail: statements.error }]
      : formalProblems(text, statements, role);
    results.push({ role, text, statements, problems });
    for (const problem of problems) {
      counts[problem.check] = (counts[problem.check] ?? 0) + 1;
      (examples[problem.check] ??= []).length < 3 && examples[problem.check].push(`${text.replace(/\s+/g, ' ').slice(0, 100)} → ${problem.detail.slice(0, 80)}`);
    }
  }
}
const clean = results.filter((result) => result.problems.length === 0).length;
console.log(`✅ Formalized with nothing missed: ${clean} of ${results.length} texts`);
for (const [check, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`❌ ${check}: ${count}`);
  examples[check].forEach((example) => console.log(`     ${example}`));
}
await fs.mkdir(path.join(process.cwd(), 'logs'), { recursive: true });
await fs.writeFile(path.join(process.cwd(), 'logs', 'formalize-qa.json'),
  JSON.stringify({ formalAi: { version, commit }, counts, clean, total: results.length, results }, null, 1));
console.log('📄 Every result: logs/formalize-qa.json');
process.exit(0);
