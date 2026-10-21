/**
 * Vacancy response page handler
 * Handles the vacancy_response page with QA auto-filling
 */

import { isNavigationError, isTimeoutError } from 'browser-commander';
import {
  extractPageQuestions,
  extractQAPairs,
  countUnansweredQuestions,
  fillTextareaQuestion,
  fillRadioQuestion,
  fillCheckboxQuestion,
  listOpenQuestions,
  allAnswersExact,
  setupAutoSaveListeners,
  collectMarkedQAPairs,
  answerFits,
  answerText,
} from './qa.mjs';
import { findBestMatch } from './qa-database.mjs';
import { answersInContexts, loadAnswerContexts, plainSalaryAnswer, sameButSums, showsContext } from './answer-contexts.mjs';
import { describeFilterMatch } from './vacancy-filters.mjs';
import { noteSkip } from './skipped-vacancies.mjs';
import { resumeVisibility } from './resume-visibility.mjs';
import { DEFER_CHOICE, formatQuestions } from './deferred-questions.mjs';
import { log } from './logging.mjs';
import { COVER_LETTER_TEXTS } from './hh-words.mjs';
import { coverLetterFor } from './cover-letter.mjs';
import { askUser, decideSend, isInteractive, PromptWithdrawnError } from './confirmations.mjs';
import { SELECTORS, URL_PATTERNS, extractVacancyIdFromResponseUrl } from './hh-selectors.mjs';
import { checkAndCloseDirectApplicationModal } from './helpers/modal-helpers.mjs';
import {
  dismissOverlays,
  findFirstSelector,
  findCoverLetterToggle,
  isButtonEnabled,
  isResponseSubmitted,
  typeLongText,
} from './helpers/page-helpers.mjs';

const COVER_LETTER_SELECTORS = [SELECTORS.coverLetterTextareaPopup, SELECTORS.coverLetterTextareaForm];
const COVER_LETTER_DATA_QA = ['vacancy-response-popup-form-letter-input', 'vacancy-response-form-letter-input'];
const DEFAULT_RETURN_URL = 'https://hh.ru/search/vacancy?from=resumelist';
const SUBMIT_CONFIRMATION_TIMEOUT_MS = 15000;

const fillers = {
  textarea: fillTextareaQuestion,
  radio: fillRadioQuestion,
  checkbox: fillCheckboxQuestion,
};

// Answers already written in this run, so periodic saves only write what changed
const savedAnswers = new Map();

/**
 * Save new or changed Q&A pairs to the database and log them
 * @returns {Promise<number>} Number of saved pairs
 */
export async function savePairs(pairs, addOrUpdateQA) {
  let saved = 0;
  // One answer per question: two (e.g. a choice and the text of its "Свой вариант" box) would
  // overwrite each other on every save
  const answers = new Map(pairs.map(({ question, answer }) => [question, answer]));
  for (const [question, answer] of answers) {
    const key = JSON.stringify(answer);
    if (savedAnswers.get(question) === key) {
      continue;
    }
    await addOrUpdateQA(question, answer);
    savedAnswers.set(question, key);
    console.log('Saved Q&A:', question);
    saved++;
  }
  return saved;
}

/**
 * The saved answers, and each in the contexts of the form's question (answer-contexts.mjs: the
 * question itself, else the vacancy's card, description and the form's questions), e.g. a salary
 * in dollars for a vacancy paid in dollars
 * @returns {Promise<{qaMap: Map, pageQuestions: Array, answerFor: (formQuestion: string, savedQuestion: string) => Promise<*>}>}
 */
