/** Real browser regression: save before RAM skips; validation errors retain their form. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createQADatabase } from '../../src/qa-database.mjs';
import { saveQAPairs } from '../../src/vacancy-response.mjs';
import { createSubmissionRetries, deferFailedSubmission, readSubmissionError, SUBMISSION_RETRY_MS } from '../../src/submission-retries.mjs';
import { readApplicationDraft, restoreApplicationDraft, saveApplicationDraft } from '../../src/application-drafts.mjs';

process.env.NODE_ENV = 'test';
process.env.NOTIFY = '0';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'failed-form-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://hh.ru/**', (route) => route.fulfill({ contentType: 'text/html', body:
    new URL(route.request().url()).pathname === '/search/vacancy' ? '<main>Other vacancies</main>' : `
    <form id="RESPONSE_MODAL_FORM_ID" name="vacancy_response">
      <input type="hidden" name="vacancy_id" value="123"><input type="password" name="password" value="secret">
      <input name="captchaText" value="excluded"><textarea name="letter">My complete letter.</textarea>
      <div data-qa="task-body"><div data-qa="task-question">Your experience?</div><textarea name="answer">Complete final answer, including its last words.</textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Which tools?</div>
        <div data-qa="cell"><label><input name="tools" type="radio" value="yes"><span data-qa="cell-text-content">Yes</span></label></div>
        <div data-qa="cell"><label><input name="tools" type="radio" value="open" checked><span data-qa="cell-text-content">Other</span></label></div>
        <textarea name="tools_text">My exact custom answer.</textarea></div>
      <div data-qa-popup-error-code="unknown">An error occurred, please try again</div>
      <button id="send" type="button">Send application</button>
    </form>` }));
  let sent = 0;
  await page.exposeFunction('recordSend', () => { sent++; });
  const bindSend = () => page.evaluate(() => { document.getElementById('send').onclick = () => window.recordSend(); });
  const url = 'https://hh.ru/applicant/vacancy_response?vacancyId=123';
  const searchUrl = 'https://hh.ru/search/vacancy?resume=ru1';
  await page.goto(url);
  await bindSend();
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const db = createQADatabase(path.join(directory, 'qa.lino'));
  let now = 1000;
  const retries = createSubmissionRetries({ now: () => now });
  let mayNavigate = true;
  let navigations = 0;
  commander.goto = async ({ url }) => {
    assert.equal(mayNavigate, true, 'Validation errors must not leave their form');
    const saved = await db.readQADatabase();
    assert.equal(saved.get('Your experience?'), 'Complete final answer, including its last words.');
    assert.equal(saved.get('Which tools?'), 'My exact custom answer.');
    assert.equal((await readApplicationDraft('123', directory)).fields.find((f) => f.name === 'letter').value, 'My complete letter.');
    navigations++;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  };
  const options = { commander, retries, returnUrl: searchUrl,
    saveAnswers: () => saveQAPairs({ commander, addOrUpdateQA: db.addOrUpdateQA, strict: true }),
    saveDraft: (args) => saveApplicationDraft({ ...args, directory }) };
  assert.equal(await deferFailedSubmission(options), true);
  const draft = await readApplicationDraft('123', directory);
  assert.equal(draft.requiresReview, false, 'Recovery data must not become a persistent generic-error hold');
  assert.equal(draft.fields.find((f) => f.name === 'tools' && f.checked).value, 'open');
  assert.equal(draft.fields.some((f) => /captcha|password|vacancy_id/i.test(f.name)), false);
  assert.equal('until' in draft, false, 'The retry deadline stays in RAM');
  assert.equal(page.url(), searchUrl);
  assert.equal(navigations, 1);
  assert.equal(sent, 0);
  assert.equal(retries.get('123').until, 1000 + SUBMISSION_RETRY_MS);
  assert.equal(retries.takeDue(), null);
  now += SUBMISSION_RETRY_MS;
  assert.equal(retries.takeDue().vacancyId, '123');
  assert.deepEqual(createSubmissionRetries().ids(), [], 'New processes do not reconstruct skips from recovery files');

  // A due retry can recover the complete draft without submitting or replacing user edits.
  await page.goto(url);
  await bindSend();
  await page.evaluate(() => {
    document.querySelectorAll('textarea').forEach((e) => { e.value = ''; });
    document.querySelectorAll('input[type=radio]').forEach((e) => { e.checked = false; });
    document.querySelector('[name=answer]').value = 'User edit stays.';
    document.querySelector('[data-qa-popup-error-code]').remove();
  });
  await restoreApplicationDraft({ commander, draft });
  assert.equal(await page.locator('[name=answer]').inputValue(), 'User edit stays.');
  assert.equal(await page.locator('[name=letter]').inputValue(), 'My complete letter.');
  assert.equal(await page.locator('[name=tools_text]').inputValue(), 'My exact custom answer.');
  assert.equal(await page.locator('[name=tools][value=open]').isChecked(), true);
  assert.equal(await readSubmissionError(commander), null, 'A recovered generic error must not reintroduce a persistent hold');
  assert.equal(sent, 0);

  // Other errors stay open, including after their banner is dismissed.
  mayNavigate = false;
  await page.goto(url);
  await bindSend();
  await page.locator('[data-qa-popup-error-code]').evaluate((e) => {
    e.setAttribute('data-qa-popup-error-code', 'letter-required'); e.textContent = 'Check the cover letter';
  });
  const validationRetries = createSubmissionRetries();
  assert.equal(await deferFailedSubmission({ ...options, retries: validationRetries }), true);
  assert.equal((await readApplicationDraft('123', directory)).requiresReview, true);
  await page.locator('[data-qa-popup-error-code]').evaluate((e) => e.remove());
  assert.equal(await deferFailedSubmission({ ...options, retries: validationRetries }), true);
  assert.equal(page.url(), url);
  assert.equal(sent, 0);
  assert.equal(navigations, 1);
  assert.deepEqual(validationRetries.ids(), []);
  console.log('Submission checks passed: complete answers saved before generic-error RAM skips, five-hour expiry, recoverable drafts, no persistent skips or resubmission, validation errors stay open.');
  await commander.destroy();
} finally {
  await browser.close();
  await fs.rm(directory, { recursive: true, force: true });
}
