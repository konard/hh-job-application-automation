/**
 * Main orchestrator module
 * Coordinates the main application loop and state management
 *
 * This module uses the pageTrigger pattern from browser-commander for
 * cleaner, more declarative page handling with automatic lifecycle management.
 *
 * @see https://github.com/konard/hh-job-application-automation/issues/89
 */

import { isNavigationError } from 'browser-commander';
import {
  handleLimitError,
  findAndProcessVacancyButton,
  waitForButtonsAfterNavigation,
} from './vacancies.mjs';
import { log } from './logging.mjs';
import { checkAndRedirectIfNeeded } from './page-handlers.mjs';
import { SESSION_KEYS } from './helpers/session-tracker.mjs';
import { setupPageTriggers } from './page-triggers.mjs';

function getRandomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Create the URL condition wait function
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {Function} options.getPageClosedByUser - Function to check if page was closed
 * @param {Function} options.getIsOnVacancyPageFromResponse - Get tracking flag
 * @param {RegExp} options.vacancyPagePattern - Pattern to match vacancy page URLs
 * @returns {Function} waitForUrlCondition function
 */
export function createWaitForUrlCondition({
  commander,
  getPageClosedByUser,
  getIsOnVacancyPageFromResponse,
  vacancyPagePattern,
}) {
  return async function waitForUrlCondition(targetUrl, description) {
    const pollingInterval = 1000;
    console.log(`Waiting: ${description}...`);

    while (true) {
      if (getPageClosedByUser()) {
        return;
      }

      try {
        // Check if we should redirect (button was clicked on vacancy page)
        const currentUrl = commander.getUrl();
        if (getIsOnVacancyPageFromResponse() && vacancyPagePattern.test(currentUrl)) {
          // Check both sessionStorage flag AND page content for "Вы откликнулись"
          const evalResult = await commander.safeEvaluate({
            fn: (storageKey) => {
              const flag = window.sessionStorage.getItem(storageKey);
              // Normalize whitespace (including nbsp) for matching
              const bodyText = document.body.textContent.replace(/\s+/g, ' ');

              // Check for various response texts (handle nbsp and multiple spaces)
              const hasResponseText = bodyText.includes('Вы откликнулись');
              const hasAlreadyResponded = bodyText.includes('Вы уже откликались');
              const hasResponseSent = bodyText.includes('Отклик отправлен');

              // Find button with "Откликнуться" text
              const buttons = Array.from(document.querySelectorAll('a, button'));
              const respondButton = buttons.find(b => b.textContent.trim() === 'Откликнуться');

              return {
                hasFlag: flag === 'true',
                hasResponseText,
                hasAlreadyResponded,
                hasResponseSent,
                hasRespondButton: !!respondButton,
                // Redirect if flag is set (button was clicked during this session)
                // OR if response text is present (user already responded)
                needsRedirect: flag === 'true' || hasResponseText || hasAlreadyResponded || hasResponseSent,
              };
            },
            args: [SESSION_KEYS.shouldRedirectAfterResponse],
            defaultValue: null,
            operationName: 'redirect check',
          });

          // Skip if navigation occurred
          if (evalResult.navigationError) {
            await commander.wait({ ms: pollingInterval, reason: 'waiting after navigation detected' });
            continue;
          }

          const redirectInfo = evalResult.value;
          if (redirectInfo && getIsOnVacancyPageFromResponse()) {
            log.debug(() => `Checking redirect on vacancy page: ${currentUrl}`);
            log.debug(() => `sessionStorage flag: ${redirectInfo.hasFlag}`);
            log.debug(() => `"Вы откликнулись": ${redirectInfo.hasResponseText}`);
            log.debug(() => `"Вы уже откликались": ${redirectInfo.hasAlreadyResponded}`);
            log.debug(() => `"Отклик отправлен": ${redirectInfo.hasResponseSent}`);
            log.debug(() => `Has "Откликнуться" button: ${redirectInfo.hasRespondButton}`);
          }

          if (redirectInfo && redirectInfo.needsRedirect) {
            if (redirectInfo.hasFlag) {
              console.log('Detected "Откликнуться" button click via sessionStorage flag!');
            } else {
              console.log('Detected application submission via "Вы откликнулись" text on page!');
            }
            // Trigger redirect by returning and letting the caller handle it
            return 'redirect_needed';
          }
        }

        // Check if target URL reached
        const urlCheckResult = await commander.safeEvaluate({
          fn: (url) => window.location.href.startsWith(url),
          args: [targetUrl],
          defaultValue: false,
          operationName: 'URL check',
          silent: true,
        });

        if (urlCheckResult.navigationError) {
          // Navigation happened, continue waiting
          await commander.wait({ ms: pollingInterval, reason: 'waiting after navigation detected' });
          continue;
        }

        if (urlCheckResult.value) {
          return true;
        }
      } catch (error) {
        if (getPageClosedByUser()) {
          return;
        }
        // Handle navigation errors gracefully
        if (isNavigationError(error)) {
          console.log('Navigation detected during URL check, continuing to wait...');
        } else {
          console.log(`Temporary error while checking URL: ${error.message.substring(0, 100)}... (retrying)`);
        }
      }

      await commander.wait({ ms: pollingInterval, reason: 'polling interval before next URL check' });
    }
  };
}

