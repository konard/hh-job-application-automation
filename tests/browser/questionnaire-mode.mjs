/** Real form/popup checks, isolated from the user's profile, answers and HH requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';

process.env.NODE_ENV = 'test';
process.env.NOTIFY = '0';
const cwd = process.cwd();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'no-questions-browser-'));
process.chdir(directory);
const { questionnaireMode, skipQuestionnaireForNow } = await import('../../src/questionnaire-mode.mjs');
const { handleVacancyResponsePage, waitForManualResponse, saveQAPairs } = await import('../../src/vacancy-response.mjs');
const { processModalApplication } = await import('../../src/vacancies.mjs');
const { readApplicationDraft } = await import('../../src/application-drafts.mjs');
const { disableConfirmations } = await import('../../src/confirmations.mjs');
disableConfirmations();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const search = 'https://hh.ru/search/vacancy';
  await page.route('https://hh.ru/**', (route) => {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get('kind') ?? 'none';
    const field = kind === 'text' || kind === 'popup' ? '<textarea name="experience">My reviewed experience.</textarea>'
      : kind === 'none' ? '' : `<div data-qa="cell"><label><input type="${kind}" name="tool" value="yes" checked><span data-qa="cell-text-content">Yes</span></label></div>`;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      url.pathname === '/search/vacancy' && kind !== 'popup' ? '<main>Other vacancies</main>' : `
      <main><form id="RESPONSE_MODAL_FORM_ID" name="vacancy_response" onsubmit="event.preventDefault();window.sent++; document.querySelector('main').innerHTML='Вы откликнулись'">
      <input type="hidden" name="vacancy_id" value="${url.searchParams.get('vacancyId')}">
      <textarea name="letter" data-qa="vacancy-response-form-letter-input">My complete letter.</textarea>
      ${field ? `<div data-qa="task-body"><div data-qa="task-question">Your ${kind} experience?</div>${field}</div>` : ''}
      <button type="button" data-qa="response-popup-close" onclick="this.closest('form').remove()">Close</button>
      <button type="submit" data-qa="vacancy-response-letter-submit">Send application</button></form></main>
      <script>window.sent=0</script>` });
  });
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  commander.goto = ({ url }) => page.goto(url, { waitUntil: 'domcontentloaded' });
  const qa = new Map();
  const options = { commander, MESSAGE: 'My complete letter.', returnUrl: search,
    readQADatabase: async () => qa, addOrUpdateQA: async (q, a) => { qa.set(q, a); },
    skippedVacancies: { record: async () => { throw new Error('No durable skip is allowed'); } },
    deferredQuestions: { defer: async () => { throw new Error('No deferred question is allowed'); }, questionsToSkip: async () => [] },
  };
  questionnaireMode.setEnabled(true);
  for (const [index, kind] of ['text', 'radio', 'checkbox'].entries()) {
    const id = String(999710001 + index);
    await page.goto(`https://hh.ru/applicant/vacancy_response?vacancyId=${id}&kind=${kind}`);
    assert.equal((await handleVacancyResponsePage(options)).status, 'questionnaire_paused');
    assert.equal(page.url(), search);
    assert.ok(questionnaireMode.ids().includes(id));
    const draft = await readApplicationDraft(id);
    assert.equal(draft.requiresReview, false);
    assert.ok(draft.fields.some(f => f.name === 'letter' && f.value === 'My complete letter.'));
  }
  assert.equal(qa.get('Your text experience?'), 'My reviewed experience.');

  await page.goto(`${search}?kind=popup&vacancyId=999710004`);
  assert.equal((await processModalApplication({ ...options, vacancyId: '999710004' })).reason, 'questionnaire_paused');
  assert.equal(await page.locator('form').count(), 0);

  await page.goto('https://hh.ru/applicant/vacancy_response?vacancyId=999710005&kind=none');
  let sent = 0;
  await handleVacancyResponsePage({ ...options, onApplicationSent: async () => { sent++; } });
  assert.equal(sent, 1, 'Cover-letter-only applications continue while questionnaires are paused');

  questionnaireMode.setEnabled(false);
  const first = questionnaireMode.takeNext();
  assert.equal(first.vacancyId, '999710001');
  await page.goto(first.url);
  const restored = await handleVacancyResponsePage({ ...options, readQADatabase: async () => new Map() });
  assert.equal(restored.status, 'awaiting_user');
  assert.equal(await page.locator('[name=experience]').inputValue(), 'My reviewed experience.');
  const waiting = waitForManualResponse({ commander,
    skipQuestionnaire: () => skipQuestionnaireForNow({ commander, vacancyId: first.vacancyId,
      saveAnswers: () => saveQAPairs(options), leave: () => commander.goto({ url: search }) }) });
  questionnaireMode.setEnabled(true);
  assert.equal(await waiting, 'questionnaire_paused', 'Enabling the mode releases an already-waiting form');
  assert.equal(page.url(), search);
  assert.ok(questionnaireMode.ids().includes(first.vacancyId));
  await commander.destroy();
  console.log('No-questions checks passed: text/radio/checkbox, popup, no durable skips, preserved drafts, simple application, resume and live toggle.');
} finally {
  questionnaireMode.setEnabled(false);
  await browser.close();
  process.chdir(cwd);
  await fs.rm(directory, { recursive: true, force: true });
}
