/** Review-only prefill with a real browser, isolated from user profiles and HH.ru. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { allAnswersExact, extractPageQuestions, fillTextareaQuestion } from '../../src/qa.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: `
    <form onsubmit="window.sent = true; return false" style="margin-top:1500px">
      <div data-qa="task-body"><div data-qa="task-question">Linux?</div><textarea name="linux"></textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Network?</div><textarea name="network">My existing answer.</textarea></div>
      <button>Send</button>
    </form>` }));
  await page.goto('https://review.test/');
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const draft = 'I use Linux for development and server tasks.';
  const fields = await extractPageQuestions({ evaluate: commander.evaluate });
  await fillTextareaQuestion({ commander, questionData: { ...fields[0], answer: draft }, reviewOnly: true });
  await fillTextareaQuestion({ commander, questionData: { ...fields[1], answer: 'Do not replace my text.' }, reviewOnly: true });
  const filled = await extractPageQuestions({ evaluate: commander.evaluate });
  assert.equal(filled[0].currentValue, draft);
  assert.equal(filled[0].requiresReview, true);
  assert.equal(filled[1].currentValue, 'My existing answer.');
  assert.equal(filled[1].requiresReview, undefined, 'An untouched field is not marked as a generated draft');
  assert.equal(allAnswersExact(filled, new Map(filled.map((item) => [item.question, item.currentValue]))), false);
  assert.equal(await page.evaluate(() => Boolean(window.sent)), false);
  assert.equal(await page.evaluate(() => window.scrollY > 0), true);
  assert.equal(await page.locator('textarea[name="linux"]').getAttribute('data-hh-answer-draft'), 'true');
  console.log('Review draft checks passed: visible prefill, existing text preserved, review retained even when the answers are saved, no submission.');
} finally { await browser.close(); }