// Note: Periodic Q&A saving is now handled by the vacancy-response-page pageTrigger
// in page-triggers.mjs with proper lifecycle management and automatic cleanup

/**
 * Create the main automation orchestrator
 * @param {Object} options - All configuration options
 * @returns {Object} Orchestrator with start method
 */
export function createOrchestrator({
  commander,
  browser,
  page,
  argv,
  START_URL,
  MESSAGE,
  qaDB,
  targetPagePattern,
  vacancyResponsePattern,
  vacancyPagePattern,
  BUTTON_CLICK_INTERVAL,
  handleVacancyResponsePageWrapper,
  onSearchPageUrlChange = () => {},
}) {
  // State variables
  // Note: Most state is now managed by pageTriggers in page-triggers.mjs
  let pageClosedByUser = false;
  let isOnVacancyPageFromResponse = false;  // Kept for legacy compatibility with redirect check
  let isNavigating = false;  // Kept for redirect check
  let lastSearchPageUrl = START_URL;  // Track the last search page URL for returning after application

  // Getters and setters for state
  const getPageClosedByUser = () => pageClosedByUser;
  const setPageClosedByUser = (value) => { pageClosedByUser = value; };
  const getIsOnVacancyPageFromResponse = () => isOnVacancyPageFromResponse;
  const setIsOnVacancyPageFromResponse = (value) => { isOnVacancyPageFromResponse = value; };
  const getIsNavigating = () => isNavigating;
  const setIsNavigating = (value) => { isNavigating = value; };
  const getLastSearchPageUrl = () => lastSearchPageUrl;
  const setLastSearchPageUrl = (value) => {
    lastSearchPageUrl = value;
    onSearchPageUrlChange(value);
  };

  // Create waitForUrlCondition function
  const waitForUrlCondition = createWaitForUrlCondition({
    commander,
    getPageClosedByUser,
    getIsOnVacancyPageFromResponse,
    vacancyPagePattern,
  });

  // Note: Navigation and click listener handlers are now managed by pageTriggers
  // in page-triggers.mjs with proper lifecycle management

  // Wrapper for redirect check
  // Note: This is kept for compatibility - the pageTriggers also handle redirects
  // but this provides an additional check in the main loop
  const checkRedirect = () => checkAndRedirectIfNeeded({
    commander,
    getIsOnVacancyPageFromResponse,
    setIsOnVacancyPageFromResponse,
    getIsNavigating,
    setIsNavigating,
    setClickListenerInstalled: () => {}, // No-op - managed by pageTriggers
    setLastVacancyPageUrl: () => {}, // No-op - managed by pageTriggers
    START_URL,
    getLastSearchPageUrl,  // Pass the getter to use tracked URL
  });

  return {
    /**
     * Start the main automation loop
     */
    async start() {
      // Setup page close handler
      page.on('close', async () => {
        setPageClosedByUser(true);
        console.log('Tab close detected! Page was closed by user.');
        console.log('Closing browser gracefully...');
        try {
          await browser.close();
          console.log('Browser closed successfully');
        } catch (error) {
          console.error('Error closing browser:', error.message);
        }
        process.exit(0);
      });

      // Handle manual login if requested
      if (argv.manualLogin) {
        const backurl = encodeURIComponent(START_URL);
        const loginUrl = `https://hh.ru/account/login?role=applicant&backurl=${backurl}&hhtmFrom=vacancy_search_list`;

        console.log('Opening login page for manual authentication...');
        console.log('Login URL:', loginUrl);

        await commander.goto({ url: loginUrl, waitForStableUrlBefore: false });

        console.log('The browser will automatically continue once you are redirected to:', START_URL);

        await waitForUrlCondition(START_URL, 'Waiting for you to complete login');

        if (!getPageClosedByUser()) {
          console.log('Login successful! Proceeding with automation...');
        }
      } else {
        await commander.goto({ url: START_URL, waitForStableUrlBefore: false });
      }

      // Setup page triggers for declarative page handling
      // This replaces the manual onUrlChange handlers with the pageTrigger pattern
      const { cleanup: cleanupTriggers } = setupPageTriggers({
        commander,
        qaDB,
        handleVacancyResponsePageWrapper,
        START_URL,
        setIsOnVacancyPageFromResponse,
        setLastSearchPageUrl,  // Track the last search page for returning after application
      });

      process.on('exit', () => cleanupTriggers());

      // Check if already on vacancy_response page
      // Note: The pageTrigger will handle this page, but we need to wait for
      // the page to be ready first
      const currentUrl = commander.getUrl();
      if (vacancyResponsePattern.test(currentUrl)) {
        // Wait a bit for pageTrigger to start
        await commander.wait({ ms: 500, reason: 'waiting for page trigger to initialize' });
        console.log('Initial vacancy_response page detected. PageTrigger will handle it...');
      }

      // Main loop
      await this.runMainLoop();
    },

    /**
     * Run the main automation loop
     */
    async runMainLoop() {
      while (true) {
        // STEP 1: Ensure page is fully loaded
        const shouldWaitForPage = (
          (commander.navigationManager && commander.navigationManager.isNavigating()) ||
          (commander.shouldAbort && commander.shouldAbort())
        );

        if (shouldWaitForPage) {
          console.log('Page is loading, waiting for it to be fully ready...');
          await commander.waitForPageReady({ timeout: 120000, reason: 'ensuring page is ready before automation' });

          const currentUrl = commander.getUrl();
          console.log(`Page ready: ${currentUrl.substring(0, 80)}...`);
        }

        // STEP 2: Check for page-closed condition
        if (getPageClosedByUser()) {
          return;
        }

        // STEP 3: Handle redirect logic
        const didRedirect = await checkRedirect();
        if (didRedirect) {
          await commander.waitForPageReady({ timeout: 120000, reason: 'after redirect' });
          continue;
        }

        // STEP 4: Verify we're still on a stable page
        if (commander.shouldAbort && commander.shouldAbort()) {
          continue;
        }

        // STEP 5: Wait for modals to close
        try {
          await commander.evaluate({
            fn: () => {
              const modal = document.querySelector('[data-qa="modal-overlay"]');
              if (modal) {
                console.log('[Main Loop] Waiting for modal to close...');
              }
            },
          });

          await new Promise(r => setTimeout(r, 500));
        } catch {
          // Ignore errors - might happen during navigation
        }

        if (commander.shouldAbort && commander.shouldAbort()) {
          continue;
        }

        // STEP 6: Process vacancy buttons
        const result = await findAndProcessVacancyButton({
          commander,
          MESSAGE,
          ignoreVacanciesWithQuestionnaire: argv.ignoreVacanciesWithQuestionnaire,
          targetPagePattern,
          vacancyResponsePattern,
          handleVacancyResponsePage: handleVacancyResponsePageWrapper,
          waitForUrlCondition,
          START_URL,
          pageClosedByUser: getPageClosedByUser,
        });

        // STEP 7: Handle result
        if (result.status === 'navigation_detected') {
          console.log('Navigation detected during processing, restarting with new page context...');
          continue;
        }

        if (result.status === 'not_on_target_page') {
          console.log('Not on target page, waiting for page to be ready...');
          await commander.waitForPageReady({ timeout: 120000, reason: 'not on target page' });
          continue;
        }

        if (result.status === 'no_buttons_found') {
          const waitResult = await waitForButtonsAfterNavigation({
            commander,
            pageClosedByUser: getPageClosedByUser,
          });

          if (waitResult.status === 'page_closed') {
            return;
          }

          if (waitResult.status === 'navigation_detected') {
            console.log('Navigation detected, waiting for new page to be fully loaded...');
            await commander.waitForPageReady({ timeout: 120000, reason: 'after navigation in button wait' });
          }

          continue;
        }

        if (result.status === 'limit_error' || result.status === 'limit_error_after_submit') {
          await handleLimitError({ commander, START_URL });
          continue;
        }

        if (result.status === 'direct_application_skipped') {
          console.log('✅ Direct application skipped, continuing with next vacancy...');
          // Don't wait the full interval for skipped applications
          await commander.wait({ ms: 1000, reason: 'brief pause after skipping direct application' });
          continue;
        }

        if (result.status === 'success') {
          const randomExtraDelaySeconds = getRandomIntInclusive(1, 5);
          const totalWaitMs = BUTTON_CLICK_INTERVAL + randomExtraDelaySeconds * 1000;

          console.log(
            `Waiting ${totalWaitMs / 1000} seconds before processing next button ` +
            `(base ${BUTTON_CLICK_INTERVAL / 1000}s + random ${randomExtraDelaySeconds}s)...`,
          );

          const intervalWait = await commander.wait({
            ms: totalWaitMs,
            reason: 'interval before next application',
          });

          if (intervalWait && intervalWait.aborted) {
            console.log('Interval wait was interrupted by navigation');
          }
        }
      }
    },
  };
}