async function answersInContext({ commander, readQADatabase, context = '' }) {
  const qaMap = await readQADatabase();
  const pageQuestions = await extractPageQuestions({ evaluate: commander.evaluate });
  const known = [...[context].flat(), ...pageQuestions.map(({ question }) => question)];
  const contexts = await loadAnswerContexts();
  const inContexts = answersInContexts(readQADatabase, contexts);
  const answerFor = async (formQuestion, savedQuestion) =>
    (await inContexts(formQuestion, known)).get(savedQuestion) ?? qaMap.get(savedQuestion);
  // The salary questions not saved word for word, answered by pattern (salary-questions.mjs)
  const byPattern = new Map();
  for (const { question } of pageQuestions) {
    if (!qaMap.has(question) && !byPattern.has(question)) {
      const answer = (await inContexts(question, known)).get(question);
      if (answer !== undefined) {
        byPattern.set(question, answer);
      }
    }
  }
  // The currency is told (by the question, the vacancy's pay or description), not taken by default
  const currencyShown = (question) => showsContext(contexts, [question, ...known]);
  return { qaMap, pageQuestions, answerFor, byPattern, currencyShown };
}

/**
 * The saved answers, the form's own questions with their salaries in the currency of this form:
 * what its answers are compared with to count as exact. A salary question answered by pattern
 * counts as saved when the currency is told
 * @returns {Promise<Map>}
 */
export async function savedAnswersInContext({ commander, readQADatabase, context = '' }) {
  const { qaMap, pageQuestions, answerFor, byPattern, currencyShown } = await answersInContext({ commander, readQADatabase, context });
  for (const { question } of pageQuestions) {
    if (qaMap.has(question)) {
      qaMap.set(question, await answerFor(question, question));
    } else if (byPattern.has(question) && currencyShown(question)) {
      qaMap.set(question, byPattern.get(question));
    }
  }
  return qaMap;
}

/**
 * Setup Q&A auto-fill and auto-save for all textareas and radio buttons on the page
 * @param {Object} options
 * @param {string|string[]} [options.context] - The vacancy's card and description, most telling first, for the answers' contexts (answer-contexts.mjs)
 */
export async function setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose, context = '' }) {
  try {
    const { qaMap, pageQuestions, answerFor, byPattern } = await answersInContext({ commander, readQADatabase, context });
    const questionToAnswer = new Map();
    const seenSelectors = new Set();

    for (const item of pageQuestions) {
      // Deduplicate questions by selector to prevent filling same textarea twice (issue #122)
      if (seenSelectors.has(item.selector)) {
        console.log(`[QA] Skipping duplicate question with same selector: ${item.selector}`);
        continue;
      }
      seenSelectors.add(item.selector);

      if (byPattern.has(item.question)) {
        const answer = byPattern.get(item.question);
        questionToAnswer.set(item.question, { ...item, answer, matchScore: 1 });
        console.log(`[QA] Salary question answered by pattern: "${item.question}"`);
        console.log(`[QA] Answer: "${answer}"`);
        continue;
      }
      const match = findBestMatch(item.question, qaMap);
      if (match && item.type === 'textarea' && !answerFits(item.question, match.answer)) {
        console.log(`[QA] "${item.question}": the saved answer of "${match.question}" (${match.answer}) does not answer it, left empty`);
      } else if (match) {
        const answer = await answerFor(item.question, match.question);
        questionToAnswer.set(item.question, { ...item, answer, matchScore: match.score });
        console.log(`[QA] Fuzzy match for "${item.question}" (score: ${match.score.toFixed(3)})`);
        console.log(`[QA] Matched to: "${match.question}"`);
        console.log(`[QA] Answer: "${answer}"`);
      }
    }

    // Each fill operation is sequential to prevent concurrent typing
    for (const [question, data] of questionToAnswer) {
      try {
        // hh.ru keeps the form's text: an answer typed before with a sum in another currency is typed
        // again, and so is a plain salary answer typed before in another wording
        const typed = data.type === 'textarea' ? data.currentValue ?? '' : '';
        const retype = sameButSums(typed, answerText(data.answer)) || (plainSalaryAnswer(typed) && plainSalaryAnswer(answerText(data.answer)));
        if (typed && typed !== answerText(data.answer).trim() && retype) {
          await commander.evaluate({
            fn: (selector) => {
              const textarea = document.querySelector(selector);
              Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '');
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
            },
            args: [data.selector],
          });
          console.log(`[QA] "${question}": «${typed}» was typed before in another context, typed again`);
        }
        await fillers[data.type]?.({ commander, questionData: data, verbose });
        if (data.type === 'textarea') {
          await commander.wait({ ms: 2000, reason: 'stability delay between textarea fills' });
        }
      } catch (error) {
        console.error(`[QA] Error autofilling for "${question}":`, error.message);
      }
    }

    await setupAutoSaveListeners({ evaluate: commander.evaluate, questionToAnswer });
    return saveMarkedQAPairs({ commander, addOrUpdateQA });
  } catch (error) {
    console.error('Error setting up Q&A handling:', error.message);
    return 0;
  }
}

