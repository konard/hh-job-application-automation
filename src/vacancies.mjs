/**
 * Vacancy list processing module
 * Handles finding and clicking "Откликнуться" buttons in vacancy lists
 */

import { isNavigationError, isTimeoutError } from 'browser-commander';
import { allAnswersExact, countUnansweredQuestions, extractPageQuestions, listOpenQuestions } from './qa.mjs';
import { DEFER_CHOICE, formatQuestions } from './deferred-questions.mjs';
import { describeFilterMatch } from './vacancy-filters.mjs';
import { noteSkip } from './skipped-vacancies.mjs';
import { saveMarkedQAPairs, saveQAPairs, setupQAHandling } from './vacancy-response.mjs';
import { waitForVisibleResume } from './resume-visibility.mjs';
import { closeModalIfPresent, checkAndCloseDirectApplicationModal } from './helpers/modal-helpers.mjs';
import { closeChatPanel, findCoverLetterToggle, isButtonEnabled } from './helpers/page-helpers.mjs';
import { SELECTORS, URL_PATTERNS } from './hh-selectors.mjs';
import { log } from './logging.mjs';
import { coverLetterFor } from './cover-letter.mjs';
import { askUser, decideSend, isInteractive, waitForUser } from './confirmations.mjs';

/**
 * Handle limit error when detected
 * Closes modal, waits 1 hour, and refreshes the page
 */
export async function handleLimitError({ commander, START_URL }) {
  console.log('⚠️  Limit reached: 200 applications in 24 hours');
  console.log('💤 Waiting 1 hour before retrying...');

  await closeModalIfPresent({ commander });
  await commander.wait({ ms: 60 * 60 * 1000, reason: '200 application limit cooldown (1 hour)' });

  console.log('🔄 Refreshing the page after wait period...');
  await commander.goto({ url: START_URL });
}

/**
 * Print the modal form text (it usually explains why the form cannot be submitted)
 */
async function logModalText({ commander, title }) {
  try {
    const modalText = await commander.innerText(SELECTORS.applicationForm);
    console.error(title);
    console.error(modalText);
  } catch {
    console.error('⚠️  Could not extract modal content');
  }
}

/**
 * Close the application modal and report why the vacancy was skipped
 */
async function skipModal({ commander, reason }) {
  await closeModalIfPresent({ commander });
  return { success: false, reason };
}

/** The popup result when hh.ru has replaced it with the full application form */
const FULL_FORM_OPENED = { success: false, reason: 'full_form_opened' };

/**
 * Whether hh.ru has replaced the popup with the full application form: for a vacancy with
 * questions it may first open the popup and switch to /applicant/vacancy_response seconds later
 */
const isFullFormOpened = (commander) => URL_PATTERNS.vacancyResponse.test(commander.getUrl());

/**
 * Wait while the user handles the popup in the browser (nobody answers on stdin): until it is
 * sent or closed, or hh.ru switches to the full form. Answers the user types meanwhile are saved
 * to qa.lino; the autofilled ones are not, so an answer of a similar question that nobody
 * confirmed never becomes the exact saved answer of this wording
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function waitForPopupInBrowser({ commander, vacancyId, title, addOrUpdateQA, skippedVacancies }) {
  console.log('⏸️  Waiting for you in the browser: answer and send the application popup, or close it');
  for (;;) {
    if (isFullFormOpened(commander)) {
      return FULL_FORM_OPENED;
    }
    if (addOrUpdateQA) {
      await saveMarkedQAPairs({ commander, addOrUpdateQA });
    }
    if (await commander.count({ selector: SELECTORS.applicationForm }) === 0) {
      break;
    }
    const waited = await commander.wait({ ms: 5000, reason: 'the user to send or close the application popup' });
    if (waited?.aborted) {
      return { success: false, reason: 'navigation_detected' };
    }
  }
  if (vacancyId && await isVacancyCardResponded({ commander, vacancyId })) {
    console.log(`✅ Application sent for vacancy ${vacancyId} in the browser`);
    return { success: true };
  }
  await noteSkip(skippedVacancies, vacancyId, { reason: 'skipped_by_user', title });
  return { success: false, reason: 'closed_by_user' };
}

/**
 * Process modal application form
 * Fills the cover letter, autofills the questions from qa.lino like the full form (saving the
 * user's own answers), and sends it by the rules of decideSend. Stops as soon as hh.ru switches
 * to the full application form, which the vacancy_response page handler takes over. Every skip
 * is logged and kept in data/skipped-vacancies.lino (or deferred-questions.lino /
 * filtered-vacancies.lino)
 */
