/**
 * The vacancy list and the full response form with fake commanders:
 * - the vacancy description is requested only when the card does not settle the filters, and an
 *   on-site vacancy that is not programming is filtered by it (FLT5)
 * - external-site, timeout and full-form skips are recorded in skipped-vacancies.lino (SEC5)
 * - an application hh.ru does not confirm on the full form goes to the same stop-or-wait as the
 *   popup (RUN5)
 * - the full form is not sent unattended when an answer is not the saved answer of the very same
 *   question, even after the auto-save wrote the autofilled answer under the form's wording (CONF8)
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, test, assert } from 'test-anywhere';
import { clearProcessedVacancies, findAndProcessVacancyButton, isVacancyProcessed } from '../src/vacancies.mjs';
import { handleVacancyResponsePage, setupQAHandling, waitForManualResponse } from '../src/vacancy-response.mjs';
import { createSkippedVacancies } from '../src/skipped-vacancies.mjs';
import { createVacancyFilters } from '../src/vacancy-filters.mjs';
import { disableConfirmations } from '../src/confirmations.mjs';
import { SELECTORS } from '../src/hh-selectors.mjs';
import { LETTER_SELECTORS } from '../src/letter-attach.mjs';
import { submissionRetries } from '../src/submission-retries.mjs';
import { createVacancyCache } from '../src/vacancy-cache.mjs';
import { createVacancyInsights } from '../src/vacancy-insights.mjs';
import { applicationResumeLanguage } from '../src/application-resume.mjs';
import { withContacts } from '../src/contacts.mjs';

const SEARCH_URL = 'https://hh.ru/search/vacancy?resume=1';

async function stores() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flows-'));
  return {
    dir,
    skippedVacancies: createSkippedVacancies(path.join(dir, 'skipped-vacancies.lino')),
    vacancyFilters: createVacancyFilters({
      rulesPath: path.join(import.meta.dir, '..', 'data', 'vacancy-filters.lino'),
      filteredPath: path.join(dir, 'filtered-vacancies.lino'),
    }),
  };
}

/**
 * The vacancy list with one "Откликнуться" button
 * @param {Object} options
 * @param {string} options.vacancyId
 * @param {string[]} options.card - Card lines
 * @param {string} [options.description] - What the vacancy page request returns
 * @param {'direct'|'timeout'} [options.after] - What the click opens
 */
function fakeList({ vacancyId, card, description = '', after = 'timeout' }) {
  const state = { descriptionRequests: 0, clicks: [] };
  return {
    state,
    engine: 'playwright',
    getUrl: () => SEARCH_URL,
    findByText: async () => 'text=Откликнуться',
    normalizeSelector: async () => 'a[data-qa="vacancy-serp__vacancy_response"]',
    safeEvaluate: async ({ operationName, defaultValue }) => {
      switch (operationName) {
      case 'find unprocessed vacancy button':
        return { value: { totalButtons: 1, unprocessedCount: 1, buttonIndex: 0, vacancyId } };
      case 'vacancy card text':
        return { value: { lines: card, title: `${card[0]} | ${card[1]}` } };
      case 'vacancy description for the vacancy filters':
        state.descriptionRequests++;
        return { value: description };
      case 'vacancy button isEnabled':
      case 'vacancy button click':
        return { value: true };
      case 'direct application check':
        return { value: { found: true, reason: 'magritte-alert', url: 'https://career.example.com/jobs/42' } };
      default:
        return { value: defaultValue };
      }
    },
    waitForSelector: async () => {
      throw new Error('Timeout 10000ms exceeded');
    },
    count: async ({ selector }) => (after === 'direct' && selector === SELECTORS.directApplicationCancelButton ? 1 : 0),
    clickButton: async (options) => state.clicks.push(options),
    wait: async () => {},
  };
}

const runList = (commander, { skippedVacancies, vacancyFilters }) => findAndProcessVacancyButton({
  commander, skippedVacancies, vacancyFilters, START_URL: SEARCH_URL, pageClosedByUser: () => false,
  waitForUrlCondition: async () => {},
});

