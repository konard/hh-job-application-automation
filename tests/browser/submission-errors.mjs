/** Real browser regression: failed forms remain open; complete answers can be recovered. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createQADatabase } from '../../src/qa-database.mjs';
import { saveQAPairs } from '../../src/vacancy-response.mjs';
import { createSubmissionRetries, deferFailedSubmission } from '../../src/submission-retries.mjs';
import { readApplicationDraft, restoreApplicationDraft, saveApplicationDraft } from '../../src/application-drafts.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'failed-form-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://hh.ru/**', (route) => route.fulfill({ contentType: 'text/html', body: `
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
  const url = 'https://hh.ru/applicant/vacancy_response?vacancyId=123';
  await page.goto(url);
  await page.evaluate(() => { window.sent = 0; document.getElementById('send').onclick = () => { window.sent++; }; });
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  commander.goto = async () => { throw new Error('Must not navigate away from an error'); };
  const db = createQADatabase(path.join(directory, 'qa.lino'));
  const retries = createSubmissionRetries();
  const options = { commander, retries, saveAnswers: () => saveQAPairs({ commander, addOrUpdateQA: db.addOrUpdateQA, strict: true }),
    saveDraft: (args) => saveApplicationDraft({ ...args, directory }) };
  assert.equal(await deferFailedSubmission(options), true);
  const saved = await db.readQADatabase();
  assert.equal(saved.get('Your experience?'), 'Complete final answer, including its last words.');
  assert.equal(saved.get('Which tools?'), 'My exact custom answer.');
  const draft = await readApplicationDraft('123', directory);
  assert.equal(draft.requiresReview, true);
  assert.equal(draft.fields.find((f) => f.name === 'letter').value, 'My complete letter.');
  assert.equal(draft.fields.find((f) => f.name === 'tools' && f.checked).value, 'open');
  assert.equal(draft.fields.some((f) => /captcha|password|vacancy_id/i.test(f.name)), false);
  assert.equal(page.url(), url);
  assert.equal(await page.evaluate(() => window.sent), 0);
  // Removing the banner does not release the form for an automatic resend.
  await page.locator('[data-qa-popup-error-code]').evaluate((e) => e.remove());
  assert.equal(await deferFailedSubmission(options), true);
  assert.equal(page.url(), url);
  assert.equal(await page.evaluate(() => window.sent), 0);
  // A new document can recover the same answers, without submitting or replacing user edits.
  await page.goto(url);
  await page.evaluate(() => {
    document.querySelectorAll('textarea').forEach((e) => { e.value = ''; });
    document.querySelectorAll('input[type=radio]').forEach((e) => { e.checked = false; });
    document.querySelector('[name=answer]').value = 'User edit stays.';
    window.sent = 0; document.getElementById('send').onclick = () => { window.sent++; };
  });
  await restoreApplicationDraft({ commander, draft });
  assert.equal(await page.locator('[name=answer]').inputValue(), 'User edit stays.');
  assert.equal(await page.locator('[name=letter]').inputValue(), 'My complete letter.');
  assert.equal(await page.locator('[name=tools_text]').inputValue(), 'My exact custom answer.');
  assert.equal(await page.locator('[name=tools][value=open]').isChecked(), true);
  assert.equal(await page.evaluate(() => window.sent), 0);
  assert.equal(page.url(), url);
  console.log('Failed form checks passed: all final answers and the letter saved, custom choices recovered, errors retained on screen, no Send or navigation.');
  await commander.destroy();
} finally {
  await browser.close();
  await fs.rm(directory, { recursive: true, force: true });
}
