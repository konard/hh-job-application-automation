/**
 * The application popup on the vacancy list follows the same rules as the full form:
 * - its questions are autofilled from qa.lino and the user's answers are saved (A1, A5)
 * - it is sent without asking only when every answer is the saved answer of the very same
 *   question, in every --confirm mode; any other popup waits for the user (CONF8)
 * - a missing answer waits for the user with --on-missing-answers wait (CONF5)
 * - every skip is recorded in data/skipped-vacancies.lino (SEC5)
 */
import { PassThrough } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, test, assert } from 'test-anywhere';
import { processModalApplication } from '../src/vacancies.mjs';
import { createSkippedVacancies } from '../src/skipped-vacancies.mjs';
import { disableConfirmations, enableConfirmations } from '../src/confirmations.mjs';
import { SELECTORS } from '../src/hh-selectors.mjs';

const SEARCH_URL = 'https://hh.ru/search/vacancy?resume=1';
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The popup with text questions. `user` acts in the browser while the run waits: after the given
 * number of waits it sends the popup (`send`) or closes it (`close`)
 */
function fakePopup({ questions, resumeHidden = false, user = null }) {
  const state = {
    questions: questions.map((question) => ({ question, value: '', typed: false })),
    open: true,
    responded: false,
    waits: 0,
    clicks: [],
    filled: [],
  };
  const items = () => state.questions.map(({ question, value }, index) => ({
    type: 'textarea', question, selector: `textarea[name="task_${index}"]`, index, currentValue: value,
  }));
  return {
    state,
    engine: 'playwright',
    getUrl: () => SEARCH_URL,
    count: async ({ selector }) => {
      if (selector === SELECTORS.applicationForm) {
        return state.open ? 1 : 0;
      }
      if (selector === `${SELECTORS.applicationForm} textarea`) {
        return state.questions.length + 1;
      }
      return [SELECTORS.submitButtonPopup, SELECTORS.coverLetterTextareaPopup].includes(selector) ? 1 : 0;
    },
    isVisible: async ({ selector }) => selector === SELECTORS.coverLetterTextareaPopup,
    isEnabled: async () => true,
    findToggleButton: async () => null,
    evaluate: async ({ fn }) => {
      const source = fn.toString();
      if (source.includes('unansweredCount')) {
        return { totalCount: 0, unansweredCount: 0 };
      }
      if (source.includes('data-qa-question][data-qa-answer]')) {
        return state.questions.filter(({ typed }) => typed).map(({ question, value }) => ({ question, answer: value }));
      }
      if (source.includes('addEventListener')) {
        return null;
      }
      if (source.includes('taskIndex')) {
        return items();
      }
      if (source.includes('pairs.push')) {
        return state.questions.filter(({ value }) => value).map(({ question, value }) => ({ question, answer: value }));
      }
      return null;
    },
    safeEvaluate: async ({ operationName, defaultValue }) => {
      if (operationName === 'responded vacancy check') {
        return { value: state.responded };
      }
      if (operationName === 'resume visibility notice') {
        return { value: resumeHidden };
      }
      return { value: defaultValue };
    },
    fillTextArea: async ({ selector, text }) => {
      state.filled.push(selector);
      const index = Number(selector.match(/task_(\d+)/)?.[1] ?? -1);
      if (index >= 0) {
        state.questions[index].value = text;
      }
      return { filled: true, verified: true };
    },
    clickButton: async (options) => {
      state.clicks.push(options);
      if (options.selector === SELECTORS.submitButtonPopup) {
        state.open = false;
        state.responded = true;
      }
    },
    wait: async () => {
      state.waits++;
      if (user && state.open && state.waits >= user.after) {
        user.answer?.(state);
        state.open = false;
        state.responded = user.action === 'send';
      }
    },
  };
}

const sends = (popup) => popup.state.clicks.filter(({ selector }) => selector === SELECTORS.submitButtonPopup);

/** A skip store and a qa.lino in memory: answers saved during a popup are read back at once */
async function context(saved = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'popup-'));
  const qa = new Map(saved);
  const writes = [];
  return {
    skippedVacancies: createSkippedVacancies(path.join(dir, 'skipped-vacancies.lino')),
    writes,
    readQADatabase: async () => new Map(qa),
    addOrUpdateQA: async (question, answer) => {
      writes.push([question, answer]);
      qa.set(question, answer);
    },
  };
}