export async function processModalApplication({
  commander,
  MESSAGE,
  ignoreVacanciesWithQuestionnaire = false,
  vacancyId = null,
  vacancy = '',
  title = '',
  deferredQuestions = null,
  readQADatabase = null,
  addOrUpdateQA = null,
  autoSendExact = false,
  autoSubmit = false,
  onMissingAnswers = 'wait',
  vacancyFilters = null,
  skippedVacancies = null,
  verbose = false,
}) {
  const textareaSelector = SELECTORS.coverLetterTextareaPopup;
  if (isFullFormOpened(commander)) {
    return FULL_FORM_OPENED;
  }
  const skip = async (reason) => {
    await noteSkip(skippedVacancies, vacancyId, { reason, title });
    return skipModal({ commander, reason });
  };

  // Before anything is typed into the popup
  const filterMatch = await vacancyFilters?.match({
    vacancy,
    description: vacancyFilters.description?.(vacancyId) ?? '',
    questions: (await extractPageQuestions({ evaluate: commander.evaluate })).map(({ question }) => question),
    page: (await commander.safeEvaluate({
      fn: (selector) => document.querySelector(selector)?.innerText ?? '',
      args: [SELECTORS.applicationForm],
      defaultValue: '',
      operationName: 'popup text for the vacancy filters',
      silent: true,
    })).value,
  });
  if (filterMatch) {
    console.log(`🚫 Vacancy ${vacancyId} filtered out by vacancy-filters.lino (${describeFilterMatch(filterMatch)})`);
    await vacancyFilters.remember(vacancyId, filterMatch, { title });
    return skipModal({ commander, reason: 'filtered_out' });
  }
  const visibility = await waitForVisibleResume(commander, { scopeSelector: SELECTORS.applicationForm, vacancyId });
  if (visibility === 'withdrawn') {
    return skipModal({ commander, reason: 'withdrawn' });
  }
  if (visibility !== 'visible') {
    return skip('resume_not_visible');
  }

  // Expand the cover letter section unless the textarea is already visible (cover letter might be mandatory)
  const textareaVisible = await commander.count({ selector: textareaSelector }) > 0 &&
    await commander.isVisible({ selector: textareaSelector });
  if (textareaVisible) {
    console.log('💡 Cover letter textarea already visible, skipping toggle click');
  } else {
    const toggleSelector = await findCoverLetterToggle(commander, {
      texts: ['сопроводительное'],
      elementTypes: ['button', 'a'],
    });
    if (toggleSelector) {
      try {
        await commander.clickButton({ selector: toggleSelector, scrollIntoView: false });
        console.log('✅ Clicked cover letter toggle');
      } catch (error) {
        console.log(`⚠️  Could not click toggle: ${error.message}`);
      }
    } else {
      console.log('💡 Cover letter toggle not found, section may already be expanded');
    }
  }

  if (isFullFormOpened(commander)) {
    return FULL_FORM_OPENED;
  }
  // The English letter when the vacancy's questions are in English
  const letter = coverLetterFor(MESSAGE, (await extractPageQuestions({ evaluate: commander.evaluate })).map(({ question }) => question));
  if (letter) {
    const { filled, verified, actualValue } = await commander.fillTextArea({
      selector: textareaSelector,
      text: letter,
      checkEmpty: true,
      scrollIntoView: false,
      simulateTyping: true,
    });
    if (!filled) {
      console.log(`⏭️  ${commander.engine}: textarea already contains text, skipping typing to prevent double entry`);
    } else if (verified) {
      console.log(`✅ ${commander.engine}: typed message successfully`);
    } else {
      console.error(`❌ ${commander.engine}: textarea value does not match expected message`);
      console.error('Expected:', letter);
      console.error('Actual:', actualValue);
    }
  }

  const { totalCount } = await countUnansweredQuestions({
    evaluate: commander.evaluate,
    containerSelector: SELECTORS.applicationForm,
  });
  const modalTextareaCount = await commander.count({ selector: `${SELECTORS.applicationForm} textarea` });
  const hasQuestions = totalCount > 0 || modalTextareaCount > 1;

  if (ignoreVacanciesWithQuestionnaire && hasQuestions) {
    console.log('⚠️  Detected questionnaire fields in modal application form');
    return skip('questionnaire_ignored');
  }

  // The saved answers before this popup: answers saved while it is open never count as exact
  const savedBefore = hasQuestions && readQADatabase ? await readQADatabase() : new Map();
  // The same autofill (similar saved questions) and saving of the user's answers as the full form
  if (hasQuestions && readQADatabase && addOrUpdateQA) {
    await setupQAHandling({ commander, readQADatabase, addOrUpdateQA, verbose });
  }
  // The answers the user typed; every answer of the popup only once it is sent
  const saveTyped = () => (addOrUpdateQA ? saveMarkedQAPairs({ commander, addOrUpdateQA }) : 0);
  const saveAll = () => (addOrUpdateQA ? saveQAPairs({ commander, addOrUpdateQA }) : 0);

  // Answered later: the vacancy is kept under its questions in deferred-questions.lino
  const deferModal = async (questions) => {
    if (!deferredQuestions) {
      return skip('unanswered_questions');
    }
    await deferredQuestions.defer(questions, vacancyId);
    console.log(`⏭️  Vacancy ${vacancyId} skipped for now, kept in deferred-questions.lino under:\n${formatQuestions(questions)}`);
    await noteSkip(skippedVacancies, vacancyId, { reason: 'questions_deferred', title });
    return skipModal({ commander, reason: 'questions_deferred' });
  };
  const listOpen = () => listOpenQuestions({ evaluate: commander.evaluate });
  const countOpen = async () => Math.max(
    (await countUnansweredQuestions({ evaluate: commander.evaluate, containerSelector: SELECTORS.applicationForm }))
      .unansweredCount,
    (await listOpen()).length,
  );

  const openQuestions = await listOpen();
  if (deferredQuestions && hasQuestions) {
    const questionsToSkip = await deferredQuestions.questionsToSkip({
      questions: (await extractPageQuestions({ evaluate: commander.evaluate })).map(({ question }) => question),
      openQuestions,
    });
    if (questionsToSkip.length > 0) {
      return deferModal(questionsToSkip);
    }
  }

  // Sent without asking only when autofill alone answered every question with its saved answer
  let open = await countOpen();
  const exactAfterAutofill = autoSendExact && hasQuestions && open === 0 && Boolean(readQADatabase);
  if (open > 0) {
    console.log(`Open questions (no saved answer):\n${formatQuestions(openQuestions)}`);
    // --on-missing-answers wait (the default): never skip, wait for the user to answer
    if (onMissingAnswers === 'skip') {
      console.log('Skipping this vacancy (--on-missing-answers skip)');
      return deferModal(await listOpen());
    }
    if (!isInteractive()) {
      return waitForPopupInBrowser({ commander, vacancyId, title, addOrUpdateQA, skippedVacancies });
    }
  }
  while (open > 0) {
    const choice = await askUser(`Answer the ${open} open question(s) in the application popup (the answers are saved to qa.lino)`, {
      skip: deferredQuestions ? DEFER_CHOICE : undefined,
    });
    await saveTyped();
    if (choice === 'skip') {
      return deferModal(await listOpen());
    }
    if (choice === 'withdrawn') {
      return { success: false, reason: 'withdrawn' };
    }
    open = await countOpen();
  }

  const submitButtonSelector = SELECTORS.submitButtonPopup;
  if (await commander.count({ selector: submitButtonSelector }) === 0) {
    console.error(`❌ Submit button not found in modal! Tried selector: ${submitButtonSelector}`);
    await logModalText({ commander, title: '📋 Modal content:' });
    console.error('💡 Closing modal and skipping this vacancy...');
    return skip('button_not_found');
  }

  while (isInteractive() && !await isButtonEnabled(commander, submitButtonSelector)) {
    await logModalText({ commander, title: '📋 The send button is disabled; the popup says:' });
    await waitForUser('Fix the application popup so it can be sent');
  }

  if (!await isButtonEnabled(commander, submitButtonSelector)) {
    console.error('❌ Application button is still disabled after entering the message!');
    await logModalText({ commander, title: '📋 Reason from modal:' });
    console.error('💡 Closing modal and skipping this vacancy...');
    return skip('button_disabled');
  }

  if (isFullFormOpened(commander)) {
    return FULL_FORM_OPENED;
  }
  const autoSend = exactAfterAutofill &&
    allAnswersExact(await extractPageQuestions({ evaluate: commander.evaluate }), savedBefore);
  if (autoSend) {
    console.log('✅ Every answer is the saved answer of the very same question - sending without asking');
  }
  const decision = await decideSend({ hasQuestions, autoSend, autoSubmit, skip: 'skip this vacancy' });
  if (decision === 'wait') {
    console.log('Not every answer is the saved answer of the very same question, so the popup is not sent unattended');
    return waitForPopupInBrowser({ commander, vacancyId, title, addOrUpdateQA, skippedVacancies });
  }
  if (decision === 'skip') {
    await saveTyped();
    return skip('skipped_by_user');
  }
  if (decision === 'withdrawn') {
    return { success: false, reason: 'withdrawn' };
  }
  // The answers go with the application, so they are saved, like the full form's
  await saveAll();
  try {
    await commander.clickButton({ selector: submitButtonSelector, scrollIntoView: false, timeout: 10000, autoSend });
    console.log(`✅ ${commander.engine}: clicked submit button`);
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Navigation detected while submitting, continuing...');
      return { success: false, reason: 'navigation_detected' };
    }
    console.error(`❌ Failed to click submit button: ${error.message}`);
    console.error('💡 Closing modal and skipping this vacancy...');
    return skip('click_failed');
  }

  await commander.wait({ ms: 2000, reason: 'modal to close after submission' });
  if (vacancyId && !await isVacancyCardResponded({ commander, vacancyId })) {
    console.log(`⚠️  hh.ru did not mark vacancy ${vacancyId} as responded, manual check required`);
    return { success: false, reason: 'not_confirmed' };
  }
  console.log(`✅ Application sent for vacancy ${vacancyId}`);
  // hh.ru opens the employer chat with the cover letter after an application
  await commander.wait({ ms: 1500, reason: 'chat panel to open after the application' });
  await closeChatPanel(commander);
  return { success: true };
}

