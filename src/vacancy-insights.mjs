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
  return {
    enabled: enabled && (collect || compare || update), cache,
    async visit({ commander, vacancyId, returnUrl }) {
      const url = `https://hh.ru/vacancy/${vacancyId}`;
      log(`📖 Reading the full vacancy before applying: ${url}`);
      await commander.goto({ url, waitForStableUrlBefore: false, waitForNetworkIdle: false });
      try {
        await commander.waitForSelector({ selector: '[data-qa="vacancy-description"]', timeout: 20000 });
        const vacancy = await commander.evaluate({ fn: readVacancyDetails });
        if (vacancy.id !== String(vacancyId) || !vacancy.description) throw new Error('The full vacancy description was not loaded');
        const sections = vacancyRequirements(vacancy.description);
        if (collect) await cache.record({ ...vacancy, ...sections, status: 'encountered' });
        if (compare || update) {
          const resume = await fs.readFile(resumeFile, 'utf8').then(JSON.parse).catch(() => null);
          const expectedHash = new URL(returnUrl).searchParams.get('resume');
          if (!resume || (expectedHash && resume.hash !== expectedHash)) log('⚠️  No local export matching the selected résumé: run bun run resume; vacancy text was still collected');
          else {
            const aliases = withResumeVocabulary(await loadTechnologyAliases(), resume);
            const comparison = compareVacancyToResume(vacancy, resume, aliases);
            if (compare) log(formatVacancyMatch(vacancy, comparison));
            if (update && comparison.aliases.length && updateAliases) await updateAliases({ resume, aliases: comparison.aliases, vacancyId });
          }
        }
        return vacancy;
      } catch (error) {
        log(`⚠️  Vacancy ${vacancyId} was not fully collected: ${error.message.split('\n')[0]}; no application sent`);
        return null;
      } finally {
        if (commander.getUrl().split('?')[0] === url) await commander.goto({ url: returnUrl, waitForStableUrlBefore: false, waitForNetworkIdle: false });
      }
    },
    async applied(id) {
      if (!enabled || !collect) return;
      const record = await cache.read(id);
      if (record) await cache.record({ ...record, status: 'applied', appliedAt: new Date().toISOString() });
    },
  };
}
