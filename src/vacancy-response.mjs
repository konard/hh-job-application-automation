/**
 * Vacancy response page handler
 * Handles the vacancy_response page with QA auto-filling
 */

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
import { SELECTORS } from './hh-selectors.mjs';
import { isNavigationError, isTimeoutError } from 'browser-commander';

/**
 * Setup Q&A auto-fill and auto-save for all textareas and radio buttons on the page
 */
export async function setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose }) {
  try {
    const qaMap = await readQADatabase();

    // Extract all questions from the page using qa.mjs
    const pageQuestions = await extractPageQuestions({ evaluate: commander.evaluate });

    // Deduplicate questions by selector to prevent filling same textarea twice
    // This fixes issue #122 where multiple questions could target the same textarea
    const uniqueQuestions = [];
    const seenSelectors = new Set();
    for (const item of pageQuestions) {
      if (!seenSelectors.has(item.selector)) {
        seenSelectors.add(item.selector);
        uniqueQuestions.push(item);
      } else {
        console.log(`[QA] Skipping duplicate question with same selector: ${item.selector}`);
      }
    }

    const questionToAnswer = new Map();

    // Match questions with answers from database
    for (const item of uniqueQuestions) {
      const match = findBestMatch(item.question, qaMap);
      if (match) {
        questionToAnswer.set(item.question, {
          ...item,
          answer: match.answer,
          matchScore: match.score,
        });
        console.log(`[QA] Fuzzy match for "${item.question}" (score: ${match.score.toFixed(3)})`);
        console.log(`[QA] Matched to: "${match.question}"`);
        console.log(`[QA] Answer: "${match.answer}"`);
      }
    }

    // Track filled selectors to prevent duplicate fills
    const filledSelectors = new Set();

    // Auto-fill textareas and select radio buttons using qa.mjs functions
    // Each fill operation is sequential with proper await to prevent concurrent typing
    for (const [question, data] of questionToAnswer) {
      try {
        if (data.type === 'textarea') {
          // Mark selector as being filled BEFORE starting fill operation
          // This prevents race conditions where second fill starts before first completes
          // Fixes issue #122 duplicate text filling
          if (filledSelectors.has(data.selector)) {
            console.log(`[QA] Skipping duplicate fill for selector: ${data.selector}`);
            continue;
          }
          filledSelectors.add(data.selector); // Mark as being filled before fill starts

          await fillTextareaQuestion({ commander, questionData: data, verbose });
          // Note: We keep the selector in the set regardless of fill result
          // to prevent retry attempts on the same element

          // Small delay between textarea fills to ensure stability
          await commander.wait({ ms: 2000, reason: 'stability delay between textarea fills' });
        } else if (data.type === 'radio') {
          await fillRadioQuestion({ commander, questionData: data, verbose });
        } else if (data.type === 'checkbox') {
          await fillCheckboxQuestion({ commander, questionData: data, verbose });
        }
      } catch (error) {
        console.error(`[QA] Error autofilling for "${question}":`, error.message);
      }
    }

    // Setup auto-save listeners for textareas using qa.mjs
    await setupAutoSaveListeners({
      evaluate: commander.evaluate,
      questionToAnswer,
    });

    const qaPairsToSave = await collectMarkedQAPairs({
      evaluate: commander.evaluate,
    });

    for (const { question, answer } of qaPairsToSave) {
      await addOrUpdateQA(question, answer);
      console.log('Saved Q&A:', question);
    }

    return qaPairsToSave.length;
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
    const qaPairs = await extractQAPairs({ evaluate: commander.evaluate });

    for (const { question, answer } of qaPairs) {
      await addOrUpdateQA(question, answer);
      console.log('Saved Q&A:', question);
    }

    return qaPairs.length;
  } catch (error) {
    console.error('Error saving Q&A pairs:', error.message);
    return 0;
  }
}

/**
 * Find and return the cover letter textarea selector
 * Returns { selector, visible } or null if not found
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<{selector: string, visible: boolean} | null>}
 */
