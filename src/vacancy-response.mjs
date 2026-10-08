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
  setupAutoSaveListeners,
  collectMarkedQAPairs,
} from './qa.mjs';
import { findBestMatch } from './qa-database.mjs';
import { log } from './logging.mjs';
import { SELECTORS, URL_PATTERNS, extractVacancyIdFromResponseUrl } from './hh-selectors.mjs';
import { checkAndCloseDirectApplicationModal } from './helpers/modal-helpers.mjs';
import {
  findFirstSelector,
  findCoverLetterToggle,
  isButtonEnabled,
  rememberIgnoredVacancy,
} from './helpers/page-helpers.mjs';

const COVER_LETTER_SELECTORS = [SELECTORS.coverLetterTextareaPopup, SELECTORS.coverLetterTextareaForm];
const COVER_LETTER_DATA_QA = ['vacancy-response-popup-form-letter-input', 'vacancy-response-form-letter-input'];
const DEFAULT_RETURN_URL = 'https://hh.ru/search/vacancy?from=resumelist';

const fillers = {
  textarea: fillTextareaQuestion,
  radio: fillRadioQuestion,
  checkbox: fillCheckboxQuestion,
};

/**
 * Save Q&A pairs to the database and log them
 * @returns {Promise<number>} Number of saved pairs
 */
async function savePairs(pairs, addOrUpdateQA) {
  for (const { question, answer } of pairs) {
    await addOrUpdateQA(question, answer);
    console.log('Saved Q&A:', question);
  }
  return pairs.length;
}

/**
 * Setup Q&A auto-fill and auto-save for all textareas and radio buttons on the page
 */
export async function setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose }) {
  try {
    const qaMap = await readQADatabase();
    const pageQuestions = await extractPageQuestions({ evaluate: commander.evaluate });
    const questionToAnswer = new Map();
    const seenSelectors = new Set();

    for (const item of pageQuestions) {
      // Deduplicate questions by selector to prevent filling same textarea twice (issue #122)
      if (seenSelectors.has(item.selector)) {
        console.log(`[QA] Skipping duplicate question with same selector: ${item.selector}`);
        continue;
      }
      seenSelectors.add(item.selector);

      const match = findBestMatch(item.question, qaMap);
      if (match) {
        questionToAnswer.set(item.question, { ...item, answer: match.answer, matchScore: match.score });
        console.log(`[QA] Fuzzy match for "${item.question}" (score: ${match.score.toFixed(3)})`);
        console.log(`[QA] Matched to: "${match.question}"`);
        console.log(`[QA] Answer: "${match.answer}"`);
      }
    }

    // Each fill operation is sequential to prevent concurrent typing
    for (const [question, data] of questionToAnswer) {
      try {
        await fillers[data.type]?.({ commander, questionData: data, verbose });
        if (data.type === 'textarea') {
          await commander.wait({ ms: 2000, reason: 'stability delay between textarea fills' });
        }
      } catch (error) {
        console.error(`[QA] Error autofilling for "${question}":`, error.message);
      }
    }

    await setupAutoSaveListeners({ evaluate: commander.evaluate, questionToAnswer });
    return savePairs(await collectMarkedQAPairs({ evaluate: commander.evaluate }), addOrUpdateQA);
  } catch (error) {
    console.error('Error setting up Q&A handling:', error.message);
    return 0;
  }
}

/**
 * Save Q&A pairs from textareas and radio buttons after user interaction
 */
