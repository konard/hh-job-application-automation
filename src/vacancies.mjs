/**
 * Vacancy list processing module
 * Handles finding and clicking "Откликнуться" buttons in vacancy lists
 */

import { isNavigationError } from 'browser-commander';
import { countUnansweredQuestions } from './qa.mjs';
import { closeModalIfPresent, checkAndCloseDirectApplicationModal } from './helpers/modal-helpers.mjs';
import { closeChatPanel, findCoverLetterToggle, isButtonEnabled, rememberIgnoredVacancy } from './helpers/page-helpers.mjs';
import { SELECTORS, URL_PATTERNS } from './hh-selectors.mjs';
import { log } from './logging.mjs';
import { isInteractive, waitForUser } from './confirmations.mjs';

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

/**
 * Process modal application form
 * Fills cover letter and handles test questions in modal
 */
export async function processModalApplication({
  commander,
  MESSAGE,
  ignoreVacanciesWithQuestionnaire = false,
  vacancyId = null,
  addIgnoredVacancyId = async () => false,
}) {
  const textareaSelector = SELECTORS.coverLetterTextareaPopup;

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

  if (MESSAGE) {
    const { filled, verified, actualValue } = await commander.fillTextArea({
      selector: textareaSelector,
      text: MESSAGE,
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
      console.error('Expected:', MESSAGE);
      console.error('Actual:', actualValue);
    }
  }

  const { totalCount, unansweredCount } = await countUnansweredQuestions({
    evaluate: commander.evaluate,
    containerSelector: SELECTORS.applicationForm,
  });
  const modalTextareaCount = await commander.count({ selector: `${SELECTORS.applicationForm} textarea` });

  if (ignoreVacanciesWithQuestionnaire && (totalCount > 0 || modalTextareaCount > 1)) {
    console.log('⚠️  Detected questionnaire fields in modal application form');
    console.log('💡 --ignore-vacancies-with-questionnaire is enabled, skipping this vacancy');
    await rememberIgnoredVacancy(addIgnoredVacancyId, vacancyId);
    return skipModal({ commander, reason: 'questionnaire_ignored' });
  }

  // In interactive runs the user answers instead of the vacancy being skipped
  let open = unansweredCount;
  while (open > 0 && isInteractive()) {
    await waitForUser(`Answer the ${open} open question(s) in the application popup`);
    ({ unansweredCount: open } = await countUnansweredQuestions({
      evaluate: commander.evaluate,
      containerSelector: SELECTORS.applicationForm,
    }));
  }

  if (open > 0) {
    console.log(`⚠️  Found ${open} UNANSWERED test question(s) in modal`);
    console.log('💡 Skipping this vacancy - cannot auto-submit when test questions remain unanswered');
    return skipModal({ commander, reason: 'unanswered_questions' });
  }

  const submitButtonSelector = SELECTORS.submitButtonPopup;
  if (await commander.count({ selector: submitButtonSelector }) === 0) {
    console.error(`❌ Submit button not found in modal! Tried selector: ${submitButtonSelector}`);
    await logModalText({ commander, title: '📋 Modal content:' });
    console.error('💡 Closing modal and skipping this vacancy...');
    return skipModal({ commander, reason: 'button_not_found' });
  }

  while (isInteractive() && !await isButtonEnabled(commander, submitButtonSelector)) {
    await logModalText({ commander, title: '📋 The send button is disabled; the popup says:' });
    await waitForUser('Fix the application popup so it can be sent');
  }

  if (!await isButtonEnabled(commander, submitButtonSelector)) {
    console.error('❌ Application button is still disabled after entering the message!');
    await logModalText({ commander, title: '📋 Reason from modal:' });
    console.error('💡 Closing modal and skipping this vacancy...');
    return skipModal({ commander, reason: 'button_disabled' });
  }

  try {
    await commander.clickButton({ selector: submitButtonSelector, scrollIntoView: false, timeout: 10000 });
    console.log(`✅ ${commander.engine}: clicked submit button`);
  } catch (error) {
    if (isNavigationError(error)) {
      console.log('⚠️  Navigation detected while submitting, continuing...');
      return { success: false, reason: 'navigation_detected' };
    }
    console.error(`❌ Failed to click submit button: ${error.message}`);
    console.error('💡 Closing modal and skipping this vacancy...');
    return skipModal({ commander, reason: 'click_failed' });
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
  });
}

/**
 * Title and company of the vacancy card holding the button at the given index
 * @returns {Promise<string>}
 */
async function describeVacancyCard({ commander, selector, buttonIndex }) {
  const { value } = await commander.safeEvaluate({
    fn: (baseSelector, index) => {
      let card = document.querySelectorAll(baseSelector)[index];
      while (card && !card.querySelector('a[href*="/vacancy/"]')) {
        card = card.parentElement;
      }
      const text = card?.innerText.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 4).join(' | ');
      return text || null;
    },
    args: [selector, buttonIndex],
    defaultValue: null,
    operationName: 'vacancy card description',
  });
  return value ? `"${value}"` : 'the next vacancy';
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
 * @returns {Promise<{onTargetPage: boolean, status?: string}>}
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
  return { onTargetPage: false, status: 'manual_form_completed' };
}

/**
 * Count limit error popups (200 applications in 24 hours)
 */
async function hasLimitError({ commander }) {
  return await commander.count({ selector: SELECTORS.limitExceededError }) > 0;
}

/**
 * Wait for application modal to appear and check for limit errors
 * @returns {Promise<{appeared: boolean, limitError?: boolean, directApplication?: boolean, status?: string}>}
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

  if ((await checkAndCloseDirectApplicationModal({ commander })).isDirectApplication) {
    return { appeared, directApplication: true, status: 'direct_application' };
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

/**
 * Find and process vacancy buttons on the search page
 * Returns status about what was found and processed
 */
export async function findAndProcessVacancyButton({
  commander,
  MESSAGE,
  ignoreVacanciesWithQuestionnaire = false,
  addIgnoredVacancyId = async () => false,
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

  if (isInteractive()) {
    console.log(`🧪 Applying to ${await describeVacancyCard({ commander, selector, buttonIndex })}`);
  }

  const clickResult = await clickVacancyButton({ commander, selector, buttonIndex });
  if (!clickResult.success) {
    return { status: clickResult.status, vacancyId };
  }

  const navigationResult = await handlePostClickNavigation({ commander, waitForUrlCondition, START_URL, pageClosedByUser });
  if (!navigationResult.onTargetPage) {
    return { status: navigationResult.status, vacancyId };
  }

  const modalResult = await waitForApplicationModal({ commander });
  if (modalResult.directApplication) {
    console.log(`✅ Direct application skipped, continuing with next vacancy... (${processedVacancyIds.size} vacancies processed in session)`);
    return { status: 'direct_application_skipped', vacancyId };
  }
  if (!modalResult.appeared || modalResult.limitError) {
    return { status: modalResult.status, vacancyId };
  }

  const submitResult = await processModalApplication({
    commander,
    MESSAGE,
    ignoreVacanciesWithQuestionnaire,
    vacancyId,
    addIgnoredVacancyId,
  });
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