/**
 * Whether the vacancy card on the list shows "Вы откликнулись", waiting up to 10 s
 * @returns {Promise<boolean>}
 */
async function isVacancyCardResponded({ commander, vacancyId }) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { value } = await commander.safeEvaluate({
      fn: (id, respondedSelector) => Boolean(document.querySelector(`a[href*="/vacancy/${id}"]`)
        ?.closest('[data-qa^="vacancy-serp__vacancy"]')?.querySelector(respondedSelector)),
      args: [vacancyId, SELECTORS.vacancyResponded],
      defaultValue: false,
      operationName: 'responded vacancy check',
      silent: true,
    });
    if (value) {
      return true;
    }
    await commander.wait({ ms: 1000, reason: 'vacancy card to show the response' });
  }
  return false;
}

/**
 * In-memory Set to track processed vacancy IDs across all pages
 * This prevents the same vacancy from being clicked multiple times,
 * even if the user navigates to different pages where the same vacancy appears.
 *
 * The vacancy ID is extracted from the DOM structure:
 * <div id="128579290" class="vacancy-card--...">
 *   ... button inside ...
 * </div>
 */
const processedVacancyIds = new Set();

/**
 * Get the count of processed vacancy IDs (for logging/debugging)
 * @returns {number} Number of processed vacancies
 */