async function findCoverLetterTextarea({ commander }) {
  const possibleSelectors = [
    SELECTORS.coverLetterTextareaPopup,
    SELECTORS.coverLetterTextareaForm,
  ];

  for (const sel of possibleSelectors) {
    log.debug(() => `Checking selector: ${sel}`);
    const count = await commander.count({ selector: sel });
    log.debug(() => `Count for ${sel}: ${count}`);
    if (count > 0) {
      const visible = await commander.isVisible({ selector: sel });
      log.debug(() => `Visible for ${sel}: ${visible}`);
      if (visible) {
        return { selector: sel, visible: true };
      }
    }
  }

  return null;
}

/**
 * Find and click the cover letter toggle button to expand the section
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<boolean>} True if toggle was found and clicked
 */
async function expandCoverLetterSection({ commander }) {
  try {
    let toggleFound = false;
    let toggleSelector = null;

    // Try data-qa attributes first
    const dataQaSelectors = [
      SELECTORS.coverLetterToggle,
      SELECTORS.addCoverLetterButton,
    ];

    for (const sel of dataQaSelectors) {
      const count = await commander.count({ selector: sel });
      if (count > 0) {
        toggleFound = true;
        toggleSelector = sel;
        break;
      }
    }

    // Fallback to text matching for small elements
    if (!toggleFound) {
      log.debug(() => 'data-qa not found, searching by text');

      const searchTexts = ['Добавить', 'Сопроводительное письмо'];
      const elementTypes = ['a', 'button', 'span', 'div'];

      for (const searchText of searchTexts) {
        for (const elementType of elementTypes) {
          log.debug(() => `Searching for "${searchText}" in ${elementType} elements`);
          toggleSelector = await commander.findByText({
            text: searchText,
            selector: elementType,
          });
          const count = await commander.count({ selector: toggleSelector });
          log.debug(() => `Found ${count} elements matching "${searchText}" in ${elementType}`);
          if (count > 0) {
            toggleFound = true;
            break;
          }
        }
        if (toggleFound) break;
      }
    }

    if (toggleFound) {
      const text = await commander.textContent({ selector: toggleSelector });
      const dataQa = await commander.getAttribute({ selector: toggleSelector, attribute: 'data-qa' });
      log.debug(() => `Found toggle element: text="${text?.trim()}", data-qa="${dataQa}"`);
      console.log(`Cover letter section is collapsed, clicking toggle (text: "${text?.trim()}", data-qa: "${dataQa}") to expand...`);

      await commander.clickButton({
        selector: toggleSelector,
        scrollIntoView: true,
      });

      console.log('Toggle click completed');

      await commander.wait({ ms: 1700, reason: 'expand animation to complete' });
      console.log('Cover letter section expanded');

      const countAfter = await commander.count({ selector: 'textarea' });
      log.debug(() => `After toggle click: Found ${countAfter} textarea(s) on page`);
      return true;
    } else {
      console.log('Toggle button not found, cover letter section may already be expanded');
      return false;
    }
  } catch (error) {
    console.log('Toggle button not found, cover letter section may already be expanded');
    console.log(`Error during toggle: ${error.message}`);
    return false;
  }
}

/**
 * Wait for a visible textarea selector
 * Tries multiple selectors in order
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {string} options.preferredSelector - Preferred selector to try first
 * @returns {Promise<string | null>} The working selector or null
 */
