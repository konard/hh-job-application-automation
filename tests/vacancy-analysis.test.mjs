import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadTechnologyAliases, technologyMentions, compareVacancyToResume, vacancyStatistics, vacancyRequirements, observedTechnologyNames } from '../src/vacancy-analysis.mjs';
import { createVacancyCache } from '../src/vacancy-cache.mjs';
import { createVacancyInsights } from '../src/vacancy-insights.mjs';
import { planResumeAliases, createResumeAliasUpdater, ALIAS_HEADING } from '../src/resume-aliases.mjs';

const catalog = await loadTechnologyAliases();
const resume = { hash: 'resume1', title: 'Developer', keySkills: ['JavaScript', 'PostgreSQL', 'Go'], about: 'React Native, Angular, .NET.\nOriginal paragraph.', jobs: [] };

describe('vacancy analysis', () => {
  test('aliases match existing technologies without conflating languages, frameworks or versions', () => {
    const comparison = compareVacancyToResume({ skills: ['JS', 'Postgres', 'Golang', 'AngularJS', '.NET Core', 'React'], description: '' }, resume, catalog);
    expect(comparison.matched.map((item) => item.canonical).sort()).toEqual(['Go', 'JavaScript', 'PostgreSQL']);
    expect(comparison.missing.map((item) => item.canonical).sort()).toEqual(['.NET Core', 'AngularJS', 'React']);
    expect(comparison.aliases.map((item) => item.spelling).sort()).toEqual(['Golang', 'JS', 'Postgres']);
    expect(technologyMentions('JavaScript, React Native and .NET Core', catalog).map((item) => item.canonical).sort())
      .toEqual(['.NET Core', 'JavaScript', 'React Native']);
    expect(technologyMentions('We go to the office', catalog)).toEqual([]);
  });
  test('requirements and preferences remain separate; benefits do not become required experience', () => {
    const description = 'About us\nWe use Java\nRequirements:\n- Python\n- SQL\nNice to have:\n- Rust\nBenefits:\nWe use Go in hobby clubs';
    expect(vacancyRequirements(description)).toEqual({ required: ['Python', 'SQL'], preferred: ['Rust'] });
    const result = compareVacancyToResume({ description, skills: [] }, resume, catalog);
    expect(result.missing.map((item) => item.canonical).sort()).toEqual(['Python', 'SQL']);
    expect(result.total).toBe(2);
    expect(compareVacancyToResume({ skills: ['NovelDatabaseBrand'], description: '' }, resume, catalog).missing[0].canonical).toBe('NovelDatabaseBrand');
  });
  test('statistics count a technology once per vacancy, with spelling frequencies and missing résumé evidence', () => {
    const vacancies = [{ id: '1', status: 'applied', skills: ['JS', 'JavaScript', 'Postgres'], description: 'Requirements:\nSQL experience' },
      { id: '2', skills: ['JS', 'Rust'], description: 'Requirements:\nSQL experience' }];
    const stats = vacancyStatistics(vacancies, resume, catalog);
    expect(stats.technologies.find((row) => row.technology === 'JavaScript')).toMatchObject({ vacancies: 2, spellings: { JS: 2, JavaScript: 1 } });
    expect(stats.technologies.find((row) => row.technology === 'Rust').missingFromResume).toBe(true);
    expect(stats.requirements).toEqual([{ requirement: 'sql experience', vacancies: 2 }]);
    expect(stats.applied).toBe(1);
  });
  test('résumé edits are additive, idempotent, and require a known equivalent name with evidence', () => {
    const requested = [{ canonical: 'JavaScript', spelling: 'JS' }, { canonical: 'Go', spelling: 'Golang' },
      { canonical: 'Rust', spelling: 'Rust' }, { canonical: 'Go', spelling: 'Kubernetes' },
      { canonical: 'Angular', spelling: 'AngularJS' }];
    const plan = planResumeAliases(resume, requested, catalog);
    expect(plan.additions).toEqual(requested.slice(0, 2));
    expect(plan.about.startsWith(resume.about)).toBe(true);
    expect(plan.about).not.toContain(ALIAS_HEADING);
    expect(plan.about).toContain('Go (Golang)');
    expect(plan.about).toContain('JavaScript (JS)');
    expect(planResumeAliases({ ...resume, about: plan.about }, requested, catalog).additions).toEqual([]);
    const next = planResumeAliases({ ...resume, about: plan.about }, [{ canonical: 'PostgreSQL', spelling: 'Postgres' }], catalog);
    expect(next.about).toContain('JavaScript');
    expect(next.about).toContain('PostgreSQL (Postgres)');
  });
  test('close names of unfamiliar brands are suggestions only, with no automatic résumé claim', () => {
    const comparison = compareVacancyToResume({ skills: ['NovelDatabas'], description: '' },
      { ...resume, keySkills: [...resume.keySkills, 'NovelDatabase'] }, catalog);
    expect(comparison.similarNames).toEqual([{ technology: 'NovelDatabas', candidates: ['NovelDatabase'] }]);
    expect(comparison.aliases).toEqual([]);
    expect(comparison.missing[0].canonical).toBe('NovelDatabas');
  });
  test('legacy alias blocks migrate to inline names evidenced by vacancies', () => {
    const about = 'Biography.\n\nTechnical Skills\nLanguages:\nGo\nTechnology name variants:\nJavaScript: JS';
    const plan = planResumeAliases({ ...resume, about }, [{ canonical: 'Go', spelling: 'Golang' }], catalog);
    expect(plan.about).not.toContain('Technology name variants:');
    expect(plan.about).not.toContain('JavaScript: JS');
    expect(plan.about).toContain('Go (Golang)');
    expect(plan.about).not.toContain(ALIAS_HEADING);
    const withoutBlock = planResumeAliases({ ...resume, about: 'Technical Skills\nLanguages:\nGo' }, [{ canonical: 'Go', spelling: 'Golang' }], catalog);
    expect(withoutBlock.about).toContain('Go (Golang)');
    expect(withoutBlock.about).not.toContain('Technology name variants:');
  });
  test('corpus spelling frequencies count each vacancy once, including its description', () => {
    const seen = observedTechnologyNames([{ id: '1', skills: ['Golang'], description: 'Golang and golang, plus k8s.' },
      { id: '1', description: 'Golang' }, { id: '2', description: 'Golang' }], catalog);
    expect(seen.find((item) => item.spelling === 'Golang')).toEqual({ canonical: 'Go', spelling: 'Golang', vacancies: 2 });
    expect(seen.find((item) => item.spelling === 'k8s')).toEqual({ canonical: 'Kubernetes', spelling: 'k8s', vacancies: 1 });
  });
  test('npm and Nginx Proxy Manager have distinct names; a bare NPM is left ambiguous', () => {
    expect(technologyMentions('Nginx Proxy Manager (NPM), npm (JS/TS)', catalog).map((item) => item.canonical).sort()).toEqual(['Nginx Proxy Manager', 'npm']);
    expect(technologyMentions('NPM', catalog)).toEqual([]);
    const comparison = compareVacancyToResume({ skills: ['NPM'], description: '' }, { ...resume, about: 'npm (JS/TS), Nginx Proxy Manager (NPM)' }, catalog);
    expect(comparison.matched).toEqual([]);
    expect(comparison.ambiguousNames[0].candidates).toEqual(['npm (JS/TS)', 'Nginx Proxy Manager']);
  });
});