export function getProcessedVacancyCount() {
  return processedVacancyIds.size;
}

/**
 * Clear all processed vacancy IDs (useful for testing or reset)
 */
export function clearProcessedVacancies() {
  processedVacancyIds.clear();
}

/**
 * Check if a vacancy has been processed
 * @param {string} vacancyId - The vacancy ID to check
 * @returns {boolean} True if the vacancy has been processed
 */
export function isVacancyProcessed(vacancyId) {
  return processedVacancyIds.has(vacancyId);
}

/**
 * Mark a vacancy as processed
 * @param {string} vacancyId - The vacancy ID to mark as processed
 */
export function markVacancyAsProcessed(vacancyId) {
  processedVacancyIds.add(vacancyId);
}

/**
 * Get the "Откликнуться" button selector as a plain CSS selector usable in the browser
 * @returns {Promise<string|null>}
 */
async function getApplyButtonSelector({ commander }) {
  const textSelector = await commander.findByText({ text: 'Откликнуться', selector: 'a' });
  const selector = await commander.normalizeSelector({ selector: textSelector });
  // DEFENSIVE: Validate selector is a string to prevent Issue #148
  // See docs/case-studies/issue-148/case-study.md for details
  return typeof selector === 'string' && selector ? selector : null;
}

/**
 * Scan "Откликнуться" buttons and find the first one whose vacancy was not processed yet
 * @returns {Promise<{value: Object, navigationError?: boolean}>}
 */
function scanApplyButtons({ commander, selector }) {
  return commander.safeEvaluate({
    fn: (baseSelector, alreadyProcessedIds) => {
      const processedSet = new Set(alreadyProcessedIds);
      const isVacancyId = (id) => /^\d+$/.test(id);

      // The vacancy card (or one of its ancestors/children) carries a numeric id like "128579290"
      const ancestorId = (start) => {
        for (let el = start; el; el = el.parentElement) {
          if (isVacancyId(el.id)) return el.id;
        }
        return null;
      };
      const findVacancyId = (button) => {
        const card = button.closest('[class*="vacancy-card--"]');
        const childId = card?.querySelector('[id]')?.id;
        return (card && ancestorId(card)) || (isVacancyId(childId) ? childId : null) || ancestorId(button.parentElement);
      };

      const buttons = Array.from(document.querySelectorAll(baseSelector));
      const unprocessed = buttons
        .map((button, index) => ({ index, vacancyId: findVacancyId(button) }))
        .filter(({ vacancyId }) => !vacancyId || !processedSet.has(vacancyId));

      return {
        totalButtons: buttons.length,
        unprocessedCount: unprocessed.length,
        buttonIndex: unprocessed[0]?.index ?? -1,
        vacancyId: unprocessed[0]?.vacancyId ?? null,
      };
    },
    args: [selector, Array.from(processedVacancyIds)],
    defaultValue: { totalButtons: 0, unprocessedCount: 0, buttonIndex: -1, vacancyId: null },
    operationName: 'find unprocessed vacancy button',
    silent: true,
  });
}