describe('vacancy list', () => {
  test('the vacancy-first path opens its form directly after collection, with no search bounce or Apply click', async () => {
    clearProcessedVacancies();
    const list = fakeList({ vacancyId: '139000020', card: ['Backend Developer', 'Example'] });
    let url = SEARCH_URL;
    const steps = [];
    list.getUrl = () => url;
    list.goto = async ({ url: next }) => { steps.push(next); url = next; };
    const result = await findAndProcessVacancyButton({ commander: list, applyFromVacancyPage: true, vacancyPreviewMs: 3000,
      selectApplicationResume: async () => {}, vacancyInsights: { enabled: true, visit: async (options) => {
        assert.equal(options.stayOnVacancy, true);
        assert.equal(options.previewMs, 3000);
        url = 'https://hh.ru/vacancy/139000020'; steps.push(url);
        return { id: '139000020', description: 'Build backend services.' };
      } } });
    assert.equal(result.status, 'vacancy_response_detected');
    assert.deepEqual(steps.map((url) => new URL(url).pathname), ['/vacancy/139000020', '/applicant/vacancy_response']);
    assert.equal(new URL(url).searchParams.get('vacancyId'), '139000020');
    assert.deepEqual(list.state.clicks, []);
  });

  test('a vacancy filtered after collection returns to search; a user leaving its page is preserved', async () => {
    for (const userLeft of [false, true]) {
      clearProcessedVacancies();
      const list = fakeList({ vacancyId: '139000021', card: ['Technician', 'Example'] });
      let url = SEARCH_URL;
      const navigations = [];
      list.getUrl = () => url;
      list.goto = async ({ url: next }) => { navigations.push(next); url = next; };
      const result = await findAndProcessVacancyButton({ commander: list, applyFromVacancyPage: true,
        vacancyInsights: { enabled: true, visit: async () => {
          url = userLeft ? 'https://hh.ru/chat/123' : 'https://hh.ru/vacancy/139000021';
          return { id: '139000021', description: 'On-site service work.' };
        } }, vacancyFilters: { match: async () => ({ kind: 'page', pattern: 'On-site' }), remember: async () => {} } });
      assert.equal(result.status, userLeft ? 'navigation_detected' : 'filtered_out');
      assert.deepEqual(navigations, userLeft ? [] : [SEARCH_URL]);
    }
  });

  test('a verified vacancy is still opened by ID when its card disappears after collection', async () => {
    clearProcessedVacancies();
    const list = fakeList({ vacancyId: '139000019', card: ['Backend Developer', 'Acme'] });
    const original = list.safeEvaluate;
    list.safeEvaluate = async options => options.operationName === 'find unprocessed vacancy button' && options.args[2]
      ? { value: { totalButtons: 0, unprocessedCount: 0, buttonIndex: -1, vacancyId: null } } : original(options);
    const navigations = [];
    list.goto = async ({ url }) => navigations.push(url);
    const result = await findAndProcessVacancyButton({ commander: list, selectApplicationResume: async () => {},
      vacancyInsights: { enabled: true, visit: async () => ({ id: '139000019', description: 'Develop backend software.' }) } });
    assert.equal(result.status, 'vacancy_response_detected');
    assert.equal(new URL(navigations[0]).searchParams.get('vacancyId'), '139000019');
    assert.equal(list.state.clicks.length, 0, 'Never click a replacement card or a one-click Apply shortcut');
  });

  test('vacancy collection precedes applying and the returning search card is found again by ID', async () => {
    clearProcessedVacancies();
    const { skippedVacancies, vacancyFilters } = await stores();
    const list = fakeList({ vacancyId: '139000009', card: ['Backend Developer', 'Acme'] });
    const steps = [];
    const original = list.safeEvaluate;
    list.safeEvaluate = async (options) => {
      if (options.operationName === 'find unprocessed vacancy button' && options.args[2]) {
        assert.deepEqual(steps, ['collected']);
        return { value: { totalButtons: 3, unprocessedCount: 1, buttonIndex: 2, vacancyId: '139000009' } };
      }
      if (options.operationName === 'vacancy button click') {
        assert.equal(options.args[1], 2);
        steps.push('applied');
      }
      return original(options);
    };
    await findAndProcessVacancyButton({ commander: list, skippedVacancies, vacancyFilters,
      START_URL: SEARCH_URL, pageClosedByUser: () => false, waitForUrlCondition: async () => {},
      vacancyInsights: { enabled: true, visit: async ({ vacancyId, returnUrl }) => {
        assert.equal(vacancyId, '139000009'); assert.equal(returnUrl, SEARCH_URL); steps.push('collected');
        return { id: vacancyId, description: 'Develop backend software.' };
      } } });
    assert.deepEqual(steps, ['collected', 'applied']);
  });

  test('a vague card has its description read once; field work is filtered without a click', async () => {
    clearProcessedVacancies();
    const { dir, skippedVacancies, vacancyFilters } = await stores();
    const list = fakeList({
      vacancyId: '139000001',
      card: ['Сервисный инженер', 'ТехноСервис', 'Казань'],
      description: 'Сервисный инженер\nФормат работы: разъездной\nРемонт оборудования на объектах клиентов',
    });
    const result = await runList(list, { skippedVacancies, vacancyFilters });
    assert.deepEqual(result, { status: 'filtered_out', vacancyId: '139000001', descriptionRead: true });
    assert.equal(list.state.descriptionRequests, 1);
    assert.deepEqual(list.state.clicks, []);
    const filtered = await fs.readFile(path.join(dir, 'filtered-vacancies.lino'), 'utf8');
    assert.match(filtered, /139000001\n {2}"on-site: разъездной"\n {2}"title: Сервисный инженер \| ТехноСервис"/);
  });

  test('a Go developer card costs no description request; an external-site vacancy is recorded with its link', async () => {
    clearProcessedVacancies();
    const { skippedVacancies, vacancyFilters } = await stores();
    const list = fakeList({
      vacancyId: '139000002',
      card: ['Go-разработчик', 'Ozon', 'Москва', 'Опыт 3–6 лет'],
      after: 'direct',
    });
    const result = await runList(list, { skippedVacancies, vacancyFilters });
    assert.equal(result.status, 'direct_application_skipped');
    assert.equal(list.state.descriptionRequests, 0);
    const entry = (await skippedVacancies.read()).get('139000002');
    assert.equal(entry.reason, 'external_site');
    assert.equal(entry.url, 'https://career.example.com/jobs/42');
    assert.equal(entry.title, 'Go-разработчик | Ozon');
    assert.deepEqual([...await skippedVacancies.skippedVacancyIds()], ['139000002']);
  });

  test('a popup that does not appear is recorded and opened once more on the next run', async () => {
    clearProcessedVacancies();
    const { skippedVacancies, vacancyFilters } = await stores();
    const list = fakeList({ vacancyId: '139000003', card: ['Backend Developer', 'Acme'] });
    const result = await runList(list, { skippedVacancies, vacancyFilters });
    assert.equal(result.status, 'modal_timeout');
    assert.equal((await skippedVacancies.read()).get('139000003').reason, 'modal_timeout');
    assert.equal((await skippedVacancies.skippedVacancyIds()).size, 0);
    assert.equal(isVacancyProcessed('139000003'), true);
  });

  /**
   * The list where the click sends the application at once: the card says so and offers
   * «Приложить письмо»; the letter popup takes the letter (or not, when it is broken)
   */
  function sentAtOnceList({ vacancyId, letterPopup = true, vacancyPageOffer = false }) {
    const list = fakeList({ vacancyId, card: ['Head of Product', 'Acme'] });
    const offer = `[data-letter-offer="${vacancyId}"]`;
    const state = Object.assign(list.state, { popupOpen: false, letter: '', sent: false, gotos: [], url: SEARCH_URL });
    return Object.assign(list, {
      getUrl: () => state.url,
      evaluate: async ({ args }) => (args?.[0] === vacancyId ? { applied: true, offer: state.sent ? null : offer } : state.letter),
      count: async ({ selector }) => {
        if (selector === LETTER_SELECTORS.textarea) {
          return state.popupOpen ? 1 : 0;
        }
        if (selector === offer) {
          return state.sent ? 0 : 1;
        }
        if (selector === LETTER_SELECTORS.pageButton) {
          return vacancyPageOffer && state.url.includes('/vacancy/') && !state.sent ? 1 : 0;
        }
        return 0;
      },
      clickButton: async (options) => {
        state.clicks.push(options.selector);
        if ((options.selector === offer || options.selector === LETTER_SELECTORS.pageButton) && letterPopup) {
          state.popupOpen = true;
        }
        if (options.selector === LETTER_SELECTORS.submit && state.letter) {
          Object.assign(state, { popupOpen: false, sent: true });
        }
      },
      fillTextArea: async ({ text }) => {
        state.letter = text;
        return { filled: true, verified: true, actualValue: text };
      },
      goto: async ({ url }) => {
        state.gotos.push(url);
        state.url = url;
      },
    });
  }

  const runWithLetter = (commander, stores) => findAndProcessVacancyButton({
    commander, ...stores, MESSAGE: 'Здравствуйте! Мой опыт…', START_URL: SEARCH_URL, pageClosedByUser: () => false,
    waitForUrlCondition: async () => {},
  });

  test('an application sent at the click is counted at once, and its letter attached in the card', async () => {
    clearProcessedVacancies();
    const { skippedVacancies, vacancyFilters } = await stores();
    const list = sentAtOnceList({ vacancyId: '139000004' });
    const result = await runWithLetter(list, { skippedVacancies, vacancyFilters });
    assert.equal(result.status, 'success');
    assert.equal(list.state.letter, 'Здравствуйте! Мой опыт…');
    assert.equal(list.state.sent, true);
    assert.deepEqual(list.state.gotos, []);
    assert.equal((await skippedVacancies.read()).size, 0);
  });

  test('a letter the card cannot take is attached on the vacancy page, then back to the list', async () => {
    clearProcessedVacancies();
    const { skippedVacancies, vacancyFilters } = await stores();
    const list = sentAtOnceList({ vacancyId: '139000005', letterPopup: false, vacancyPageOffer: true });
    // The card's popup does not open; the vacancy page's does
    const click = list.clickButton;
    list.clickButton = async (options) => {
      await click(options);
      if (options.selector === LETTER_SELECTORS.pageButton) {
        list.state.popupOpen = true;
      }
    };
    const result = await runWithLetter(list, { skippedVacancies, vacancyFilters });
    assert.equal(result.status, 'success');
    assert.equal(list.state.sent, true);
    assert.deepEqual(list.state.gotos, ['https://hh.ru/vacancy/139000005', SEARCH_URL]);
  });

  test('a letter that cannot be attached at all is kept in skipped-vacancies.lino and kept after the application is counted', async () => {
    clearProcessedVacancies();
    const { skippedVacancies, vacancyFilters } = await stores();
    const list = sentAtOnceList({ vacancyId: '139000006', letterPopup: false });
    const result = await runWithLetter(list, { skippedVacancies, vacancyFilters });
    assert.equal(result.status, 'success');
    assert.equal((await skippedVacancies.read()).get('139000006').reason, 'letter_not_attached');
    await skippedVacancies.forget('139000006');
    assert.deepEqual(await skippedVacancies.lettersToAttach(), ['139000006']);
    assert.equal((await skippedVacancies.skippedVacancyIds()).has('139000006'), true);
  });
});