test('private Links Notation round-trips full descriptions, quotes, HTML and long requirement lists without loss', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vacancy-cache-'));
  try {
    const cache = createVacancyCache(dir, { now: () => new Date('2026-10-26T00:00:00Z') });
    const vacancy = { id: '123', title: 'Developer', salary: '', published: '', description: 'First line\n\n"Quoted", apostrophe\'s, `code`, colon: value.\nКонец.',
      descriptionHtml: '<div><p>Quoted "HTML"</p></div>', skills: ['Go', 'JavaScript'], required: ['A'.repeat(190), 'B'.repeat(180)], preferred: [] };
    await cache.record(vacancy);
    expect(await cache.read('123')).toMatchObject(vacancy);
    expect((await cache.read('123')).salary).toBe('');
    await cache.record({ id: '123', status: 'applied' });
    expect((await cache.all())[0]).toMatchObject({ ...vacancy, status: 'applied', firstSeenAt: '2026-10-26T00:00:00.000Z' });
    expect(await cache.all()).toHaveLength(1);
    expect((await fs.readFile(path.join(dir, '123.lino'), 'utf8')).includes('description\n')).toBe(true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('the full vacancy is visited, collected and compared before returning to the search; collection can be disabled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vacancy-insights-'));
  try {
    const resumeFile = path.join(dir, 'resume.json'); await fs.writeFile(resumeFile, JSON.stringify(resume));
    let url = 'https://hh.ru/search/vacancy?resume=resume1';
    const visits = [], reports = [], updates = [];
    const commander = { getUrl: () => url, goto: async ({ url: next }) => { visits.push(next); url = next; },
      waitForSelector: async () => {}, evaluate: async () => ({ id: '123', title: 'Developer', skills: ['Golang'], description: 'Requirements:\nGolang' }) };
    const insights = createVacancyInsights({ directory: path.join(dir, 'cache'), resumeFile, log: (line) => reports.push(line), updateAliases: async (request) => updates.push(request) });
    expect(insights.enabled).toBe(true);
    await insights.visit({ commander, vacancyId: '123', returnUrl: url });
    expect(visits).toEqual(['https://hh.ru/vacancy/123', 'https://hh.ru/search/vacancy?resume=resume1']);
    expect((await insights.cache.read('123')).description).toBe('Requirements:\nGolang');
    const restarted = createVacancyInsights({ directory: path.join(dir, 'cache'), log: () => {} });
    expect((await restarted.read('123')).description).toBe('Requirements:\nGolang');
    expect(await restarted.read(null)).toBe(null);
    expect(reports.some((line) => line.includes('Technology coverage: 1/1 (100%)'))).toBe(true);
    expect(updates[0].aliases[0].spelling).toBe('Golang');
    // A different CV may be the latest root export while the search uses Russian.
    await fs.mkdir(path.join(dir, 'cv', 'resume1'), { recursive: true });
    await fs.writeFile(path.join(dir, 'cv', 'resume1', 'resume.json'), JSON.stringify(resume));
    await fs.writeFile(resumeFile, JSON.stringify({ ...resume, hash: 'othercv', keySkills: [], jobs: [], about: '' }));
    reports.length = 0;
    await insights.visit({ commander, vacancyId: '123', returnUrl: url });
    expect(reports.some((line) => line.includes('Technology coverage: 1/1 (100%)'))).toBe(true);
    expect(createVacancyInsights({ enabled: false }).enabled).toBe(false);
    const noCache = createVacancyInsights({ collect: false, compare: false, update: false, directory: path.join(dir, 'disabled') });
    expect(noCache.enabled).toBe(false);
    await noCache.visit({ commander, vacancyId: '123', returnUrl: url });
    expect((await noCache.read('123')).description).toBe('Requirements:\nGolang');
    const disabledExists = await fs.stat(path.join(dir, 'disabled')).then(() => true, () => false);
    expect(disabledExists).toBe(false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('an open résumé draft is protected before session seeding can navigate away', async () => {
  let seeded = false, released = false;
  const update = createResumeAliasUpdater({ log: () => {},
    open: async () => ({ page: { locator: () => ({ count: async () => 1 }) }, release: async () => { released = true; } }),
    seed: async () => { seeded = true; } });
  await update({ resume, aliases: [{ canonical: 'Go', spelling: 'Golang' }] });
  expect(seeded).toBe(false);
  expect(released).toBe(true);
});
