#!/usr/bin/env bun
/**
 * The skipped vacancies: `bun run skipped [-- --clear <reason|vacancyId> ...]`
 *
 * Lists data/skipped-vacancies.lino by reason (vacancies applied on the employer's site with the
 * `bun run prefill-form` command for their form); `--clear` removes entries, so `bun run apply`
 * opens those vacancies again (e.g. `--clear resume_not_visible` once the resume is visible to
 * all employers). Opens no browser and sends no request.
 */

import path from 'path';
import { createSkippedVacancies, formatSkippedVacancies, SKIP_REASONS } from './skipped-vacancies.mjs';

const USAGE = `Usage: bun run skipped [-- --clear <reason|vacancyId> ...] [--ignore-vacancies-with-questionnaire]

Reasons: ${Object.keys(SKIP_REASONS).join(', ')}`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const skipped = createSkippedVacancies(path.join(process.cwd(), 'data', 'skipped-vacancies.lino'));
const toClear = args.flatMap((arg, i) => (args[i - 1] === '--clear' ? [arg] : []));
for (const reasonOrId of toClear) {
  console.log(`🧹 ${reasonOrId}: ${await skipped.clear(reasonOrId)} vacancy(ies) will be opened again`);
}

const entries = await skipped.read();
console.log(entries.size === 0
  ? 'No skipped vacancies in data/skipped-vacancies.lino'
  : formatSkippedVacancies(entries, { ignoreQuestionnaires: args.includes('--ignore-vacancies-with-questionnaire') }));
