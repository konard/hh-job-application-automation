/** Ready forms proceed promptly; manual reviews remain passive. No real HH requests/profile. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { handleVacancyResponsePage, waitForManualResponse } from '../../src/vacancy-response.mjs';
import { disableConfirmations } from '../../src/confirmations.mjs';

process.env.NOTIFY = '0';
disableConfirmations();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('Fixture page error:', error.message));
  await page.route('https://hh.ru/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
    new URL(route.request().url()).pathname === '/search/vacancy' ? '<main>Vacancies</main>' : `
      <main><form name="vacancy_response" onsubmit="event.preventDefault(); window.sent++; window.scrollAtSend=scrollY; document.querySelector('main').innerHTML='Вы откликнулись'" style="margin-top:1300px">
      <button type="button" data-qa="vacancy-response-letter-toggle" onclick="window.toggles++; setTimeout(() => { document.querySelector('[name=letter]').hidden=false; this.remove() }, 200)">Add a cover letter</button>
      <textarea hidden name="letter" data-qa="vacancy-response-form-letter-input"></textarea>
      <button type="submit" data-qa="vacancy-response-letter-submit">Send application</button></form></main>
      <script>window.sent=0; window.toggles=0;</script>` }));
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const returnUrl = 'https://hh.ru/search/vacancy?resume=test';
  commander.goto = ({ url }) => page.goto(url, { waitUntil: 'domcontentloaded' });
  const options = { commander, MESSAGE: 'Hello, my complete cover letter.', readQADatabase: async () => new Map(),
    addOrUpdateQA: async () => {}, returnUrl };
  await page.goto('https://hh.ru/applicant/vacancy_response?vacancyId=991000001');
  let sent = 0;
  const started = Date.now();
  await handleVacancyResponsePage({ ...options, onApplicationSent: async () => {
    sent++;
    assert.equal(await page.evaluate(() => window.sent), 1);
    assert.equal(await page.evaluate(() => window.toggles), 1);
    assert.equal(await page.evaluate(() => window.scrollAtSend > 0), true);
  } });
  const elapsed = Date.now() - started;
  assert.equal(sent, 1, JSON.stringify(await page.evaluate(() => ({ sent: window.sent, toggles: window.toggles, body: document.body.innerText }))));
  assert.equal(page.url(), returnUrl);
  assert.ok(elapsed < 15000, `Ready form took ${elapsed}ms (must not include the former 30-second wait)`);

  await page.goto('https://hh.ru/applicant/vacancy_response?vacancyId=991000002');
  await page.locator('form').evaluate((form) => form.insertAdjacentHTML('afterbegin',
    '<div data-qa="task-body"><div data-qa="task-question">My experience?</div><textarea name="experience" data-hh-answer-draft="true">My draft</textarea></div>'));
  const result = await handleVacancyResponsePage(options);
  assert.equal(result.status, 'awaiting_user');
  const waiting = waitForManualResponse({ commander });
  await page.locator('[name=experience]').fill('My final reviewed answer.');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await page.locator('[name=experience]').inputValue(), 'My final reviewed answer.');
  assert.equal(await page.evaluate(() => window.sent), 0);
  assert.equal(await page.evaluate(() => window.toggles), 0, 'A review wait must not reopen or refill anything');
  await page.locator('[data-qa="vacancy-response-letter-submit"]').click();
  assert.equal(await waiting, 'submitted');
  await commander.destroy();
  console.log(`Form timing checks passed: ready form ${elapsed}ms, one expansion/send, visible scrolling, passive review and native submission.`);
} finally { await browser.close(); }