const RESPONSE_URL = 'https://hh.ru/applicant/vacancy_response?vacancyId=139100001';

/**
 * The full response form with text questions
 * @param {Object} options
 * @param {string[]} [options.questions]
 * @param {boolean} [options.confirms=true] - hh.ru shows «Вы откликнулись» after the send click
 * @param {boolean} [options.direct=false] - The form is a direct application (employer's site)
 * @param {Function} [options.onWait] - Runs on every wait (e.g. the periodic auto-save)
 */
function fakeForm({ questions = [], confirms = true, direct = false, withoutTest = false, reviewOnly = false, onWait = () => {} } = {}) {
  const state = { questions: questions.map((question) => ({ question, value: '' })), submitted: false, clicks: [], gotos: [], waits: [] };
  const items = () => state.questions.map(({ question, value }, index) => ({
    type: 'textarea', question, selector: `textarea[name="task_${index}"]`, index, currentValue: value,
    ...(reviewOnly ? { requiresReview: true } : {}),
  }));
  return {
    state,
    engine: 'playwright',
    getUrl: () => RESPONSE_URL,
    waitForSelector: async () => {},
    isVisible: async ({ selector }) => selector === SELECTORS.coverLetterTextareaForm,
    isEnabled: async () => true,
    findToggleButton: async () => null,
    count: async ({ selector }) => {
      if (selector === SELECTORS.directApplicationCancelButton) {
        return direct ? 1 : 0;
      }
      if (selector === 'textarea') {
        return state.questions.length + 1;
      }
      if (selector === SELECTORS.submitButtonWithoutQuestions) return withoutTest ? 1 : 0;
      return [SELECTORS.coverLetterTextareaForm, SELECTORS.submitButtonLetter].includes(selector) ? 1 : 0;
    },
    evaluate: async ({ fn }) => {
      const source = fn.toString();
      if (source.includes('isUnusedCustomOption')) {
        return state.questions.filter(({ value }) => !value).length;
      }
      if (source.includes('unansweredCount')) {
        return { totalCount: 0, unansweredCount: 0 };
      }
      if (source.includes('data-qa-question][data-qa-answer]')) {
        return [];
      }
      if (source.includes('addEventListener')) {
        return null;
      }
      return source.includes('taskIndex') ? items() : null;
    },
    safeEvaluate: async ({ operationName, defaultValue }) => {
      switch (operationName) {
      case 'response submitted check':
        return { value: state.submitted };
      case 'response form text for the vacancy filters':
        return { value: { vacancy: 'Go Developer\nAcme', page: 'Отклик на вакансию Go Developer' } };
      case 'direct application check':
        return { value: { found: true, reason: 'magritte-alert', url: 'https://career.example.com/jobs/7' } };
      default:
        return { value: defaultValue };
      }
    },
    fillTextArea: async ({ selector, text }) => {
      const index = Number(selector.match(/task_(\d+)/)?.[1] ?? -1);
      if (index >= 0) {
        state.questions[index].value = text;
      } else state.letter = text;
      return { filled: true };
    },
    clickButton: async (options) => {
      state.clicks.push(options);
      if (options.selector === SELECTORS.submitButtonLetter && confirms) {
        state.submitted = true;
      }
    },
    goto: async ({ url }) => state.gotos.push(url),
    wait: async (options) => { state.waits.push(options); return onWait(state, options); },
  };
}

