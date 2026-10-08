/**
 * Main orchestrator module
 * Coordinates the main application loop and state management
 *
 * This module uses the pageTrigger pattern from browser-commander for
 * cleaner, more declarative page handling with automatic lifecycle management.
 *
 * @see https://github.com/konard/hh-job-application-automation/issues/89
 */

import {
  handleLimitError,
  findAndProcessVacancyButton,
  waitForButtonsAfterNavigation,
} from './vacancies.mjs';
import { handleVacancyResponsePage } from './vacancy-response.mjs';
import { checkAndRedirectIfNeeded } from './page-handlers.mjs';
import { dismissOverlays, isResponseSubmitted } from './helpers/page-helpers.mjs';
import { registerPageTriggers } from './page-triggers.mjs';
import { ensureLoggedIn } from './login.mjs';
import { findSuggestedVacanciesUrl } from './resumes.mjs';
import { checkpoint } from './tracing.mjs';
import { URL_PATTERNS } from './hh-selectors.mjs';

const PAGE_READY_TIMEOUT = 120000;

function getRandomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Create the main automation orchestrator
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.page - Raw engine page
 * @param {Object} options.argv - Parsed configuration
 * @param {Object} options.qaDB - { readQADatabase, addOrUpdateQA, addIgnoredVacancyId }
 * @param {Function} options.onPageClosed - Called when the user closes the tab
 * @returns {Object} Orchestrator with start method
 */
