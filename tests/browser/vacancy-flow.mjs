/** Both application entry paths collect full text before the form. Isolated pages/profile. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { clearProcessedVacancies, findAndProcessVacancyButton } from '../../src/vacancies.mjs';
import { createVacancyInsights } from '../../src/vacancy-insights.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vacancy-flow-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  let clicks = 0;
  await page.exposeFunction('clickedApply', () => { clicks++; });
  const id = '991000020', search = 'https://hh.ru/search/vacancy?resume=ru';
  await page.route('https://hh.ru/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/search/vacancy' ? `<article id="${id}" class="vacancy-card--fixture" style="margin-top:1200px;height:350px">
      <a data-qa="serp-item__title" href="https://hh.ru/vacancy/${id}">Backend Engineer</a>
      <span data-qa="vacancy-serp__vacancy-employer">Example</span>
      <a data-qa="vacancy-serp__vacancy_response" href="https://hh.ru/applicant/vacancy_response?vacancyId=${id}" onclick="clickedApply();return false">Apply</a></article>` :
      pathname.startsWith('/vacancy/') ? `<h1 data-qa="vacancy-title">Backend Engineer</h1><span data-qa="vacancy-company-name">Example</span>
        <div data-qa="vacancy-description" style="margin-top:1200px">Requirements: Go, PostgreSQL, Docker.</div>
        <span data-qa="skills-element">Go</span><footer style="height:1200px"></footer>` :
        '<form><textarea>Existing answer stays.</textarea><button type="button">Send application</button></form>';
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const insights = createVacancyInsights({ directory: root, compare: false, update: false, log: () => {} });
  const visits = [];
  commander.goto = async ({ url }) => { visits.push(new URL(url).pathname); await page.goto(url, { waitUntil: 'domcontentloaded' }); };
  const wait = commander.wait.bind(commander);
  let previews = 0;
  commander.wait = async (options) => {
    await wait(options);
    if (options.reason === 'showing the collected vacancy before its application') {
      previews++;
      assert.equal(page.url(), `https://hh.ru/vacancy/${id}`);
      assert.equal((await insights.cache.read(id)).description, 'Requirements: Go, PostgreSQL, Docker.');
      assert.equal(await page.evaluate(() => window.scrollY > 0), true);
    }
  };
  for (const visible of [true, false]) {
    clearProcessedVacancies(); visits.length = 0;
    await commander.goto({ url: search });
    const result = await findAndProcessVacancyButton({ commander, selectApplicationResume: async () => {}, vacancyInsights: insights,
      applyFromVacancyPage: visible, vacancyPreviewMs: 800 });
    assert.equal(result.status, 'vacancy_response_detected');
    assert.deepEqual(visits, visible ? ['/search/vacancy', `/vacancy/${id}`, '/applicant/vacancy_response'] :
      ['/search/vacancy', `/vacancy/${id}`, '/search/vacancy', '/applicant/vacancy_response']);
    assert.equal(await page.locator('textarea').inputValue(), 'Existing answer stays.');
    assert.equal((await insights.cache.read(id)).descriptionHtml.includes('Requirements:'), true);
  }
  assert.equal(previews, 1);
  assert.equal(clicks, 0, 'Never use an Apply shortcut that could send the wrong CV');
  await commander.destroy();
  console.log('Vacancy flow checks passed: visible collection and scroll before form, no search bounce by default, legacy route retained, full cache and existing answers preserved.');
} finally { await browser.close(); await fs.rm(root, { recursive: true, force: true }); }