/**
 * Find the first unprocessed vacancy button on the page (retries once after a short wait)
 * @returns {Promise<{selector: string|null, buttonIndex?: number, vacancyId?: string, status?: string}>}
 */
async function findVacancyButton({ commander }) {
  const selector = await getApplyButtonSelector({ commander });
  if (!selector) {
    log.debug(() => '🔍 Could not find button with text "Откликнуться"');
    return { selector: null, status: 'no_buttons_found' };
  }

  let scan = await scanApplyButtons({ commander, selector });
  if (!scan.navigationError && scan.value.unprocessedCount === 0) {
    log.debug(() => `🔍 Found ${scan.value.totalButtons} button(s), none unprocessed - waiting for page to fully load...`);
    await commander.wait({ ms: 2000, reason: 'page to fully load' });
    scan = await scanApplyButtons({ commander, selector });
  }

  if (scan.navigationError) {
    return { selector: null, status: 'navigation_detected' };
  }
  const { totalButtons, unprocessedCount, buttonIndex, vacancyId } = scan.value;
  if (unprocessedCount === 0) {
    return { selector: null, status: 'no_buttons_found' };
  }

  console.log(`📋 Found ${unprocessedCount} "Откликнуться" button(s). Processing next button...`);
  log.debug(() => `🔍 ${totalButtons - unprocessedCount} button(s) already processed; next vacancy ID: ${vacancyId}`);
  return { selector, buttonIndex, vacancyId };
}

/**
 * Run an action on the button at the given index (in the browser)
 * @returns {Promise<{value: any, navigationError?: boolean}>}
 */
function withButtonAt({ commander, selector, buttonIndex, action, defaultValue }) {
  return commander.safeEvaluate({
    fn: (baseSelector, index, actionName) => {
      const button = document.querySelectorAll(baseSelector)[index];
      if (!button) return null;
      if (actionName === 'isEnabled') {
        return !(button.hasAttribute('disabled') ||
          button.classList.contains('disabled') ||
          button.getAttribute('aria-disabled') === 'true');
      }
      if (actionName === 'scrollIntoView') {
        button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        button.click();
      }
      return true;
    },
    args: [selector, buttonIndex, action],
    defaultValue,
    operationName: `vacancy button ${action}`,
    // Callers handle navigationError themselves
    silent: true,
  });
}

/**
 * Text of the vacancy card holding the button at the given index, and its title with the employer
 * @returns {Promise<{lines: string[], title: string}>}
 */
async function readVacancyCard({ commander, selector, buttonIndex }) {
  const { value } = await commander.safeEvaluate({
    fn: (baseSelector, index, titleSelector, employerSelector) => {
      let card = document.querySelectorAll(baseSelector)[index];
      while (card && !card.querySelector('a[href*="/vacancy/"]')) {
        card = card.parentElement;
      }
      const text = (element) => element?.innerText.replace(/\s+/g, ' ').trim() ?? '';
      const title = text(card?.querySelector(titleSelector) ?? card?.querySelector('a[href*="/vacancy/"]'));
      const employer = text(card?.querySelector(employerSelector));
      return {
        lines: card?.innerText.split('\n').map((line) => line.trim()).filter(Boolean) ?? [],
        title: [title, employer].filter(Boolean).join(' | '),
      };
    },
    args: [selector, buttonIndex, SELECTORS.vacancyCardTitle, SELECTORS.vacancyCardEmployer],
    defaultValue: { lines: [], title: '' },
    operationName: 'vacancy card text',
    silent: true,
  });
  return value ?? { lines: [], title: '' };
}

function describeVacancyCard(lines) {
  return lines.length > 0 ? `"${lines.slice(0, 4).join(' | ')}"` : 'the next vacancy';
}

/**
 * The description of a vacancy (title, work format, employment and description text) for the
 * on-site vacancy filters, read with ONE request: a same-origin fetch of the vacancy page's HTML
 * from the list page, parsed without rendering, so there is no navigation and no scripts, images
 * or further requests. Neither the search card nor the application popup or form shows the
 * description, and opening the vacancy page in the tab would cost a navigation with all its
 * assets. It is read only when the card does not settle the filters (vacancy-filters.mjs
 * needsDescription: no programming or remote sign on the card), right before the vacancy would be
 * opened anyway, and the orchestrator keeps the pause between vacancies after it
 * @returns {Promise<string>} '' when it could not be read (then the card alone is used)
 */