export function createOrchestrator({ commander, page, argv, qaDB, onPageClosed }) {
  let START_URL = argv.url;
  const BUTTON_CLICK_INTERVAL = argv.jobApplicationInterval * 1000;

  let pageClosedByUser = false;
  let isOnVacancyPageFromResponse = false;
  // The last search page (may include pagination) to return to after an application
  let lastSearchPageUrl = START_URL;

  const getPageClosedByUser = () => pageClosedByUser;
  const waitForPageReady = (reason) => commander.waitForPageReady({ timeout: PAGE_READY_TIMEOUT, reason });

  /**
   * Wait until the URL starts with targetUrl. Returns 'redirect_needed' early when an
   * application was sent from a vacancy page opened from vacancy_response.
   */
  const waitForUrlCondition = (targetUrl, description) => commander.waitForUrlCondition({
    targetUrl,
    description,
    pageClosedCallback: getPageClosedByUser,
    customCheck: async (currentUrl) => {
      if (!isOnVacancyPageFromResponse || !URL_PATTERNS.vacancyPage.test(currentUrl)) {
        return null;
      }
      // The sessionStorage click flag is left for checkAndRedirectIfNeeded in the main loop
      if (await isResponseSubmitted(commander)) {
        console.log('Detected application submission via "Вы откликнулись" text on page!');
        return 'redirect_needed';
      }
      return null;
    },
  });

  /**
   * Checkpoint the trace, then wait 1-2 intervals so the load on hh.ru stays low
   */
  async function afterApplicationSent() {
    await checkpoint('application-sent');
    const randomExtraDelaySeconds = getRandomIntInclusive(0, BUTTON_CLICK_INTERVAL / 1000);
    const totalWaitMs = BUTTON_CLICK_INTERVAL + randomExtraDelaySeconds * 1000;
    console.log(
      `Waiting ${totalWaitMs / 1000} seconds before processing next button ` +
        `(base ${BUTTON_CLICK_INTERVAL / 1000}s + random ${randomExtraDelaySeconds}s)...`,
    );
    const intervalWait = await commander.wait({ ms: totalWaitMs, reason: 'interval before next application' });
    if (intervalWait?.aborted) {
      console.log('Interval wait was interrupted by navigation');
    }
  }

  const vacancyResponseHandler = () => handleVacancyResponsePage({
    commander,
    MESSAGE: argv.message,
    readQADatabase: qaDB.readQADatabase,
    addOrUpdateQA: qaDB.addOrUpdateQA,
    addIgnoredVacancyId: qaDB.addIgnoredVacancyId,
    autoSubmitEnabled: argv.autoSubmitVacancyResponseForm,
    ignoreVacanciesWithQuestionnaire: argv.ignoreVacanciesWithQuestionnaire,
    returnUrl: lastSearchPageUrl,
    onApplicationSent: afterApplicationSent,
    verbose: argv.verbose,
  });

  /**
   * Handle one result of findAndProcessVacancyButton
   * @returns {Promise<boolean>} False when the loop should stop
   */
  async function handleResult({ status }) {
    switch (status) {
    case 'navigation_detected':
      console.log('Navigation detected during processing, restarting with new page context...');
      return true;
    case 'not_on_target_page':
      console.log('Not on target page, waiting for page to be ready...');
      await waitForPageReady('not on target page');
      return true;
    case 'no_buttons_found': {
      const waitResult = await waitForButtonsAfterNavigation({ commander, pageClosedByUser: getPageClosedByUser });
      if (waitResult.status === 'navigation_detected') {
        console.log('Navigation detected, waiting for new page to be fully loaded...');
        await waitForPageReady('after navigation in button wait');
      }
      return waitResult.status !== 'page_closed';
    }
    case 'limit_error':
    case 'limit_error_after_submit':
      await handleLimitError({ commander, START_URL });
      return true;
    case 'direct_application_skipped':
      await commander.wait({ ms: 1000, reason: 'brief pause after skipping direct application' });
      return true;
    case 'success':
      await afterApplicationSent();
      return true;
    default:
      return true;
    }
  }

  return {
    /**
     * Start the main automation loop
     */
    async start() {
      page.on('close', () => {
        pageClosedByUser = true;
        onPageClosed();
      });

      await ensureLoggedIn({ commander, page, argv, isPageClosed: getPageClosedByUser });
      if (pageClosedByUser) {
        return;
      }
      await checkpoint('logged-in');

      if (!START_URL) {
        START_URL = URL_PATTERNS.searchVacancy.test(commander.getUrl()) && commander.getUrl().includes('resume=')
          ? commander.getUrl() // The kept-open browser already shows suggested vacancies
          : await findSuggestedVacanciesUrl(commander);
        if (!START_URL) {
          throw new Error('No resume found on hh.ru - create one or pass --url');
        }
        lastSearchPageUrl = START_URL;
      }
      if (commander.getUrl() !== START_URL) {
        await commander.goto({ url: START_URL, waitForStableUrlBefore: false });
      }
      await dismissOverlays(commander);

      // Declarative page handling (vacancy_response, vacancy and search pages)
      const cleanupTriggers = registerPageTriggers({
        commander,
        addOrUpdateQA: qaDB.addOrUpdateQA,
        handleVacancyResponsePage: vacancyResponseHandler,
        onVacancyPageFromResponse: (vacancyId) => {
          console.log(`Setting flag isOnVacancyPageFromResponse = true (vacancy ID: ${vacancyId})`);
          isOnVacancyPageFromResponse = true;
        },
        onApplicationSubmitted: (vacancyId) => {
          console.log(`Application submitted for vacancy ${vacancyId}, clearing state`);
          isOnVacancyPageFromResponse = false;
        },
        onSearchPageVisited: (url) => {
          lastSearchPageUrl = url;
        },
        getReturnUrl: () => lastSearchPageUrl,
      });
      process.on('exit', cleanupTriggers);

      await this.runMainLoop();
    },

    /**
     * Run the main automation loop
     */
    async runMainLoop() {
      while (!pageClosedByUser) {
        // Ensure page is fully loaded
        if (commander.navigationManager?.isNavigating() || commander.shouldAbort()) {
          console.log('Page is loading, waiting for it to be fully ready...');
          await waitForPageReady('ensuring page is ready before automation');
          console.log(`Page ready: ${commander.getUrl().substring(0, 80)}...`);
          continue;
        }

        // Safety net: redirect back after an application sent from a vacancy page
        if (await checkAndRedirectIfNeeded({ commander, isOnVacancyPageFromResponse, returnUrl: lastSearchPageUrl })) {
          isOnVacancyPageFromResponse = false;
          await waitForPageReady('after redirect');
          continue;
        }

        await commander.wait({ ms: 500, reason: 'settle before processing vacancy buttons' });
        await dismissOverlays(commander);
        if (commander.shouldAbort()) {
          continue;
        }

        const result = await findAndProcessVacancyButton({
          commander,
          MESSAGE: argv.message,
          ignoreVacanciesWithQuestionnaire: argv.ignoreVacanciesWithQuestionnaire,
          addIgnoredVacancyId: qaDB.addIgnoredVacancyId,
          waitForUrlCondition,
          START_URL,
          pageClosedByUser: getPageClosedByUser,
        });

        if (!await handleResult(result)) {
          return;
        }
      }
    },
  };
}