async function waitForTextareaSelector({ commander, preferredSelector }) {
  const selectorsToTry = [
    preferredSelector,
    SELECTORS.coverLetterTextareaPopup,
    SELECTORS.coverLetterTextareaForm,
    'textarea',
  ].filter(Boolean);

  for (const selector of selectorsToTry) {
    try {
      log.debug(() => `Waiting for textarea selector: ${selector}`);
      await commander.waitForSelector({ selector, visible: true, timeout: 2000 });
      log.debug(() => `Textarea found and visible: ${selector}`);
      return selector;
    } catch {
      log.debug(() => `Selector timed out after 2000ms: ${selector}`);
      if (selector === 'textarea') {
        console.log('Cover letter textarea not found on vacancy_response page');
        const count = await commander.count({ selector: 'textarea' });
        console.log(`Found ${count} textarea(s) on page`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Check for empty test textareas (excluding cover letter)
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<{hasEmpty: boolean, emptyCount: number, details: Array} | null>}
 */
async function checkEmptyTestTextareas({ commander }) {
  log.debug(() => 'Checking for empty test textareas...');
  const coverLetterPopupQa = 'vacancy-response-popup-form-letter-input';
  const coverLetterFormQa = 'vacancy-response-form-letter-input';

  return commander.evaluate({
    fn: (popupQa, formQa) => {
      const textareas = document.querySelectorAll('textarea');
      let emptyCount = 0;
      const details = [];

      textareas.forEach((textarea, index) => {
        const dataQa = textarea.getAttribute('data-qa');
        const isCoverLetter = dataQa === popupQa || dataQa === formQa;

        const isEmpty = !textarea.value.trim();
        details.push({
          index,
          isCoverLetter,
          isEmpty,
          dataQa,
          valueLength: textarea.value.length,
        });

        if (!isCoverLetter && isEmpty) {
          emptyCount++;
        }
      });

      return { hasEmpty: emptyCount > 0, emptyCount, details };
    },
    args: [coverLetterPopupQa, coverLetterFormQa],
  });
}

/**
 * Find the submit button selector
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<string | null>}
 */
async function findSubmitButton({ commander }) {
  const submitSelectors = [
    SELECTORS.submitButtonPopup,  // Modal form
    SELECTORS.submitButtonLetter, // Full-page form
    'button[type="submit"]',       // Generic fallback
  ];

  for (const sel of submitSelectors) {
    const count = await commander.count({ selector: sel });
    if (count > 0) {
      console.log(`Found submit button with selector: ${sel}`);
      return sel;
    }
  }

  console.log('Submit button not found (tried multiple selectors)');
  return null;
}

/**
 * Find the special "Откликнуться без теста" button if present
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<string | null>}
 */
async function findSubmitWithoutTestButton({ commander }) {
  const directSelector = SELECTORS.submitButtonWithoutQuestions;
  const directCount = await commander.count({ selector: directSelector });
  if (directCount > 0) {
    console.log('Found special submit button "Откликнуться без теста" by data-qa selector');
    return directSelector;
  }

  return null;
}

/**
 * Get submit button state
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {string} options.selector - Submit button selector
 * @returns {Promise<Object>} Button state object
 */
async function getSubmitButtonState({ commander, selector }) {
  return commander.evaluate({
    fn: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };

      return {
        found: true,
        disabled: el.hasAttribute('disabled') || el.classList.contains('disabled'),
        hasDisabledAttr: el.hasAttribute('disabled'),
        hasDisabledClass: el.classList.contains('disabled'),
        classList: Array.from(el.classList),
        textContent: el.textContent?.trim(),
      };
    },
    args: [selector],
  });
}

/**
 * Check if the direct application modal is present and skip it
 * Returns true if modal was detected and skipped, false otherwise
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<boolean>}
 */
async function checkAndSkipDirectApplicationModal({ commander }) {
  try {
    // Check if the direct application modal is present
    // This modal appears for vacancies that redirect to external employer sites
    const cancelButtonCount = await commander.count({ selector: SELECTORS.directApplicationCancelButton });

    if (cancelButtonCount > 0) {
      console.log('⚠️  Detected direct application modal (external site application)');
      console.log('   This vacancy requires application on the employer\'s website');
      console.log('   Clicking cancel button to skip this vacancy...');

      // Click the cancel button to close the modal and skip this vacancy
      await commander.clickButton({
        selector: SELECTORS.directApplicationCancelButton,
        scrollIntoView: true,
      });

      console.log('✅ Direct application modal closed, vacancy skipped');

      // Small wait to ensure the modal is closed and page is ready
      await commander.wait({ ms: 1000, reason: 'direct application modal to close' });

      return true;
    }

    return false;
  } catch (error) {
    log.debug(() => `Error checking for direct application modal: ${error.message}`);
    return false;
  }
}

/**
 * Handle the vacancy_response page
 *
 * Note: This function is now called exclusively from the pageTrigger system
 * in page-triggers.mjs, which ensures it's only called once per page with
 * proper lifecycle management. Legacy calls from vacancies.mjs have been removed.
 */
export async function handleVacancyResponsePage({
  commander,
  MESSAGE,
  vacancyResponsePattern,
  readQADatabase,
  addOrUpdateQA,
  autoSubmitEnabled,
  ignoreVacanciesWithQuestionnaire,
  returnUrl,
  verbose,
}) {
  try {
    console.log('Detected vacancy_response page, handling application form...');

    log.debug(() => `Engine: ${commander.engine}`);
    log.debug(() => 'About to wait for body selector');

    await commander.waitForSelector({ selector: 'body' });

    log.debug(() => 'Body selector found');

    // Check for direct application modal first and skip if present
    const isDirectApplication = await checkAndSkipDirectApplicationModal({ commander });
    if (isDirectApplication) {
      // This is a direct application vacancy, we should skip it
      // Return early to allow the automation to continue with the next vacancy
      return;
    }

    const submitWithoutTestSelector = await findSubmitWithoutTestButton({ commander });

    if (ignoreVacanciesWithQuestionnaire) {
      const questionnaireFields = await extractPageQuestions({ evaluate: commander.evaluate });

      if (questionnaireFields.length > 0 && !submitWithoutTestSelector) {
        console.log(`⚠️  Detected ${questionnaireFields.length} questionnaire field(s) on vacancy_response page`);
        console.log('💡 --ignore-vacancies-with-questionnaire is enabled, skipping this vacancy');

        const destinationUrl = returnUrl || 'https://hh.ru/search/vacancy?from=resumelist';
        console.log(`Returning to: ${destinationUrl}`);
        await commander.goto({ url: destinationUrl, waitForStableUrlBefore: false });
        return;
      }

      if (questionnaireFields.length > 0 && submitWithoutTestSelector) {
        console.log('Detected questionnaire fields, but "Откликнуться без теста" is available');
        console.log('Using the special no-questions submit path instead of skipping');
      }
    }

    // Log all textareas for debugging
    log.debug(() => 'About to count textareas');
    const initialCount = await commander.count({ selector: 'textarea' });
    console.log(`Initial scan: Found ${initialCount} textarea(s) on page`);

    // Log all textareas in debug mode
    for (let i = 0; i < initialCount; i++) {
      const selector = `textarea:nth-of-type(${i + 1})`;
      const maxRetries = 3;
      const retryDelay = 500; // ms
      let success = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          log.debug(() => `Processing textarea ${i} with selector: ${selector} (attempt ${attempt}/${maxRetries})`);
          const dataQa = await commander.getAttribute({ selector, attribute: 'data-qa' });
          const visible = await commander.isVisible({ selector });
          const dataQaDisplay = dataQa || '(none)';
          console.log(`Initial textarea ${i}: data-qa="${dataQaDisplay}", visible=${visible}`);
          success = true;
          break; // Success, exit retry loop
        } catch (error) {
          // Common errors: element detached, navigation in progress, timeout
          const isLastAttempt = attempt === maxRetries;

          if (isLastAttempt) {
            // After all retries failed, log error and continue
            console.log(`Initial textarea ${i}: failed after ${maxRetries} attempts (${error.message})`);
            log.debug(() => `Error details for textarea ${i}: ${error.stack || error.message}`);
          } else {
            // Retry after delay
            log.debug(() => `Textarea ${i} error on attempt ${attempt}, retrying in ${retryDelay}ms: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }

      if (!success) {
        log.debug(() => `Textarea ${i} could not be processed after ${maxRetries} attempts, continuing to next`);
      }
    }

    // Check if textarea is already visible
    log.debug(() => 'Checking if textarea is already visible');
    let textareaResult = await findCoverLetterTextarea({ commander });
    let textareaSelector = textareaResult?.selector || '';

    if (textareaResult?.visible) {
      console.log('Cover letter section already expanded, textarea visible');
    } else {
    // If textarea not visible, click toggle button
      await expandCoverLetterSection({ commander });
    }

    // Wait for textarea
    const workingSelector = await waitForTextareaSelector({
      commander,
      preferredSelector: textareaSelector || SELECTORS.coverLetterTextareaPopup,
    });

    if (!workingSelector) {
      return;
    }

    textareaSelector = workingSelector;

    // Fill cover letter
    log.debug(() => `About to fill textarea with selector: ${textareaSelector}`);
    const filled = await commander.fillTextArea({
      selector: textareaSelector,
      text: MESSAGE,
      checkEmpty: true,
      scrollIntoView: true,
      simulateTyping: true,
    });
    if (filled) {
      console.log(`Prefilled cover letter message into: ${textareaSelector}`);
    } else {
      console.log('Cover letter already contains text, skipping prefill');
    }

    if (submitWithoutTestSelector) {
      console.log('Using special "Откликнуться без теста" flow');
      await commander.clickButton({
        selector: submitWithoutTestSelector,
        scrollIntoView: true,
        smoothScroll: true,
      });
      console.log('Clicked "Откликнуться без теста" button');
      await commander.wait({ ms: 2000, reason: 'submit without test to complete' });
      return;
    }

    // Count textareas
    const textareaCount = await commander.count({ selector: 'textarea' });
    console.log(`Found ${textareaCount} textarea(s) on the page`);

    // Setup Q&A handling first (this will auto-fill answers from database)
    await setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose });

    // Wait for form validation and give user time to review auto-filled answers
    await commander.wait({ ms: 30000, reason: 'form validation and user review after auto-fill' });

    // Check if we're still on the vacancy_response page (may have navigated away)
    const currentUrl = commander.getUrl();
    if (!vacancyResponsePattern.test(currentUrl)) {
      console.log('Page navigated away from vacancy_response, skipping auto-submit');
      return;
    }

    // Count total test questions and unanswered test questions using qa.mjs
    let testQuestionStats;
    try {
      log.debug(() => 'Counting test questions (radio/checkbox)...');
      testQuestionStats = await countUnansweredQuestions({
        evaluate: commander.evaluate,
      });
      log.debug(() => `Question stats: total=${testQuestionStats.totalCount}, unanswered=${testQuestionStats.unansweredCount}`);
    } catch (error) {
      if (error.message && error.message.includes('Execution context was destroyed')) {
        console.log('Page navigated away during question counting, skipping auto-submit');
        return;
      }
      throw error;
    }

    // Check if there are test questions
    const hasTestQuestions = testQuestionStats.totalCount > 0 || textareaCount > 1;
    const hasUnansweredQuestions = testQuestionStats.unansweredCount > 0;

    if (ignoreVacanciesWithQuestionnaire && hasTestQuestions) {
      console.log('⚠️  Detected questionnaire fields on vacancy_response page');
      console.log('💡 --ignore-vacancies-with-questionnaire is enabled, skipping this vacancy');

      const destinationUrl = returnUrl || 'https://hh.ru/search/vacancy?from=resumelist';
      console.log(`Returning to: ${destinationUrl}`);
      await commander.goto({ url: destinationUrl, waitForStableUrlBefore: false });
      return;
    }

    log.debug(() => `hasTestQuestions=${hasTestQuestions} (radioCheckbox=${testQuestionStats.totalCount}, textareas=${textareaCount})`);
    log.debug(() => `hasUnansweredQuestions=${hasUnansweredQuestions}`);

    // Check if any test textareas are empty (beyond just the cover letter)
    let hasEmptyTestTextareas;
    try {
      const textareaCheckResult = await checkEmptyTestTextareas({ commander });
      log.debug(() => `Textarea check result: ${JSON.stringify(textareaCheckResult, null, 2)}`);
      hasEmptyTestTextareas = textareaCheckResult.hasEmpty;
    } catch (error) {
      if (error.message && error.message.includes('Execution context was destroyed')) {
        console.log('Page navigated away during textarea check, skipping auto-submit');
        return;
      }
      throw error;
    }

    if (hasUnansweredQuestions) {
      console.log(`Found ${testQuestionStats.unansweredCount} of ${testQuestionStats.totalCount} radio/checkbox test question(s) UNANSWERED`);
      console.log('Cannot auto-submit when test questions remain unanswered - manual submission required');
      console.log('Please answer the remaining questions and submit the form manually when ready');
      log.debug(() => 'Returning early due to unanswered radio/checkbox questions');
      return;
    }

    if (hasEmptyTestTextareas) {
      console.log('Found EMPTY test question textarea(s)');
      console.log('Cannot auto-submit when test textareas are empty - manual submission required');
      console.log('Please fill the empty textarea(s) and submit the form manually when ready');
      log.debug(() => 'Returning early due to empty test textareas');
      return;
    }

    // Decide whether to auto-submit based on configuration and question presence
    let shouldAutoSubmit = false;

    log.debug(() => 'Deciding whether to auto-submit...');
    log.debug(() => `  hasTestQuestions=${hasTestQuestions}`);
    log.debug(() => `  auto-submit-vacancy-response-form=${autoSubmitEnabled}`);

    if (!hasTestQuestions) {
    // No test questions - always auto-submit (only cover letter)
      shouldAutoSubmit = true;
      console.log('No test questions found, only cover letter - will auto-submit');
    } else if (autoSubmitEnabled) {
    // Has test questions but all answered and flag is enabled
      shouldAutoSubmit = true;
      console.log(`All ${testQuestionStats.totalCount} test question(s) answered and --auto-submit-vacancy-response-form enabled - will auto-submit`);
    } else {
    // Has test questions, all answered, but flag is disabled
      shouldAutoSubmit = false;
      console.log(`All ${testQuestionStats.totalCount} test question(s) answered, but --auto-submit-vacancy-response-form is disabled`);
      console.log('Please review the answers and submit the form manually when ready');
      log.debug(() => 'Returning early: flag disabled');
      return;
    }

    // Auto-submit if decided to auto-submit
    if (shouldAutoSubmit) {
      console.log('Proceeding with auto-submit');

      const submitSelector = await findSubmitButton({ commander });
      if (!submitSelector) {
        return;
      }

      const buttonState = await getSubmitButtonState({ commander, selector: submitSelector });

      log.debug(() => `Submit button state: ${JSON.stringify(buttonState, null, 2)}`);

      if (!buttonState.found) {
        console.log('Submit button not found in DOM');
        return;
      }

      if (buttonState.disabled) {
        console.log('Submit button is disabled, manual action required');
        console.log(`   Button text: "${buttonState.textContent}"`);
        console.log(`   Has disabled attribute: ${buttonState.hasDisabledAttr}`);
        console.log(`   Has disabled class: ${buttonState.hasDisabledClass}`);
        console.log('The form may require additional validation. Please check manually.');
        log.debug(() => 'NOT clicking disabled submit button, returning early');
        return;
      } else {
        log.debug(() => 'Submit button is enabled, clicking...');
        await commander.clickButton({
          selector: submitSelector,
          scrollIntoView: true,
          smoothScroll: true,
        });
        console.log('Clicked submit button');
        await commander.wait({ ms: 2000, reason: 'submission to complete' });
      }
    }
  } catch (error) {
    // Handle errors gracefully to prevent application crash
    if (isNavigationError(error)) {
      console.log('⚠️  Page navigation detected during form handling');
      console.log('   Returning to continue automation with next vacancy');
      return;
    }

    if (isTimeoutError(error)) {
      console.log('⚠️  Timeout error while handling vacancy response page');
      console.log(`   Error: ${error.message}`);
      console.log('   This can happen when:');
      console.log('     - Page loads slowly due to network conditions');
      console.log('     - Expected elements are not present on this vacancy');
      console.log('     - Page structure differs from expected');
      console.log('   Skipping this vacancy and continuing with next one');
      return;
    }

    // Re-throw unexpected errors
    console.error('Unexpected error in handleVacancyResponsePage:', error.message);
    throw error;
  }
}