export async function readVacancyDescription({ commander, vacancyId }) {
  const { value } = await commander.safeEvaluate({
    fn: async (id, partsSelector) => {
      try {
        const response = await fetch(`/vacancy/${id}`, { credentials: 'include', headers: { Accept: 'text/html' } });
        if (!response.ok) {
          return '';
        }
        const page = new window.DOMParser().parseFromString(await response.text(), 'text/html');
        return [...page.querySelectorAll(partsSelector)]
          .map((element) => element.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      } catch {
        return '';
      }
    },
    args: [String(vacancyId), SELECTORS.vacancyDescriptionParts],
    defaultValue: '',
    operationName: 'vacancy description for the vacancy filters',
    silent: true,
  });
  const description = value ?? '';
  console.log(description
    ? `📄 Read the description of vacancy ${vacancyId} (${description.length} characters) for the on-site filters`
    : `⚠️  Could not read the description of vacancy ${vacancyId}; the vacancy filters use its card only`);
  return description;
}

/**
 * Click the button at the given index with smooth scrolling
 * @returns {Promise<{success: boolean, status?: string}>}
 */
async function clickVacancyButton({ commander, selector, buttonIndex }) {
  const enabled = await withButtonAt({ commander, selector, buttonIndex, action: 'isEnabled', defaultValue: true });
  if (enabled.navigationError) {
    return { success: false, status: 'navigation_detected' };
  }
  if (!enabled.value) {
    console.log('⚠️  First button is disabled or loading, waiting 2 seconds...');
    await commander.wait({ ms: 2000, reason: 'button to become enabled' });
    return { success: false, status: 'button_disabled' };
  }

  await withButtonAt({ commander, selector, buttonIndex, action: 'scrollIntoView', defaultValue: null });
  await commander.wait({ ms: 500, reason: 'smooth scroll animation' });

  const clicked = await withButtonAt({ commander, selector, buttonIndex, action: 'click', defaultValue: false });
  if (clicked.navigationError) {
    return { success: false, status: 'navigation_detected' };
  }
  if (!clicked.value) {
    console.log('⚠️  Could not click vacancy button, waiting 2 seconds and retrying...');
    await commander.wait({ ms: 2000, reason: 'retry after click error' });
    return { success: false, status: 'click_error' };
  }

  await commander.wait({ ms: 1000, reason: 'post-click settling time' });
  return { success: true };
}

/**
 * Handle post-click navigation and redirects
 * @returns {Promise<{onTargetPage: boolean, status?: string, url?: string}>} `url` of the separate
 *   application page the user filled in
 */
async function handlePostClickNavigation({ commander, waitForUrlCondition, START_URL, pageClosedByUser }) {
  // Wait for modal to appear or (delayed) redirects to complete
  await commander.wait({ ms: 4000, reason: 'modal to appear or redirects to complete' });

  const currentUrl = commander.getUrl();
  if (URL_PATTERNS.searchVacancy.test(currentUrl)) {
    return { onTargetPage: true };
  }

  if (URL_PATTERNS.vacancyResponse.test(currentUrl)) {
    // The vacancy-response-page trigger handles this page
    console.log('📝 Opened the full application form:', currentUrl);
    return { onTargetPage: false, status: 'vacancy_response_detected' };
  }

  console.log('⚠️  Redirected to a different page:', currentUrl);

  console.log('💡 This appears to be a separate application form page.');
  console.log('💡 Please fill out the form manually. Take as much time as you need.');
  console.log('💡 Once done, navigate back to:', START_URL);

  await waitForUrlCondition(START_URL, 'Waiting for you to return to the target page');

  if (pageClosedByUser()) {
    return { onTargetPage: false, status: 'page_closed' };
  }

  console.log('✅ Returned to target page! Continuing with button loop...');
  await commander.wait({ ms: 1000, reason: 'page to fully load after manual navigation' });
  return { onTargetPage: false, status: 'manual_form_completed', url: currentUrl };
}

/**
 * Count limit error popups (200 applications in 24 hours)
 */
async function hasLimitError({ commander }) {
  return await commander.count({ selector: SELECTORS.limitExceededError }) > 0;
}

/**
 * Wait for application modal to appear and check for limit errors
 * @returns {Promise<{appeared: boolean, limitError?: boolean, directApplication?: boolean, url?: string, status?: string}>}
 */
async function waitForApplicationModal({ commander }) {
  let appeared = true;
  try {
    await commander.waitForSelector({ selector: SELECTORS.applicationForm, visible: true, timeout: 10000 });
  } catch {
    // Direct application modals don't have the standard application form
    log.debug(() => '🔍 Standard modal form not found, checking for direct application modal...');
    appeared = false;
  }

  const direct = await checkAndCloseDirectApplicationModal({ commander });
  if (direct.isDirectApplication) {
    return { appeared, directApplication: true, url: direct.url, status: 'direct_application' };
  }

  if (!appeared) {
    console.log('⚠️  Modal did not appear within timeout. This may be a different type of vacancy response.');
    console.log('💡 Skipping this button and moving to the next one...');
    return { appeared, status: 'modal_timeout' };
  }

  if (await hasLimitError({ commander })) {
    return { appeared, limitError: true, status: 'limit_error' };
  }

  return { appeared };
}

/** Statuses of the list button click, as reasons of a skip (skipped-vacancies.mjs) */
const CLICK_SKIP_REASONS = { button_disabled: 'apply_button_disabled', click_error: 'apply_click_failed' };

/**
 * Find and process vacancy buttons on the search page
 * Returns status about what was found and processed; `descriptionRead` tells that the vacancy
 * description was requested, which counts as opening the vacancy for the pacing
 */
export async function findAndProcessVacancyButton({
  commander,
  MESSAGE,
  ignoreVacanciesWithQuestionnaire = false,
  deferredQuestions = null,
  readQADatabase = null,
  addOrUpdateQA = null,
  autoSendExact = false,
  autoSubmit = false,
  onMissingAnswers = 'wait',
  vacancyFilters = null,
  skippedVacancies = null,
  verbose = false,
  waitForUrlCondition,
  START_URL,
  pageClosedByUser,
}) {
  const currentPageUrl = commander.getUrl();
  if (!URL_PATTERNS.searchVacancy.test(currentPageUrl)) {
    // vacancy_response pages are handled by the pageTrigger system in page-triggers.mjs
    log.debug(() => `🔍 Not on target page, waiting for navigation: ${currentPageUrl}`);
    return { status: 'not_on_target_page' };
  }

  const { selector, buttonIndex, vacancyId, status } = await findVacancyButton({ commander });
  if (!selector) {
    return { status };
  }

  // IMPORTANT: Mark the vacancy as processed BEFORE clicking
  // This ensures that even if the click opens a direct application modal
  // that closes without navigating away, the vacancy won't be clicked again
  if (vacancyId) {
    markVacancyAsProcessed(vacancyId);
    log.debug(() => `🔍 Marked vacancy ID ${vacancyId} as processed (total: ${processedVacancyIds.size})`);
  }

  const { lines: cardLines, title } = await readVacancyCard({ commander, selector, buttonIndex });
  const card = cardLines.join('\n');
  // The description only when the card does not settle the filters (one request, see readVacancyDescription)
  const descriptionRead = Boolean(vacancyFilters && vacancyId && await vacancyFilters.needsDescription?.(card));
  const description = descriptionRead ? await readVacancyDescription({ commander, vacancyId }) : '';
  vacancyFilters?.keepDescription?.(vacancyId, description);
  // Checked before the click, so a vacancy filtered out by its card costs no request
  const filterMatch = await vacancyFilters?.match({ vacancy: card, description });
  if (filterMatch) {
    console.log(`🚫 Vacancy ${vacancyId} filtered out by vacancy-filters.lino (${describeFilterMatch(filterMatch)}): ${describeVacancyCard(cardLines)}`);
    await vacancyFilters.remember(vacancyId, filterMatch, { title });
    return { status: 'filtered_out', vacancyId, descriptionRead };
  }
  if (isInteractive()) {
    console.log(`🧪 Applying to ${describeVacancyCard(cardLines)}`);
  }

  const clickResult = await clickVacancyButton({ commander, selector, buttonIndex });
  if (!clickResult.success) {
    if (CLICK_SKIP_REASONS[clickResult.status]) {
      await noteSkip(skippedVacancies, vacancyId, { reason: CLICK_SKIP_REASONS[clickResult.status], title });
    }
    return { status: clickResult.status, vacancyId };
  }

  const navigationResult = await handlePostClickNavigation({ commander, waitForUrlCondition, START_URL, pageClosedByUser });
  if (!navigationResult.onTargetPage) {
    if (navigationResult.status === 'manual_form_completed') {
      // The application went on on another site; listed so its form can be prefilled again
      await noteSkip(skippedVacancies, vacancyId, { reason: 'external_site', title, url: navigationResult.url });
    }
    return { status: navigationResult.status, vacancyId };
  }

  const modalResult = await waitForApplicationModal({ commander });
  if (modalResult.directApplication) {
    await noteSkip(skippedVacancies, vacancyId, {
      reason: 'external_site',
      title,
      url: modalResult.url ?? `https://hh.ru/vacancy/${vacancyId}`,
    });
    console.log(`✅ Direct application skipped, continuing with next vacancy... (${processedVacancyIds.size} vacancies processed in session)`);
    return { status: 'direct_application_skipped', vacancyId };
  }
  if (modalResult.limitError && vacancyId) {
    // Nothing was sent: the vacancy is opened again after the cooldown
    processedVacancyIds.delete(vacancyId);
  }
  if (!modalResult.appeared) {
    await noteSkip(skippedVacancies, vacancyId, { reason: 'modal_timeout', title });
  }
  if (!modalResult.appeared || modalResult.limitError) {
    return { status: modalResult.status, vacancyId };
  }

  let submitResult;
  try {
    submitResult = await processModalApplication({
      commander,
      MESSAGE,
      ignoreVacanciesWithQuestionnaire,
      vacancyId,
      vacancy: card,
      title,
      deferredQuestions,
      readQADatabase,
      addOrUpdateQA,
      autoSendExact,
      autoSubmit,
      onMissingAnswers,
      vacancyFilters,
      skippedVacancies,
      verbose,
    });
  } catch (error) {
    // A wait for a popup element fails once hh.ru has switched to the full form
    if (!(isTimeoutError(error) || isNavigationError(error)) || !isFullFormOpened(commander)) {
      throw error;
    }
    log.debug(() => `Popup step interrupted by the full form: ${error.message.split('\n')[0]}`);
    submitResult = FULL_FORM_OPENED;
  }
  if (submitResult.reason === FULL_FORM_OPENED.reason) {
    console.log('📝 hh.ru replaced the popup with the full application form:', commander.getUrl());
    return { status: 'vacancy_response_detected', vacancyId };
  }
  if (!submitResult.success) {
    return { status: 'modal_processing_failed', reason: submitResult.reason, vacancyId };
  }

  if (await hasLimitError({ commander })) {
    return { status: 'limit_error_after_submit', vacancyId };
  }

  return { status: 'success', vacancyId };
}

/**
 * Find and click the next page link in pagination
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<{found: boolean, clicked?: boolean}>}
 */
async function findAndClickNextPage({ commander }) {
  try {
    const paginationInfo = await commander.evaluate({
      fn: (pagerBlockSelector, pagerPageSelector) => {
        const pageLinks = Array.from(document.querySelector(pagerBlockSelector)?.querySelectorAll(pagerPageSelector) ?? []);
        const currentIndex = pageLinks.findIndex(link => link.getAttribute('aria-current') === 'true');
        if (currentIndex === -1) return null;

        const nextPageLink = pageLinks[currentIndex + 1];
        nextPageLink?.click();
        return { hasNextPage: !!nextPageLink, currentPage: currentIndex + 1, totalPages: pageLinks.length };
      },
      args: [SELECTORS.pagerBlock, SELECTORS.pagerPage],
    });

    if (!paginationInfo) {
      log.debug(() => '🔍 No pagination found on page');
      return { found: false };
    }

    const { hasNextPage, currentPage, totalPages } = paginationInfo;
    if (!hasNextPage) {
      console.log(`📄 On last page (${currentPage}/${totalPages}), no more pages available`);
      return { found: true, clicked: false };
    }

    console.log(`📄 Found pagination: currently on page ${currentPage}/${totalPages}`);
    console.log(`✅ Clicked link to page ${currentPage + 1}, waiting for page to load...`);
    return { found: true, clicked: true };
  } catch (error) {
    if (!isNavigationError(error)) {
      console.log(`⚠️  Error while checking pagination: ${error.message}`);
    }
    return { found: false };
  }
}

/**
 * Wait for buttons to appear after page navigation
 * Stops waiting immediately if navigation is detected (commander.wait is abortable)
 */
export async function waitForButtonsAfterNavigation({ commander, pageClosedByUser }) {
  console.log('💡 No more "Откликнуться" buttons on this page.');

  const paginationResult = await findAndClickNextPage({ commander });
  if (paginationResult.clicked) {
    await commander.wait({ ms: 2000, reason: 'waiting for next page to start loading' });
    return { status: 'navigation_detected' };
  }

  if (paginationResult.found) {
    console.log('💡 All pages have been processed!');
    console.log('💡 You can manually navigate to another search or change filters');
  } else {
    console.log('💡 You can manually navigate to another page (e.g., change filters, go to next page)');
  }
  console.log('💡 The automation will continue once buttons are detected on the new page.');

  const startUrl = commander.getUrl();
  const isNavigating = () => commander.shouldAbort() || commander.navigationManager?.isNavigating();

  while (true) {
    if (pageClosedByUser()) {
      return { status: 'page_closed' };
    }

    const waitResult = await commander.wait({ ms: 2000, reason: 'checking for manual navigation or new buttons' });
    if (waitResult?.aborted || isNavigating() || commander.getUrl() !== startUrl) {
      console.log('🔄 Navigation detected, exiting to let main loop handle new page');
      return { status: 'navigation_detected' };
    }

    // Same URL, check if buttons appeared (e.g., dynamic content loaded)
    try {
      const buttonSelector = await commander.findByText({ text: 'Откликнуться', selector: 'a' });
      const buttonCount = await commander.count({ selector: buttonSelector });
      if (buttonCount > 0) {
        console.log(`✅ Detected ${buttonCount} button(s) appeared on same page! Continuing automation...`);
        return { status: 'buttons_found' };
      }
    } catch (error) {
      if (isNavigationError(error) || isNavigating()) {
        return { status: 'navigation_detected' };
      }
      log.debug(() => `🔍 Error during button search: ${error.message}`);
    }
  }
}