/**
 * Save the answers the user typed or changed in text questions (marked when the field loses
 * focus, see setupAutoSaveListeners), not the autofilled ones
 * @returns {Promise<number>} Number of saved pairs
 */
export async function saveMarkedQAPairs({ commander, addOrUpdateQA }) {
  return savePairs(await collectMarkedQAPairs({ evaluate: commander.evaluate }), addOrUpdateQA);
}

/**
 * Save Q&A pairs from textareas and radio buttons after user interaction
 */
export async function saveQAPairs({ commander, addOrUpdateQA }) {
  const pairs = await readQAPairs({ commander });
  return pairs ? savePairs(pairs, addOrUpdateQA) : 0;
}

/**
 * The form's questions and answers as they are now, or null while the page navigates away
 * @returns {Promise<Array<{question: string, answer: string|string[]}>|null>}
 */
export async function readQAPairs({ commander }) {
  try {
    return await extractQAPairs({ evaluate: commander.evaluate });
  } catch (error) {
    // The page navigated away while reading it; the save before navigation covers it
    if (isNavigationError(error)) {
      log.debug(() => `Q&A save skipped during navigation: ${error.message}`);
    } else {
      console.error('Error reading Q&A pairs:', error.message);
    }
    return null;
  }
}

/**
 * Find the cover letter textarea, expanding its section if needed
 * @returns {Promise<string|null>} Visible textarea selector or null
 */
async function prepareCoverLetterTextarea({ commander }) {
  const visibleSelector = await findFirstSelector(commander, COVER_LETTER_SELECTORS, { visible: true });

  if (visibleSelector) {
    console.log('Cover letter section already expanded, textarea visible');
  } else {
    const toggleSelector = await findCoverLetterToggle(commander, {
      texts: ['Добавить', 'Add', ...COVER_LETTER_TEXTS],
      elementTypes: ['a', 'button', 'span', 'div'],
    });
    if (toggleSelector) {
      console.log('Cover letter section is collapsed, clicking toggle to expand...');
      await commander.clickButton({ selector: toggleSelector, scrollIntoView: true });
      await commander.wait({ ms: 1700, reason: 'expand animation to complete' });
      console.log('Cover letter section expanded');
    } else {
      console.log('Toggle button not found, cover letter section may already be expanded');
    }
  }

  for (const selector of [visibleSelector, ...COVER_LETTER_SELECTORS, 'textarea'].filter(Boolean)) {
    try {
      await commander.waitForSelector({ selector, visible: true, timeout: 2000 });
      return selector;
    } catch {
      log.debug(() => `Selector timed out after 2000ms: ${selector}`);
    }
  }

  console.log('Cover letter textarea not found on vacancy_response page');
  return null;
}

/**
 * "1 choice, 3 text" style summary of the test questions on the form
 */
function describeQuestionCounts(choiceCount, textareaCount) {
  return `${choiceCount} choice, ${Math.max(textareaCount - 1, 0)} text field(s)`;
}

/**
 * Count test textareas (excluding cover letter) that are still empty
 * @returns {Promise<number>}
 */