const sends = (form) => form.state.clicks.filter(({ selector }) => selector === SELECTORS.submitButtonLetter);

describe('full response form', () => {
  test('an interrupted error check returns to the orchestrator for retry without touching the form', async () => {
    const form = fakeForm();
    const evaluate = form.safeEvaluate;
    form.safeEvaluate = (options) => options.operationName === 'daily application limit check'
      ? Promise.resolve({ success: false, navigationError: true, value: null }) : evaluate(options);
    const result = await handleVacancyResponsePage({ commander: form, MESSAGE: 'Letter',
      readQADatabase: async () => new Map(), addOrUpdateQA: async () => {}, returnUrl: SEARCH_URL });
    assert.deepEqual(result, { status: 'interrupted' });
    assert.deepEqual(form.state.clicks, []);
    assert.deepEqual(form.state.gotos, []);
  });

  test('Russian questions naming dollars use an English CV and letter while answers stay Russian', async () => {
    disableConfirmations();
    const question = 'Ожидаемый уровень компенсации в $ или русских рублях, на руки';
    const form = fakeForm({ questions: [question, 'Сколько лет у вас опыта?', 'Какой ваш опыт с новым продуктом?'] });
    const answers = new Map([[question, 'От $6 000 в месяц на руки.'], ['Сколько лет у вас опыта?', 'Более 12 лет.']]);
    let selected;
    const result = await handleVacancyResponsePage({ commander: form, MESSAGE: { ru: 'Здравствуйте', en: 'Hello, my English letter.' },
      readQADatabase: async () => new Map(answers), addOrUpdateQA: async () => {},
      selectApplicationResume: async (options) => { selected = { ready: true, language: applicationResumeLanguage(options) }; return selected; },
      returnUrl: SEARCH_URL });
    assert.equal(result.status, 'awaiting_user');
    assert.equal(selected.language, 'en');
    assert.equal(form.state.letter, 'Hello, my English letter.');
    assert.equal(form.state.questions[0].value, answers.get(question));
    assert.equal(form.state.questions[1].value, 'Более 12 лет.');
    assert.equal(form.state.questions[2].value, '');
    assert.equal(sends(form).length, 0);
  });

  test('a restarted form restores vacancy context for currency, CV and letter without the filters RAM maps', async () => {
    disableConfirmations();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'restarted-form-context-'));
    try {
      await createVacancyCache(directory).record({ id: '139100001', title: 'Backend Engineer', salary: '6000 USD',
        description: 'We build a distributed platform with Go and PostgreSQL.', skills: ['Go', 'PostgreSQL'] });
      const restarted = createVacancyInsights({ directory, log: () => {} });
      const form = fakeForm({ questions: ['Ваши зарплатные ожидания?'] });
      const db = withContacts({ readQADatabase: async () => new Map([['Ваши зарплатные ожидания?', 'От {{salary_net}} в месяц на руки.']]) },
        { salary_net: '450 000 ₽', salary_net_usd: '$6 000' });
      let selected;
      await handleVacancyResponsePage({ commander: form, MESSAGE: { ru: 'Здравствуйте', en: 'Hello, my English letter.' },
        readQADatabase: db.readQADatabase, addOrUpdateQA: async () => {}, readVacancy: restarted.read,
        selectApplicationResume: async (options) => { selected = { ready: true, language: applicationResumeLanguage(options) }; return selected; },
        returnUrl: SEARCH_URL, autoSendExact: true });
      assert.equal(selected.language, 'en');
      assert.equal(form.state.letter, 'Hello, my English letter.');
      assert.equal(form.state.questions[0].value, 'От $6 000 в месяц на руки.');
      assert.equal(sends(form).length, 1);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  test('a ready cover-letter form sends promptly and keeps confirmation checks', async () => {
    disableConfirmations();
    const form = fakeForm();
    await handleVacancyResponsePage({ commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(),
      addOrUpdateQA: async () => {}, returnUrl: SEARCH_URL });
    assert.equal(sends(form).length, 1);
    assert.equal(sends(form)[0].scrollIntoView, true);
    assert.equal(sends(form)[0].waitForNavigation, false);
    assert.equal(form.state.waits.reduce((ms, wait) => ms + wait.ms, 0) <= 1000, true);
    assert.deepEqual(form.state.gotos, [SEARCH_URL]);
  });

  test('a temporarily disabled Send is checked again instead of an arbitrary review pause', async () => {
    disableConfirmations();
    const form = fakeForm();
    let checks = 0;
    form.isEnabled = async () => ++checks > 2;
    await handleVacancyResponsePage({ commander: form, MESSAGE: '', readQADatabase: async () => new Map(),
      addOrUpdateQA: async () => {}, returnUrl: SEARCH_URL });
    assert.equal(sends(form).length, 1);
    assert.equal(form.state.waits.filter(({ reason }) => reason.includes('button to become enabled')).length, 2);
  });

  test('conditional questions appearing during button validation prevent submission', async () => {
    disableConfirmations();
    const form = fakeForm({ onWait: (state, { reason }) => {
      if (reason.includes('button to become enabled')) state.questions.push({ question: 'New required question?', value: '' });
    } });
    let checks = 0;
    form.isEnabled = async () => ++checks > 1;
    const result = await handleVacancyResponsePage({ commander: form, MESSAGE: '', readQADatabase: async () => new Map(),
      addOrUpdateQA: async () => {}, returnUrl: SEARCH_URL });
    assert.equal(result.status, 'awaiting_user');
    assert.equal(sends(form).length, 0);
    assert.deepEqual(form.state.gotos, []);
  });

  test('existing text is preserved without a pause for a skipped fill', async () => {
    const form = fakeForm({ questions: ['Опыт Linux?'] });
    form.state.questions[0].value = 'My own answer';
    form.fillTextArea = async () => ({ skipped: true });
    await setupQAHandling({ commander: form, readQADatabase: async () => new Map([['Опыт Linux?', 'Ubuntu.']]), addOrUpdateQA: async () => {} });
    assert.equal(form.state.questions[0].value, 'My own answer');
    assert.deepEqual(form.state.waits, []);
  });

  test('manual review stays passive until the user submits, and stops on navigation or an interrupted wait', async () => {
    for (const outcome of ['submitted', 'left', 'interrupted', 'closed']) {
      const form = fakeForm();
      let polls = 0;
      let closed = false;
      let url = RESPONSE_URL;
      form.getUrl = () => url;
      form.wait = async () => {
        if (++polls < 3) return;
        if (outcome === 'submitted') form.state.submitted = true;
        if (outcome === 'left') url = SEARCH_URL;
        if (outcome === 'closed') closed = true;
        if (outcome === 'interrupted') return { aborted: true };
      };
      assert.equal(await waitForManualResponse({ commander: form, isPageClosed: () => closed }), outcome);
      assert.equal(polls, 3);
      assert.deepEqual(form.state.clicks, []);
      assert.deepEqual(form.state.gotos, []);
    }
  });

  test('leaving during a manual-review check never counts another page as a submission', async () => {
    for (const operation of ['daily application limit check', 'response submitted check']) {
      const form = fakeForm();
      let url = RESPONSE_URL;
      form.getUrl = () => url;
      const evaluate = form.safeEvaluate;
      form.safeEvaluate = async (options) => {
        if (options.operationName !== operation) return evaluate(options);
        url = SEARCH_URL;
        return { value: operation === 'response submitted check' ? true : null };
      };
      assert.equal(await waitForManualResponse({ commander: form }), 'left');
      assert.deepEqual(form.state.clicks, []);
    }
  });

  test('review-only drafts are never auto-submitted, even after learning and with auto-submit enabled', async () => {
    disableConfirmations();
    const qa = new Map([['Опыт Linux?', 'Работал с Ubuntu и Docker.']]);
    for (const withoutTest of [false, true]) {
      const form = fakeForm({ questions: [...qa.keys()], reviewOnly: true, withoutTest });
      form.state.questions[0].value = qa.get('Опыт Linux?');
      await handleVacancyResponsePage({ commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(qa),
        addOrUpdateQA: async () => {}, returnUrl: SEARCH_URL, autoSendExact: true, autoSubmitEnabled: true });
      assert.equal(form.state.questions[0].value, qa.get('Опыт Linux?'));
      assert.equal(form.state.clicks.length, 0);
      assert.deepEqual(form.state.gotos, []);
    }
  });

  test('reopening a cooling form cannot send it before its five-hour deadline', async () => {
    disableConfirmations();
    const form = fakeForm();
    submissionRetries.defer('139100001');
    try {
      await handleVacancyResponsePage({ commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(),
        addOrUpdateQA: async () => {}, returnUrl: SEARCH_URL });
      assert.equal(sends(form).length, 0);
      assert.deepEqual(form.state.gotos, [SEARCH_URL]);
    } finally { submissionRetries.forget('139100001'); }
  });

  test('a delayed retry submits the saved answers through the regular send button', async () => {
    disableConfirmations();
    const qa = new Map([['Какие AI-инструменты Вы используете?', 'Hive Mind, Claude, Codex.']]);
    const form = fakeForm({ questions: [...qa.keys()], withoutTest: true });
    await handleVacancyResponsePage({ commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(qa),
      addOrUpdateQA: async () => {}, returnUrl: SEARCH_URL, retrySubmission: true, autoSendExact: true });
    assert.equal(sends(form).length, 1);
    assert.equal(sends(form)[0].autoSend, true);
    assert.equal(form.state.questions[0].value, 'Hive Mind, Claude, Codex.');
    assert.equal(form.state.clicks.some(({ selector }) => selector === SELECTORS.submitButtonWithoutQuestions), false);
  });

  test('an application hh.ru does not confirm goes to the stop-or-wait of the popup, never back to the list', async () => {
    disableConfirmations();
    const notConfirmed = [];
    const sent = [];
    const form = fakeForm({ confirms: false });
    await handleVacancyResponsePage({
      commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(), addOrUpdateQA: async () => {},
      returnUrl: SEARCH_URL, onApplicationSent: async (id) => sent.push(id),
      onApplicationNotConfirmed: async (id) => notConfirmed.push(id),
    });
    assert.equal(sends(form).length, 1);
    assert.deepEqual(notConfirmed, ['139100001']);
    assert.deepEqual(sent, []);
    assert.deepEqual(form.state.gotos, []);
  });

  test('a confirmed application is counted and the run returns to the list', async () => {
    disableConfirmations();
    const sent = [];
    const form = fakeForm();
    await handleVacancyResponsePage({
      commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(), addOrUpdateQA: async () => {},
      returnUrl: SEARCH_URL, onApplicationSent: async (id) => sent.push(id),
      onApplicationNotConfirmed: async () => assert.fail('confirmed'),
    });
    assert.deepEqual(sent, ['139100001']);
    assert.deepEqual(form.state.gotos, [SEARCH_URL]);
  });

  test('an autofilled answer of a reworded question is not sent unattended, though the auto-save wrote it', async () => {
    disableConfirmations();
    const qa = new Map([['Сколько лет опыта коммерческой разработки на Go?', '7 лет']]);
    // The page trigger's periodic auto-save writes every answer on the page under its own wording
    const form = fakeForm({
      questions: ['Сколько лет опыта коммерческой разработки на Go'],
      onWait: (state) => state.questions.forEach(({ question, value }) => value && qa.set(question, value)),
    });
    await handleVacancyResponsePage({
      commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(qa), addOrUpdateQA: async () => {},
      returnUrl: SEARCH_URL, autoSendExact: true,
    });
    assert.equal(form.state.questions[0].value, '7 лет');
    assert.equal(qa.get('Сколько лет опыта коммерческой разработки на Go'), '7 лет');
    assert.equal(sends(form).length, 0);
  });

  test('saved answers of the very same questions are still sent unattended', async () => {
    disableConfirmations();
    const qa = new Map([['Сколько лет опыта коммерческой разработки на Go?', '7 лет']]);
    const form = fakeForm({ questions: ['Сколько лет опыта коммерческой разработки на Go?'] });
    await handleVacancyResponsePage({
      commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(qa), addOrUpdateQA: async () => {},
      returnUrl: SEARCH_URL, autoSendExact: true,
    });
    assert.equal(sends(form).length, 1);
    assert.equal(sends(form)[0].autoSend, true);
  });

  test('a direct application is recorded with the employer\'s link', async () => {
    disableConfirmations();
    const { skippedVacancies } = await stores();
    const form = fakeForm({ direct: true });
    await handleVacancyResponsePage({
      commander: form, MESSAGE: 'Здравствуйте', readQADatabase: async () => new Map(), addOrUpdateQA: async () => {},
      returnUrl: SEARCH_URL, skippedVacancies,
    });
    const entry = (await skippedVacancies.read()).get('139100001');
    assert.equal(entry.reason, 'external_site');
    assert.equal(entry.url, 'https://career.example.com/jobs/7');
    assert.equal(entry.title, 'Go Developer Acme');
    assert.equal(sends(form).length, 0);
  });
});
