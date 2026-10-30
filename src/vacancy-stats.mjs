#!/usr/bin/env bun
/** Aggregate private cached vacancies without revisiting hh.ru or using AI tokens. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createVacancyCache, VACANCY_CACHE_DIR } from './vacancy-cache.mjs';
import { loadTechnologyAliases, vacancyStatistics, withResumeVocabulary } from './vacancy-analysis.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: bun run vacancy-stats -- [--top 30] [--json] [--cache-dir ~/.hh-automation/vacancies] [--resume data/resume/resume.json]');
  process.exit(0);
}
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const resume = JSON.parse(await fs.readFile(value('--resume', 'data/resume/resume.json'), 'utf8'));
const vacancies = await createVacancyCache(path.resolve(value('--cache-dir', VACANCY_CACHE_DIR))).all();
const aliases = withResumeVocabulary(await loadTechnologyAliases(), resume);
const stats = vacancyStatistics(vacancies, resume, aliases);
if (args.includes('--json')) console.log(JSON.stringify(stats, null, 2));
else {
  const limit = Number(value('--top', 30));
  console.log(`📊 ${stats.vacancies} unique cached vacancies; each technology counts once per vacancy.`);
  console.log('\nMost requested technologies:');
  for (const row of stats.technologies.slice(0, limit)) console.log(`  ${row.vacancies}\t${row.technology}${row.missingFromResume ? ' · no résumé evidence' : ''}\t${Object.entries(row.spellings).map(([name, count]) => `${name}: ${count}`).join(' | ')}`);
  console.log('\nTechnologies without résumé evidence:');
  for (const row of stats.technologies.filter((item) => item.missingFromResume).slice(0, limit)) console.log(`  ${row.vacancies}\t${row.technology}`);
  console.log('\nAlternative spellings of existing résumé technologies:');
  for (const row of stats.aliases.slice(0, limit)) console.log(`  ${row.spelling} = ${row.canonical} · evidence: ${row.evidence.join(', ')}`);
  console.log('\nSimilar names for review (never added automatically):');
  for (const row of stats.similarNames.slice(0, limit)) console.log(`  ${row.technology} ≈ ${row.candidates.join(', ')}`);
  console.log('\nCommon requirement categories:');
  if (stats.ambiguousNames.length) {
    console.log('\nAmbiguous abbreviations (not assigned to a product):');
    for (const row of stats.ambiguousNames) console.log(`  ${row.spelling} · ${row.vacancies} vacancies · ${row.candidates.join(' / ')}`);
  }
  for (const row of stats.requirementCategories.slice(0, limit)) console.log(`  ${row.vacancies}\t${row.requirement}`);
  console.log('\nMost repeated requirement lines:');
  for (const row of stats.requirements.slice(0, limit)) console.log(`  ${row.vacancies}\t${row.requirement}`);
  for (const [title, rows] of [['Experience', stats.experience], ['Employment / work format', stats.employment], ['Locations', stats.locations]]) {
    console.log(`\n${title}:`);
    for (const row of rows.slice(0, limit)) console.log(`  ${row.vacancies}\t${row.value}`);
  }
}
