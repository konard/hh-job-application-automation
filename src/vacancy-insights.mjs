/** Visit and privately archive the full vacancy before applying, then report résumé coverage. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createVacancyCache } from './vacancy-cache.mjs';
import { compareVacancyToResume, formatVacancyMatch, loadTechnologyAliases, withResumeVocabulary, vacancyRequirements } from './vacancy-analysis.mjs';

/** Runs on a vacancy page; no embedded application state, credentials or tracking data is kept. */
export function readVacancyDetails() {
  const text = (selector) => document.querySelector(selector)?.innerText.trim() ?? '';
  const texts = (selector) => [...document.querySelectorAll(selector)].map((element) => element.innerText.trim()).filter(Boolean);
  const description = document.querySelector('[data-qa="vacancy-description"]');
  return {
    id: window.location.pathname.match(/\/vacancy\/(\d+)/)?.[1] ?? '',
    url: window.location.origin + window.location.pathname,
    title: text('[data-qa="vacancy-title"]'), company: text('[data-qa="vacancy-company-name"]'),
    salary: text('[data-qa="vacancy-salary"], [data-qa="vacancy-salary-compensation-type-net"], [data-qa="vacancy-salary-compensation-type-gross"]'),
    location: text('[data-qa="vacancy-view-location"], [data-qa="vacancy-view-raw-address"]'),
    experience: text('[data-qa="vacancy-experience"]'),
    employment: texts('[data-qa="vacancy-view-employment-mode"], [data-qa*="work-format"]').join('\n'),
    skills: [...new Set(texts('[data-qa="skills-element"], [data-qa="bloko-tag__text"]'))],
    description: description?.innerText.trim() ?? '', descriptionHtml: description?.innerHTML ?? '',
    published: text('[data-qa="vacancy-creation-time"]'),
  };
}

export function createVacancyInsights({ enabled = true, collect = true, compare = true, update = true,
  directory, resumeFile = path.join(process.cwd(), 'data/resume/resume.json'), updateAliases, log = console.log } = {}) {
  const cache = createVacancyCache(directory);
  const collected = new Map();
  return {
    enabled: enabled && (collect || compare || update), cache,
    // Independent of the filters' RAM maps, so an open form can recover its context on restart.
    read: async (id) => /^\d+$/.test(String(id)) ? collected.get(String(id)) ?? await cache.read(id) : null,
    async visit({ commander, vacancyId, returnUrl, stayOnVacancy = false, previewMs = 0 }) {
      const url = `https://hh.ru/vacancy/${vacancyId}`;
      log(`📖 Reading the full vacancy before applying: ${url}`);
      await commander.goto({ url, waitForStableUrlBefore: false, waitForNetworkIdle: false });
      let complete = false;
      try {
        await commander.waitForSelector({ selector: '[data-qa="vacancy-description"]', timeout: 20000 });
        const vacancy = await commander.evaluate({ fn: readVacancyDetails });
        if (vacancy.id !== String(vacancyId) || !vacancy.description) throw new Error('The full vacancy description was not loaded');
        collected.set(String(vacancyId), vacancy);
        const sections = vacancyRequirements(vacancy.description);
        if (enabled && collect) await cache.record({ ...vacancy, ...sections, status: 'encountered' });
        if (enabled && (compare || update)) {
          let resume = await fs.readFile(resumeFile, 'utf8').then(JSON.parse).catch(() => null);
          const expectedHash = new URL(returnUrl).searchParams.get('resume');
          if (expectedHash && resume?.hash !== expectedHash && /^[a-z0-9]+$/i.test(expectedHash)) {
            resume = await fs.readFile(path.join(path.dirname(resumeFile), 'cv', expectedHash, 'resume.json'), 'utf8').then(JSON.parse).catch(() => null);
          }
          if (!resume || (expectedHash && resume.hash !== expectedHash)) log('⚠️  No local export matching the selected résumé: run bun run resume; vacancy text was still collected');
          else {
            const aliases = withResumeVocabulary(await loadTechnologyAliases(), resume);
            const comparison = compareVacancyToResume(vacancy, resume, aliases);
            if (compare) log(formatVacancyMatch(vacancy, comparison));
            if (update && comparison.aliases.length && updateAliases) await updateAliases({ resume, aliases: comparison.aliases, vacancyId });
          }
        }
        if (stayOnVacancy && commander.getUrl().split('?')[0] === url) {
          await commander.evaluate({ fn: () => document.querySelector('[data-qa="vacancy-description"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
          log(`👀 Vacancy ${vacancyId} collected: showing its description before the application`);
          if (previewMs > 0) await commander.wait({ ms: previewMs, reason: 'showing the collected vacancy before its application' });
        }
        complete = true;
        return vacancy;
      } catch (error) {
        log(`⚠️  Vacancy ${vacancyId} was not fully collected: ${error.message.split('\n')[0]}; no application sent`);
        return null;
      } finally {
        if ((!stayOnVacancy || !complete) && commander.getUrl().split('?')[0] === url) await commander.goto({ url: returnUrl, waitForStableUrlBefore: false, waitForNetworkIdle: false });
      }
    },
    async applied(id) {
      if (!enabled || !collect) return;
      const record = await cache.read(id);
      if (record) await cache.record({ ...record, status: 'applied', appliedAt: new Date().toISOString() });
    },
  };
}