function countEmptyTestTextareas({ commander }) {
  return commander.evaluate({
    fn: (coverLetterDataQa) => {
      // "<name>_text" next to radio/checkbox inputs "<name>" is the free-text box of their
      // "Свой вариант" option; it needs text only while that option is chosen
      const isUnusedCustomOption = (textarea) => {
        const group = textarea.name?.endsWith('_text') &&
          document.querySelectorAll(`input[name="${textarea.name.slice(0, -'_text'.length)}"]`);
        return group?.length > 0 && ![...group].some((input) => input.checked && input.value === 'open');
      };
      return Array.from(document.querySelectorAll('textarea'))
        .filter((textarea) => !coverLetterDataQa.includes(textarea.getAttribute('data-qa')) &&
          !textarea.value.trim() && !isUnusedCustomOption(textarea))
        .length;
    },
    args: [COVER_LETTER_DATA_QA],
  });
}

/**
 * What the vacancy filters check on the response form: the vacancy name, the questions and the
 * text of the form (without the site header and footer)
 * @returns {Promise<{vacancy: string, questions: string[], page: string}>}
 */
async function readFormForFilters(commander) {
  const { value } = await commander.safeEvaluate({
    fn: (credentialsSelector) => ({
      vacancy: document.querySelector(credentialsSelector)?.innerText ?? '',
      page: (document.querySelector('main') ?? document.body).innerText,
    }),
    args: [SELECTORS.vacancyCredentials],
    defaultValue: { vacancy: '', page: '' },
    operationName: 'response form text for the vacancy filters',
    silent: true,
  });
  const questions = (await extractPageQuestions({ evaluate: commander.evaluate })).map(({ question }) => question);
  return { ...value, questions };
}

/**
 * Whether a failed wait only means the form is gone: the page is no longer the form, and the wait
 * timed out (browser-commander up to 0.27) or was interrupted by the navigation (0.28)
 * @param {Error} error
 * @param {string} url - The page URL now
 * @returns {boolean}
 */
export function isFormLeftDuringWait(error, url) {
  return (isTimeoutError(error) || error?.name === 'NavigationInterruptedError') &&
    !URL_PATTERNS.vacancyResponse.test(url);
}

/**
 * Handle the vacancy_response page
 *
 * Note: This function is called exclusively from the pageTrigger system
 * in page-triggers.mjs, which ensures it's only called once per page with
 * proper lifecycle management.
 *
 * Every skip is logged and kept in data/skipped-vacancies.lino (or deferred-questions.lino /
 * filtered-vacancies.lino). A form with questions is sent by the rules of decideSend, the same as
 * the popup; an application hh.ru does not confirm goes to onApplicationNotConfirmed, which stops
 * the run or waits for the user (the same as the popup, see orchestrator.mjs)
 */
