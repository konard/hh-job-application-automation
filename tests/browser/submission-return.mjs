/** Confirmed native submissions leave their page even when already counted. No live HH access. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { checkAndRedirectIfNeeded } from '../../src/page-handlers.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://hh.ru/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
    new URL(route.request().url()).pathname === '/vacancy/139011384' ? '<main>You applied<button>Apply with another resume</button></main>' :
      '<main>Next page<textarea>My unsaved answer stays.</textarea></main>' }));
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  let navigations = 0;
  commander.goto = async ({ url }) => { navigations++; await page.goto(url, { waitUntil: 'domcontentloaded' }); };
  const vacancy = 'https://hh.ru/vacancy/139011384';
  const search = 'https://hh.ru/search/vacancy?resume=ru&page=1';
  const options = { commander, isOnVacancyPageFromResponse: true, returnUrl: search };
  await page.goto(vacancy);
  let callbacks = 0;
  assert.equal(await checkAndRedirectIfNeeded({ ...options, onApplicationSent: async () => { callbacks++; return false; } }), true);
  assert.equal(page.url(), search);
  assert.equal(await checkAndRedirectIfNeeded(options), false);
  assert.equal(callbacks, 1);
  assert.equal(navigations, 1);

  await page.goto(vacancy);
  const next = 'https://hh.ru/applicant/vacancy_response?vacancyId=777';
  assert.equal(await checkAndRedirectIfNeeded({ ...options, onApplicationSent: async () => {
    await page.goto(next); return false;
  } }), true);
  assert.equal(page.url(), next);
  assert.equal(await page.locator('textarea').inputValue(), 'My unsaved answer stays.');
  assert.equal(navigations, 1, 'Do not redirect over a new form');
  await commander.destroy();
  console.log('Submission return checks passed: already-counted success returns to search once, no repeat processing, later form and draft preserved.');
} finally { await browser.close(); }
