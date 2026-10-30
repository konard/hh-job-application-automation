/** Isolated HTML fixtures: never contact HH, submit applications or change the user's profile. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createQADatabase } from '../../src/qa-database.mjs';
import { disableConfirmations } from '../../src/confirmations.mjs';
import { readApplicationLimit, prepareApplicationLimit, waitForApplicationLimit } from '../../src/application-limits.mjs';
import { saveApplicationDraft, readApplicationDraft, restoreApplicationDraft } from '../../src/application-drafts.mjs';
import { handleVacancyResponsePage, saveQAPairs, waitForManualResponse } from '../../src/vacancy-response.mjs';
import { processModalApplication, waitForApplicationModal } from '../../src/vacancies.mjs';
import { createSubmissionRetries, deferFailedSubmission } from '../../src/submission-retries.mjs';
import { SELECTORS } from '../../src/hh-selectors.mjs';

process.env.NODE_ENV = 'test';
process.env.NOTIFY = '0';
disableConfirmations();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hh-limit-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let commander;
try {
  const page = await browser.newPage();
  const message = 'You cannot send more than 200 applications per 24-hour period. You have reached your application limit, try sending a new application later.';
  const url = 'https://hh.ru/applicant/vacancy_response?vacancyId=991010001';
  await page.route('https://hh.ru/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <main><form id="RESPONSE_MODAL_FORM_ID" name="vacancy_response" onsubmit="event.preventDefault(); window.sent++; document.querySelector('[data-qa-popup-error-code]').hidden=false">
      <input name="vacancy_id" type="hidden" value="991010001">
      <textarea name="letter" data-qa="vacancy-response-form-letter-input">My complete letter.</textarea>
      <div data-qa="task-body"><div data-qa="task-question">My relevant experience?</div><textarea name="task_0">Complete final experience answer.</textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Other experience?</div><textarea name="task_1">Second complete answer.</textarea></div>
      <div data-qa-popup-error-code="negotiations-limit-exceeded" hidden>${message}</div>
      <button type="submit" data-qa="vacancy-response-letter-submit">Send application</button>
    </form></main><script>window.sent=0;</script>` }));
  await page.goto(url);
  commander = makeBrowserCommander({ page, enableNavigationManager: false, enableNetworkTracking: false });
  const db = createQADatabase(path.join(directory, 'qa.lino'));
  const options = { commander, saveAnswers: () => saveQAPairs({ commander, addOrUpdateQA: db.addOrUpdateQA, strict: true }),
    saveDraft: (args) => saveApplicationDraft({ ...args, directory }) };
  const events = [];
  let now = 1000;
  const prepare = (args) => prepareApplicationLimit({ ...options, ...args, getEvents: () => events, now: () => now,
    record: (type, data) => events.push({ type, at: new Date(now).toISOString(), ...data }) });

  // Hidden templates and arbitrary page text must not stop the app.
  assert.equal(await readApplicationLimit(commander), null);
  await page.locator('main').evaluate((e, message) => e.insertAdjacentHTML('beforeend', `<article>${message}</article>`), message);
  assert.equal(await readApplicationLimit(commander), null);
  await page.locator('[data-qa-popup-error-code]').evaluate((e) => { e.hidden = false; e.parentElement.style.display = 'none'; });
  assert.equal(await readApplicationLimit(commander), null);
  await page.locator('form').evaluate((e) => { e.style.display = ''; });
  assert.equal((await readApplicationLimit(commander)).code, 'negotiations-limit-exceeded');
  // Save both user answers plus the letter; no submit or skip and no five-hour retry.
  const limit = await prepare({});
  assert.equal(page.url(), url);
  assert.equal(await page.evaluate(() => window.sent), 0);
  assert.equal((await db.readQADatabase()).get('My relevant experience?'), 'Complete final experience answer.');
  assert.equal((await db.readQADatabase()).get('Other experience?'), 'Second complete answer.');
  assert.equal((await readApplicationDraft('991010001', directory)).fields.find((field) => field.name === 'letter').value, 'My complete letter.');
  assert.equal((await readApplicationDraft('991010001', directory)).requiresReview, false);
  const retries = createSubmissionRetries();
  assert.equal(await deferFailedSubmission({ ...options, retries }), false);
  assert.deepEqual(retries.ids(), []);
  const freshCommander = makeBrowserCommander({ page, enableNavigationManager: false, enableNetworkTracking: false });
  assert.equal((await prepare({ commander: freshCommander })).until, limit.until, 'Restart must retain the original deadline');
  await freshCommander.destroy();
  assert.equal(events.length, 1);

  // Preserve edits made during the cooldown, then restore them after exactly one refresh.
  const goto = commander.goto, wait = commander.wait;
  let refreshed = 0;
  commander.wait = async ({ ms }) => {
    assert.ok(ms <= 30000);
    assert.equal(refreshed, 0);
    await page.locator('[name=task_0]').fill('Latest user edit during the pause.');
    now += ms;
  };
  commander.goto = async ({ url: next }) => {
    assert.ok(now >= limit.until);
    assert.equal((await readApplicationDraft('991010001', directory)).fields.find((field) => field.name === 'task_0').value, 'Latest user edit during the pause.');
    refreshed++;
    await page.goto(next);
  };
  assert.equal(await waitForApplicationLimit({ ...options, limit, now: () => now, prepare }), true);
  assert.equal(refreshed, 1);
  await page.locator('textarea').evaluateAll((elements) => elements.forEach((element) => { element.value = ''; }));
  await restoreApplicationDraft({ commander, draft: await readApplicationDraft('991010001', directory) });
  assert.equal(await page.locator('[name=task_0]').inputValue(), 'Latest user edit during the pause.');
  assert.equal(await page.locator('[name=letter]').inputValue(), 'My complete letter.');
  assert.equal(await readApplicationLimit(commander), null);
  commander.goto = goto;
  commander.wait = wait;

  // Full form before sending, including a form opened with an existing server refusal.
  await page.goto(url);
  await page.locator('[data-qa-popup-error-code]').evaluate((e) => { e.hidden = false; });
  const fullOptions = { commander, MESSAGE: 'My complete letter.', readQADatabase: db.readQADatabase,
    addOrUpdateQA: db.addOrUpdateQA, autoSubmitEnabled: true, returnUrl: 'https://hh.ru/search/vacancy?resume=test',
    onApplicationSent: () => { throw new Error('A refused submission must never be counted'); } };
  assert.equal((await handleVacancyResponsePage(fullOptions)).status, 'daily_limit');
  assert.equal(await page.evaluate(() => window.sent), 0);
  // Full form after clicking Send: the real handler must return a limit, never claim success.
  await page.goto(url);
  assert.equal((await handleVacancyResponsePage(fullOptions)).status, 'daily_limit');
  assert.equal(await page.evaluate(() => window.sent), 1);
  assert.equal(await waitForManualResponse({ commander }), 'daily_limit');

  // The special no-test button uses the same negative confirmation handling.
  await page.goto(url);
  await page.locator('button').evaluate((button, qa) => button.setAttribute('data-qa', qa), SELECTORS.submitButtonWithoutQuestions.match(/data-qa="([^"]+)"/)[1]);
  assert.equal((await handleVacancyResponsePage(fullOptions)).status, 'daily_limit');
  assert.equal(await page.evaluate(() => window.sent), 1);

  // Popup failures, and alerts where the popup itself never appears.
  await page.goto('https://hh.ru/search/vacancy');
  await page.locator('[data-qa-popup-error-code]').evaluate((e) => { e.hidden = false; });
  const popup = await processModalApplication({ ...fullOptions, vacancyId: '991010001', autoSubmit: true });
  assert.equal(popup.reason, 'limit_reached');
  assert.equal(await page.evaluate(() => window.sent), 0);
  await page.locator('form').evaluate((form) => {
    document.body.append(form.querySelector('[data-qa-popup-error-code]'));
    form.remove();
  });
  assert.deepEqual(await waitForApplicationModal({ commander }), { appeared: false, limitError: true, status: 'limit_error' });
  // Rendered localized alerts work without the canonical data attribute.
  await page.locator('[data-qa-popup-error-code]').evaluate((e) => {
    e.removeAttribute('data-qa-popup-error-code'); e.setAttribute('role', 'alert'); e.textContent = 'Превышен лимит: не более 200 откликов за сутки.';
  });
  assert.equal((await readApplicationLimit(commander)).code, 'negotiations-limit-exceeded');
  await page.locator('[role=alert]').evaluate((e) => { e.textContent = 'Too many requests; wait 200 seconds'; });
  assert.equal(await readApplicationLimit(commander), null);
  console.log('Daily-limit browser checks passed: hidden errors excluded; full form, popup, no-test and standalone alerts; save-before-pause; restart deadline; no false success/RAM skip; edited draft restored after expiry.');
} finally {
  await commander?.destroy();
  await browser.close();
  await fs.rm(directory, { recursive: true, force: true });
  await fs.rm(path.join(process.cwd(), 'logs/application-drafts/991010001.json'), { force: true });
}