export async function handleVacancyResponsePage({
  commander,
  MESSAGE,
  readQADatabase,
  addOrUpdateQA,
  autoSubmitEnabled = false,
  ignoreVacanciesWithQuestionnaire,
  returnUrl = DEFAULT_RETURN_URL,
  onApplicationSent = async () => {},
  onApplicationNotConfirmed = async () => {},
  onMissingAnswers = 'wait',
  deferredQuestions = null,
  autoSendExact = true,
  vacancyFilters = null,
  skippedVacancies = null,
  verbose,
}) {
  // hh.ru changes the URL after a response, so the vacancy ID is taken first
  const vacancyId = extractVacancyIdFromResponseUrl(commander.getUrl());
  let title = '';
  const returnToList = async () => {
    console.log(`Returning to: ${returnUrl}`);
    await commander.goto({ url: returnUrl, waitForStableUrlBefore: false });
  };
  // Never silently: logged and kept in data/skipped-vacancies.lino
  const skipVacancy = (reason, { url } = {}) => noteSkip(skippedVacancies, vacancyId, { reason, title, url });
  const skipQuestionnaireVacancy = async () => {
    console.log('💡 --ignore-vacancies-with-questionnaire is enabled, skipping this vacancy');
    await skipVacancy('questionnaire_ignored');
    await returnToList();
  };
  // Answered later: the vacancy is kept under its questions in deferred-questions.lino
  const deferVacancy = async (questions) => {
    await deferredQuestions?.defer(questions, vacancyId);
    console.log(`⏭️  Vacancy ${vacancyId} skipped for now, kept in deferred-questions.lino under:\n${formatQuestions(questions)}`);
    await skipVacancy(deferredQuestions ? 'questions_deferred' : 'unanswered_questions');
    await returnToList();
  };

  try {
    console.log('Detected vacancy_response page, handling application form...');
    await commander.waitForSelector({ selector: 'body' });
    await dismissOverlays(commander);

    // hh.ru stays on this page after a response and offers to respond again
    if (await isResponseSubmitted(commander)) {
      console.log('✅ Already applied to this vacancy, returning to the vacancy list');
      await commander.goto({ url: returnUrl, waitForStableUrlBefore: false });
      return;
    }

    const form = await readFormForFilters(commander);
    title = form.vacancy;
    // What the salary answers' currency is told by: the card, the description and the form's text
    const salaryContext = [vacancyFilters?.card?.(vacancyId) ?? '', vacancyFilters?.description?.(vacancyId) ?? '', form.page];

    // Direct application vacancies are applied on the employer's site - skip them
    const direct = await checkAndCloseDirectApplicationModal({ commander });
    if (direct.isDirectApplication) {
      await skipVacancy('external_site', { url: direct.url ?? `https://hh.ru/vacancy/${vacancyId}` });
      return;
    }

    // With the description when it was read on the vacancy list (vacancies.mjs)
    const filterMatch = await vacancyFilters?.match({ ...form, description: vacancyFilters.description?.(vacancyId) ?? '' });
    if (filterMatch) {
      console.log(`🚫 Vacancy ${vacancyId} filtered out by vacancy-filters.lino (${describeFilterMatch(filterMatch)})`);
      await vacancyFilters.remember(vacancyId, filterMatch, { title });
      await returnToList();
      return;
    }

    if (await resumeVisibility(commander, { vacancyId }) === 'skip') {
      await skipVacancy('resume_not_visible');
      await returnToList();
      return;
    }

    const submitWithoutTestSelector = await findFirstSelector(commander, [SELECTORS.submitButtonWithoutQuestions]);
    if (submitWithoutTestSelector) {
      console.log('Found special submit button "Откликнуться без теста"');
    }

    if (ignoreVacanciesWithQuestionnaire && !submitWithoutTestSelector) {
      const questionnaireFields = await extractPageQuestions({ evaluate: commander.evaluate });
      if (questionnaireFields.length > 0) {
        console.log(`⚠️  Detected ${questionnaireFields.length} questionnaire field(s) on vacancy_response page`);
        return skipQuestionnaireVacancy();
      }
    }

    // The questions are handled even when there is no cover letter field
    const textareaSelector = await prepareCoverLetterTextarea({ commander });

    // The English letter when the vacancy's questions are in English
    const letter = coverLetterFor(MESSAGE, (await extractPageQuestions({ evaluate: commander.evaluate })).map(({ question }) => question));
    if (letter && textareaSelector) {
      const { filled } = await typeLongText(commander, { selector: textareaSelector, text: letter, scrollIntoView: true });
      console.log(filled
        ? `Prefilled cover letter message into: ${textareaSelector}`
        : 'Cover letter already contains text, skipping prefill');
    }

    if (submitWithoutTestSelector) {
      console.log('Using special "Откликнуться без теста" flow');
      // Questions outside the test (e.g. the salary) still take their saved answers
      await setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose, context: salaryContext });
      await commander.clickButton({ selector: submitWithoutTestSelector, scrollIntoView: true, smoothScroll: true });
      console.log('Clicked "Откликнуться без теста" button');
      await commander.wait({ ms: 2000, reason: 'submit without test to complete' });
      return;
    }

    const textareaCount = await commander.count({ selector: 'textarea' });
    console.log(`Found ${textareaCount} textarea(s) on the page`);

    // The saved answers as they were before this form: the periodic auto-save (page-triggers.mjs)
    // writes the autofilled answers of similar questions under this form's wording, which must
    // not make them count as exact
    const savedBefore = await savedAnswersInContext({ commander, readQADatabase, context: salaryContext });
    // Auto-fill answers from database, then give user time to review them
    await setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose, context: salaryContext });
    // Sent without asking only when autofill alone answered everything with saved answers of the
    // very same questions; checked again before sending, in case an answer was changed meanwhile
    const answersExact = async () => allAnswersExact(
      await extractPageQuestions({ evaluate: commander.evaluate }),
      savedBefore,
    );
    let exactAfterAutofill = autoSendExact && (await listOpenQuestions({ evaluate: commander.evaluate })).length === 0 &&
      await answersExact();
    if (deferredQuestions) {
      const questionsToSkip = await deferredQuestions.questionsToSkip({
        questions: (await extractPageQuestions({ evaluate: commander.evaluate })).map(({ question }) => question),
        openQuestions: await listOpenQuestions({ evaluate: commander.evaluate }),
      });
      if (questionsToSkip.length > 0) {
        return deferVacancy(questionsToSkip);
      }
    }
    await commander.wait({ ms: 30000, reason: 'form validation and user review after auto-fill' });

    if (!URL_PATTERNS.vacancyResponse.test(commander.getUrl())) {
      console.log('Page navigated away from vacancy_response, skipping auto-submit');
      return;
    }

    const { totalCount, unansweredCount } = await countUnansweredQuestions({ evaluate: commander.evaluate });
    const hasTestQuestions = totalCount > 0 || textareaCount > 1;
    log.debug(() => `hasTestQuestions=${hasTestQuestions} (radioCheckbox=${totalCount}, textareas=${textareaCount})`);

    if (ignoreVacanciesWithQuestionnaire && hasTestQuestions) {
      console.log('⚠️  Detected questionnaire fields on vacancy_response page');
      return skipQuestionnaireVacancy();
    }

    // By default a vacancy is not skipped for missing answers: the user decides what to write
    const isFormComplete = async () =>
      (await countUnansweredQuestions({ evaluate: commander.evaluate })).unansweredCount === 0 &&
      await countEmptyTestTextareas({ commander }) === 0;

    if (unansweredCount > 0 || !await isFormComplete()) {
      exactAfterAutofill = false;
      const open = await listOpenQuestions({ evaluate: commander.evaluate });
      console.log(`Open questions (no saved answer, or it fits none of the options):\n${formatQuestions(open)}`);
      if (onMissingAnswers === 'skip') {
        console.log('Skipping this vacancy (--on-missing-answers skip)');
        return deferVacancy(open);
      }
      if (!isInteractive()) {
        console.log('Please answer them and submit the form manually when ready');
        return;
      }
      do {
        const choice = await askUser('Answer the open question(s) in the browser (the answers are saved to qa.lino)', {
          skip: deferredQuestions ? DEFER_CHOICE : undefined,
        });
        if (choice === 'withdrawn') {
          return;
        }
        if (choice === 'skip') {
          const stillOpen = await listOpenQuestions({ evaluate: commander.evaluate });
          return deferVacancy(stillOpen.length > 0 ? stillOpen : open);
        }
      } while (!await isFormComplete());
    }

    const autoSend = hasTestQuestions && exactAfterAutofill && await answersExact();
    if (!hasTestQuestions) {
      console.log('No test questions found, only cover letter - will auto-submit');
    } else if (autoSend) {
      console.log(`Every answer is the saved answer of the very same question (${describeQuestionCounts(totalCount, textareaCount)}) - sending without asking`);
    } else {
      console.log(`All test questions answered (${describeQuestionCounts(totalCount, textareaCount)}), not all with the saved answer of the very same question`);
    }
    const decision = await decideSend({
      hasQuestions: hasTestQuestions,
      autoSend,
      autoSubmit: autoSubmitEnabled,
      skip: 'skip this vacancy (kept in skipped-vacancies.lino)',
    });
    if (decision === 'wait') {
      console.log('Please review the answers and submit the form manually when ready');
      return;
    }
    if (decision === 'skip') {
      await skipVacancy('skipped_by_user');
      await returnToList();
      return;
    }
    if (decision === 'withdrawn') {
      return;
    }

    const submitSelector = await findFirstSelector(commander, [
      SELECTORS.submitButtonPopup,  // Modal form
      SELECTORS.submitButtonLetter, // Full-page form
      'button[type="submit"]',      // Generic fallback
    ]);
    if (!submitSelector) {
      console.log('Submit button not found (tried multiple selectors)');
      return;
    }

    if (!await isButtonEnabled(commander, submitSelector)) {
      console.log('Submit button is disabled, manual action required');
      console.log('The form may require additional validation. Please check manually.');
      return;
    }

    await commander.clickButton({ selector: submitSelector, scrollIntoView: true, smoothScroll: true, autoSend });
    console.log('Clicked submit button');
    const backOnList = () => URL_PATTERNS.searchVacancy.test(commander.getUrl());
    for (let waited = 0; waited < SUBMIT_CONFIRMATION_TIMEOUT_MS && !backOnList() && !await isResponseSubmitted(commander); waited += 1000) {
      await commander.wait({ ms: 1000, reason: 'submission to complete' });
    }
    // Back on the vacancy list: the vacancy page watch saw it sent and counted it
    if (backOnList()) {
      return;
    }
    if (!await isResponseSubmitted(commander)) {
      console.log(`⚠️  hh.ru did not confirm the application to vacancy ${vacancyId}, manual check required`);
      // Never move on to the next vacancy: the run stops (unattended) or waits for the user
      await onApplicationNotConfirmed(vacancyId);
      return;
    }
    // False: the vacancy page watch already counted and logged it
    if (await onApplicationSent(vacancyId) !== false) {
      console.log(`✅ Application sent for vacancy ${vacancyId}`);
    }
    await commander.goto({ url: returnUrl, waitForStableUrlBefore: false });
  } catch (error) {
    if (error instanceof PromptWithdrawnError) {
      return;
    }
    // A wait for an element of the form fails once the form was sent or left in the
    // browser; the vacancy page watch counts a sent application. browser-commander 0.28
    // reports such a wait as NavigationInterruptedError, earlier versions as a timeout
    if (isFormLeftDuringWait(error, commander.getUrl())) {
      log.debug(() => `Form left during a wait (${error.message.split('\n')[0]}), now on ${commander.getUrl()}`);
      return;
    }
    if (isNavigationError(error)) {
      console.log('⚠️  Page navigation detected during form handling, continuing with next vacancy');
      return;
    }
    // After a sent application the page trigger and this handler both return to the list: the
    // second navigation aborts the first, which is no error (browser-commander 0.28 still
    // throws a replaced goto as net::ERR_ABORTED, not as a navigation error)
    if (/net::ERR_ABORTED/.test(error.message)) {
      log.debug(() => `Navigation replaced by another one: ${error.message.split('\n')[0]}`);
      return;
    }
    if (isTimeoutError(error)) {
      console.log(`⚠️  Timeout error while handling vacancy response page: ${error.message}`);
      await skipVacancy('timeout');
      return;
    }
    console.error('Unexpected error in handleVacancyResponsePage:', error.message);
    throw error;
  }
}
