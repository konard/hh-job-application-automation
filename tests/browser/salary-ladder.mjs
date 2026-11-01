/** Real HH-shaped list/form controls, private fixture cache, no requests to HH. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createSalaryLadder } from '../../src/salary-ladder.mjs';

process.env.NODE_ENV = 'test';
process.env.NOTIFY = '0';
const cwd = process.cwd();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'salary-browser-'));
process.chdir(directory);
const { findAndProcessVacancyButton, clearProcessedVacancies, isVacancyProcessed, releaseSalaryDeferredVacancy, markVacancyAsProcessed,
  waitForButtonsAfterNavigation } = await import('../../src/vacancies.mjs');
const { handleVacancyResponsePage } = await import('../../src/vacancy-response.mjs');
const { readApplicationDraft } = await import('../../src/application-drafts.mjs');
const { createVacancyInsights } = await import('../../src/vacancy-insights.mjs');
const { disableConfirmations } = await import('../../src/confirmations.mjs');
disableConfirmations();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const salaries = { '999810001': 'up to 200000 ₽ per month', '999810002': 'from 400000 ₽ per month', '999810003': '' };
  let id = '999810001';
  const ladder = createSalaryLadder({ contacts: { salary_net_rub: '450000' }, release: releaseSalaryDeferredVacancy,
    hold: markVacancyAsProcessed, log: () => {} });
  let search = ladder.prepare('https://hh.ru/search/vacancy?resume=ru');
  await page.route('https://hh.ru/**', route => {
    const url = new URL(route.request().url());
    const currentId = url.pathname.match(/\/vacancy\/(\d+)/)?.[1] ?? url.searchParams.get('vacancyId') ?? id;
    const salary = salaries[currentId];
    const body = url.pathname === '/search/vacancy' ? `<header>Matching vacancies for the selected resume, ordered by relevance; the complete search results have loaded.</header><article id="${id}" class="vacancy-card--fixture">
      <a data-qa="serp-item__title" href="/vacancy/${id}">Developer</a>
      <span data-qa="vacancy-serp__vacancy-compensation">${salaries[id]}</span>
      <a data-qa="vacancy-serp__vacancy_response" href="/applicant/vacancy_response?vacancyId=${id}">Apply</a></article>` :
      url.pathname.startsWith('/vacancy/') ? `<h1 data-qa="vacancy-title">Developer</h1><div data-qa="vacancy-salary">${salary}</div>
      <div data-qa="vacancy-description">Build software with JavaScript.</div>` :
        `<main><form id="RESPONSE_MODAL_FORM_ID" name="vacancy_response" onsubmit="event.preventDefault();window.sent++;this.innerHTML='Вы откликнулись'">
        <input type="hidden" name="vacancy_id" value="${currentId}">
        <textarea name="letter" data-qa="vacancy-response-form-letter-input">My full letter.</textarea>
        <button type="submit" data-qa="vacancy-response-letter-submit">Send application</button></form></main><script>window.sent=0</script>`;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const visits = [];
  commander.goto = ({ url }) => { visits.push(url); return page.goto(url, { waitUntil: 'domcontentloaded' }); };
  commander.wait = async () => ({});
  const insights = createVacancyInsights({ directory: path.join(directory, 'vacancies'), compare: false, update: false, log: () => {} });
  const list = { commander, salaryLadder: ladder, vacancyInsights: insights, applyFromVacancyPage: true,
    selectApplicationResume: async () => ({ ready: true }) };
  const qa = new Map();
  const form = { commander, salaryLadder: ladder, MESSAGE: 'My full letter.', readVacancy: insights.read,
    readQADatabase: async () => qa, addOrUpdateQA: async (q, a) => { qa.set(q, a); }, returnUrl: search };
  await commander.goto({ url: search });
  assert.equal((await findAndProcessVacancyButton(list)).status, 'salary_exclude');
  assert.ok((await insights.cache.read(id)).description);
  assert.equal(visits.some(url => url.includes('vacancy_response')), false, 'Low cap cannot open or send the application');
  id = '999810002';
  await page.reload();
  assert.equal((await findAndProcessVacancyButton(list)).status, 'salary_defer');
  assert.equal(isVacancyProcessed(id), true);
  const result = await waitForButtonsAfterNavigation({ commander, pageClosedByUser: () => false, onExhausted: async () => {
    search = ladder.advance(page.url()); await commander.goto({ url: search }); return true;
  } });
  assert.equal(result.status, 'navigation_detected');
  assert.equal(new URL(page.url()).searchParams.get('salary'), '400000');
  assert.equal(isVacancyProcessed(id), false);
  assert.equal((await findAndProcessVacancyButton(list)).status, 'vacancy_response_detected');
  salaries[id] = 'up to 200000 ₽';
  assert.equal((await handleVacancyResponsePage({ ...form, readVacancy: async () => ({ salary: salaries[id] }) })).status, 'salary_exclude');
  assert.equal((await readApplicationDraft(id)).fields.find(f => f.name === 'letter').value, 'My full letter.');
  id = '999810003';
  await commander.goto({ url: search });
  assert.equal((await findAndProcessVacancyButton(list)).status, 'vacancy_response_detected');
  let sent = 0;
  await handleVacancyResponsePage({ ...form, returnUrl: search, onApplicationSent: async () => { sent++; } });
  assert.equal(sent, 1, 'Missing salary is eligible even at the high tier');
  // Directly opened forms must collect missing context without losing an owner's letter.
  const directId = '999810004';
  salaries[directId] = 'up to 200000 ₽';
  await commander.goto({ url: `https://hh.ru/applicant/vacancy_response?vacancyId=${directId}` });
  await page.locator('textarea').fill('My custom letter, entered before collection.');
  assert.equal((await handleVacancyResponsePage({ ...form, returnUrl: search,
    collectVacancy: (vacancyId, returnUrl) => insights.visit({ commander, vacancyId, returnUrl }) })).status, 'salary_exclude');
  assert.equal((await readApplicationDraft(directId)).fields.find(f => f.name === 'letter').value, 'My custom letter, entered before collection.');
  assert.ok((await insights.cache.read(directId)).description);
  console.log('Salary workflow: full cache, hard-cap exclusion, RAM defer/release, tier navigation, form backup, unspecified-pay send verified.');
} finally {
  clearProcessedVacancies();
  await browser.close(); process.chdir(cwd); await fs.rm(directory, { recursive: true, force: true });
}