export async function saveQAPairs({ commander, addOrUpdateQA }) {
  try {
    return await savePairs(await extractQAPairs({ evaluate: commander.evaluate }), addOrUpdateQA);
  } catch (error) {
    console.error('Error saving Q&A pairs:', error.message);
    return 0;
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
      texts: ['Добавить', 'Сопроводительное письмо'],
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
 * Count test textareas (excluding cover letter) that are still empty
 * @returns {Promise<number>}
 */
function countEmptyTestTextareas({ commander }) {
  return commander.evaluate({
    fn: (coverLetterDataQa) => Array.from(document.querySelectorAll('textarea'))
      .filter((textarea) => !coverLetterDataQa.includes(textarea.getAttribute('data-qa')) && !textarea.value.trim())
      .length,
    args: [COVER_LETTER_DATA_QA],
  });
}

/**
 * Handle the vacancy_response page
 *
 * Note: This function is called exclusively from the pageTrigger system
 * in page-triggers.mjs, which ensures it's only called once per page with
 * proper lifecycle management.
 */
export async function handleVacancyResponsePage({
  commander,
  MESSAGE,
  readQADatabase,
  addOrUpdateQA,
  addIgnoredVacancyId,
  autoSubmitEnabled,
  ignoreVacanciesWithQuestionnaire,
  returnUrl = DEFAULT_RETURN_URL,
  verbose,
}) {
  const skipQuestionnaireVacancy = async () => {
    console.log('💡 --ignore-vacancies-with-questionnaire is enabled, skipping this vacancy');
    await rememberIgnoredVacancy(addIgnoredVacancyId, extractVacancyIdFromResponseUrl(commander.getUrl()));
    console.log(`Returning to: ${returnUrl}`);
    await commander.goto({ url: returnUrl, waitForStableUrlBefore: false });
  };

  try {
    console.log('Detected vacancy_response page, handling application form...');
    await commander.waitForSelector({ selector: 'body' });

    // Direct application vacancies are applied on the employer's site - skip them
    if ((await checkAndCloseDirectApplicationModal({ commander })).isDirectApplication) {
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

    const textareaSelector = await prepareCoverLetterTextarea({ commander });
    if (!textareaSelector) {
      return;
    }

    if (MESSAGE) {
      const { filled } = await commander.fillTextArea({
        selector: textareaSelector,
        text: MESSAGE,
        checkEmpty: true,
        scrollIntoView: true,
        simulateTyping: true,
      });
      console.log(filled
        ? `Prefilled cover letter message into: ${textareaSelector}`
        : 'Cover letter already contains text, skipping prefill');
    }

    if (submitWithoutTestSelector) {
      console.log('Using special "Откликнуться без теста" flow');
      await commander.clickButton({ selector: submitWithoutTestSelector, scrollIntoView: true, smoothScroll: true });
      console.log('Clicked "Откликнуться без теста" button');
      await commander.wait({ ms: 2000, reason: 'submit without test to complete' });
      return;
    }

    const textareaCount = await commander.count({ selector: 'textarea' });
    console.log(`Found ${textareaCount} textarea(s) on the page`);

    // Auto-fill answers from database, then give user time to review them
    await setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose });
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

    if (unansweredCount > 0) {
      console.log(`Found ${unansweredCount} of ${totalCount} radio/checkbox test question(s) UNANSWERED`);
      console.log('Cannot auto-submit when test questions remain unanswered - manual submission required');
      console.log('Please answer the remaining questions and submit the form manually when ready');
      return;
    }

    if (await countEmptyTestTextareas({ commander }) > 0) {
      console.log('Found EMPTY test question textarea(s)');
      console.log('Cannot auto-submit when test textareas are empty - manual submission required');
      console.log('Please fill the empty textarea(s) and submit the form manually when ready');
      return;
    }

    if (!hasTestQuestions) {
      console.log('No test questions found, only cover letter - will auto-submit');
    } else if (autoSubmitEnabled) {
      console.log(`All ${totalCount} test question(s) answered and --auto-submit-vacancy-response-form enabled - will auto-submit`);
    } else {
      console.log(`All ${totalCount} test question(s) answered, but --auto-submit-vacancy-response-form is disabled`);
      console.log('Please review the answers and submit the form manually when ready');
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

    await commander.clickButton({ selector: submitSelector, scrollIntoView: true, smoothScroll: true });
    console.log('Clicked submit button');
    await commander.wait({ ms: 2000, reason: 'submission to complete' });
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Page navigation detected during form handling, continuing with next vacancy');
      return;
    }
    if (isTimeoutError(error)) {
      console.log(`⚠️  Timeout error while handling vacancy response page: ${error.message}`);
      console.log('   Skipping this vacancy and continuing with next one');
      return;
    }
    console.error('Unexpected error in handleVacancyResponsePage:', error.message);
    throw error;
  }
}