describe('popup autofill and sending (unattended, --confirm none)', () => {
  test('saved answers of the very same questions are autofilled and sent without asking', async () => {
    disableConfirmations();
    const { readQADatabase, addOrUpdateQA } = await context([
      ['popup-1: Ваш опыт с Go?', '7 лет'], ['popup-1: Зарплатные ожидания?', 'От 450000 рублей'],
    ]);
    const popup = fakePopup({ questions: ['popup-1: Ваш опыт с Go?', 'popup-1: Зарплатные ожидания?'] });
    const result = await processModalApplication({
      commander: popup, MESSAGE: 'Здравствуйте', vacancyId: '138000001', readQADatabase, addOrUpdateQA, autoSendExact: true,
    });
    assert.deepEqual(result, { success: true });
    assert.deepEqual(popup.state.questions.map(({ value }) => value), ['7 лет', 'От 450000 рублей']);
    assert.equal(sends(popup).length, 1);
    assert.equal(sends(popup)[0].autoSend, true);
  });

  test('a popup with a reworded saved question is autofilled but not sent: it waits for the user', async () => {
    disableConfirmations();
    const { skippedVacancies, readQADatabase, addOrUpdateQA, writes } = await context([
      ['popup-2: Сколько лет опыта коммерческой разработки на Go?', '7 лет'],
    ]);
    const user = { after: 2, action: 'close' };
    const popup = fakePopup({ questions: ['popup-2: Сколько лет опыта коммерческой разработки на Go'], user });
    const result = await processModalApplication({
      commander: popup, MESSAGE: 'Здравствуйте', vacancyId: '138000002', title: 'Go Developer | Acme',
      readQADatabase, addOrUpdateQA, autoSendExact: true, skippedVacancies,
    });
    assert.equal(popup.state.questions[0].value, '7 лет');
    assert.equal(sends(popup).length, 0);
    // Closed in the browser without sending: recorded, never silently skipped
    assert.deepEqual(result, { success: false, reason: 'closed_by_user' });
    const entry = (await skippedVacancies.read()).get('138000002');
    assert.equal(entry.reason, 'skipped_by_user');
    assert.equal(entry.title, 'Go Developer | Acme');
    // Nobody confirmed the autofilled answer, so it is not saved as this wording's exact answer
    assert.deepEqual(writes, []);
  });

  test('--auto-submit-vacancy-response-form sends it unattended, as on the full form', async () => {
    disableConfirmations();
    const { readQADatabase, addOrUpdateQA, writes } = await context([
      ['popup-3: Сколько лет опыта коммерческой разработки на Go?', '7 лет'],
    ]);
    const popup = fakePopup({ questions: ['popup-3: Сколько лет опыта коммерческой разработки на Go'] });
    const result = await processModalApplication({
      commander: popup, vacancyId: '138000003', readQADatabase, addOrUpdateQA, autoSendExact: true, autoSubmit: true,
    });
    assert.deepEqual(result, { success: true });
    assert.equal(sends(popup)[0].autoSend, false);
    // Sent answers are saved under the form's own wording
    assert.deepEqual(writes, [['popup-3: Сколько лет опыта коммерческой разработки на Go', '7 лет']]);
  });

  test('a question without a saved answer waits for the user (--on-missing-answers wait), who sends it', async () => {
    disableConfirmations();
    const { skippedVacancies, readQADatabase, addOrUpdateQA, writes } = await context();
    const deferred = [];
    // The user types the answer while the run waits (saved on the next check), then sends the popup
    const popup = fakePopup({ questions: ['popup-4: Опыт с Kubernetes?'], user: { after: 2, action: 'send' } });
    popup.wait = ((wait) => async (options) => {
      Object.assign(popup.state.questions[0], { value: 'Да, 3 года', typed: true });
      return wait(options);
    })(popup.wait);
    const result = await processModalApplication({
      commander: popup, vacancyId: '138000004', skippedVacancies, readQADatabase, addOrUpdateQA, autoSendExact: true,
      deferredQuestions: { questionsToSkip: async () => [], defer: async (...args) => deferred.push(args) },
    });
    assert.deepEqual(result, { success: true });
    assert.deepEqual(deferred, []);
    assert.equal(sends(popup).length, 0);
    assert.deepEqual(writes, [['popup-4: Опыт с Kubernetes?', 'Да, 3 года']]);
    assert.equal((await skippedVacancies.read()).size, 0);
  });

  test('--on-missing-answers skip defers it and records the skip', async () => {
    disableConfirmations();
    const { skippedVacancies, readQADatabase, addOrUpdateQA } = await context();
    const deferred = [];
    const popup = fakePopup({ questions: ['popup-5: Опыт с Kubernetes?'] });
    const result = await processModalApplication({
      commander: popup, vacancyId: '138000005', skippedVacancies, onMissingAnswers: 'skip', readQADatabase, addOrUpdateQA,
      deferredQuestions: { questionsToSkip: async () => [], defer: async (...args) => deferred.push(args) },
    });
    assert.deepEqual(result, { success: false, reason: 'questions_deferred' });
    assert.deepEqual(deferred, [[['popup-5: Опыт с Kubernetes?'], '138000005']]);
    assert.equal((await skippedVacancies.read()).get('138000005').reason, 'questions_deferred');
  });

  test('a hidden resume skip is recorded', async () => {
    disableConfirmations();
    const { skippedVacancies } = await context();
    const popup = fakePopup({ questions: [], resumeHidden: true });
    const result = await processModalApplication({ commander: popup, vacancyId: '138000006', skippedVacancies });
    assert.deepEqual(result, { success: false, reason: 'resume_not_visible' });
    assert.equal((await skippedVacancies.read()).get('138000006').reason, 'resume_not_visible');
  });

  test('--ignore-vacancies-with-questionnaire records the skip in the same store', async () => {
    disableConfirmations();
    const { skippedVacancies } = await context();
    const popup = fakePopup({ questions: ['popup-7: Опыт?'] });
    const result = await processModalApplication({
      commander: popup, vacancyId: '138000007', skippedVacancies, ignoreVacanciesWithQuestionnaire: true,
    });
    assert.deepEqual(result, { success: false, reason: 'questionnaire_ignored' });
    assert.deepEqual([...await skippedVacancies.skippedVacancyIds({ ignoreQuestionnaires: true })], ['138000007']);
  });
});

describe('popup in an interactive run without --confirm send', () => {
  test('a popup with a non-exact answer is sent only after y', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['answers'], onStop: () => {}, input });
    const { readQADatabase, addOrUpdateQA } = await context([
      ['popup-8: Сколько лет опыта коммерческой разработки на Go?', '7 лет'],
    ]);
    const popup = fakePopup({ questions: ['popup-8: Сколько лет опыта коммерческой разработки на Go'] });
    const running = processModalApplication({
      commander: popup, vacancyId: '138000008', readQADatabase, addOrUpdateQA, autoSendExact: true,
    });
    await tick(50);
    assert.equal(sends(popup).length, 0);
    input.write('y\n');
    assert.deepEqual(await running, { success: true });
    assert.equal(sends(popup).length, 1);
    disableConfirmations();
  });
});
