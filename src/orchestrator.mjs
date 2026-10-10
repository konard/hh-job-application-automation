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
import { findSuggestedVacanciesUrl, latestResumeSearchUrl } from './resumes.mjs';
import { checkpoint } from './tracing.mjs';
import { URL_PATTERNS } from './hh-selectors.mjs';
import { log } from './logging.mjs';
import { isInteractive, waitForUser } from './confirmations.mjs';
import { pauseMs } from './pacing.mjs';

const PAGE_READY_TIMEOUT = 120000;


/**
 * Create the main automation orchestrator
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.page - Raw engine page
 * @param {Object} options.argv - Parsed configuration
 * @param {Object} options.qaDB - { readQADatabase, addOrUpdateQA, addIgnoredVacancyId }
 * @param {Object} [options.deferredQuestions] - Questions answered later (deferred-questions.mjs)
 * @param {Object} [options.vacancyFilters] - Vacancies filtered out automatically (vacancy-filters.mjs)
 * @param {Function} options.onPageClosed - Called when the user closes the tab
 * @returns {Object} Orchestrator with start method
 */
export function createOrchestrator({
  commander, page, argv, qaDB, deferredQuestions = null, vacancyFilters = null, onPageClosed,
  onApplicationSent = async () => {},
}) {
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

  // Applications already counted, since one can be detected by several handlers
  const sentVacancyIds = new Set();
  // The next application waits until then, so the load on hh.ru stays low
  let nextApplicationAt = 0;

  /**
   * Schedule the next vacancy (see pacing.mjs), so the load on hh.ru stays low
   * @param {string} reason - What was just done, for the log
   */
  function scheduleNextApplication(reason) {
    const totalWaitMs = pauseMs({ intervalMs: BUTTON_CLICK_INTERVAL });
    nextApplicationAt = Math.max(nextApplicationAt, Date.now() + totalWaitMs);
    console.log(`⏳ ${reason}; next vacancy in ${totalWaitMs / 1000} seconds`);
  }

  /**
   * Count a sent application once, checkpoint the trace and schedule the next vacancy
   * @param {string|null} vacancyId
   * @returns {Promise<boolean>} False when the application was already counted
   */
  async function afterApplicationSent(vacancyId = null) {
    if (vacancyId) {
      if (sentVacancyIds.has(vacancyId)) {
        return false;
      }
      sentVacancyIds.add(vacancyId);
      // It no longer waits for an answer
      await deferredQuestions?.forget(vacancyId)
        .catch((error) => console.error('Error updating deferred-questions.lino:', error.message));
    }
    await checkpoint('application-sent');
    scheduleNextApplication('Application sent');
    await onApplicationSent();
    return true;
  }

  /**
   * Wait until the next application may be sent
   */
  async function waitForApplicationSlot() {
    const ms = nextApplicationAt - Date.now();
    if (ms > 0) {
      await commander.wait({ ms, reason: 'interval before next application' });
    }
  }

  const vacancyResponseHandler = () => handleVacancyResponsePage({
    commander,
    MESSAGE: argv.message,
    readQADatabase: qaDB.readQADatabase,
    addOrUpdateQA: qaDB.addOrUpdateQA,
    addIgnoredVacancyId: qaDB.addIgnoredVacancyId,
    // In interactive runs the user answers on stdin, so the form is submitted after that
    autoSubmitEnabled: argv.autoSubmitVacancyResponseForm || isInteractive(),
    onMissingAnswers: argv.onMissingAnswers,
    ignoreVacanciesWithQuestionnaire: argv.ignoreVacanciesWithQuestionnaire,
    returnUrl: lastSearchPageUrl,
    onApplicationSent: afterApplicationSent,
    deferredQuestions,
    autoSendExact: argv.autoSendExactAnswers,
    vacancyFilters,
    verbose: argv.verbose,
  });

  /**
   * Handle one result of findAndProcessVacancyButton
   * @returns {Promise<boolean>} False when the loop should stop
   */
  async function handleResult(result) {
    switch (result.status) {
    case 'navigation_detected':
      console.log('Navigation detected during processing, restarting with new page context...');
      return true;
    case 'not_on_target_page':
      log.debug(() => 'Not on the vacancy list, waiting for the page to be ready...');
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
      await afterApplicationSent(result.vacancyId);
      return true;
    case 'modal_processing_failed':
      if (result.reason === 'not_confirmed') {
        // Never move on to the next vacancy while hh.ru shows something unexpected
        const message = `hh.ru did not confirm the application to vacancy ${result.vacancyId}. ` +
          'Check the browser (an error, a captcha, a message)';
        if (!isInteractive()) {
          throw new Error(`${message}; stopping so that nothing else is sent`);
        }
        await waitForUser(`${message}, then`);
      }
      return true;
    default:
      return true;
    }
  }

  /** Statuses after which no vacancy was opened, so no pause is needed */
  const NO_VACANCY_OPENED = new Set(['not_on_target_page', 'no_buttons_found', 'filtered_out']);

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
          // The kept-open browser already shows suggested vacancies: keep its filters, check the resume
          ? await latestResumeSearchUrl(commander, commander.getUrl())
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
          isOnVacancyPageFromResponse = false;
          return afterApplicationSent(vacancyId);
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
          log.debug(() => 'Page is loading, waiting for it to be fully ready...');
          await waitForPageReady('ensuring page is ready before automation');
          log.debug(() => `Page ready: ${commander.getUrl()}`);
          continue;
        }

        // Safety net: redirect back after an application sent from a vacancy page
        if (await checkAndRedirectIfNeeded({
          commander, isOnVacancyPageFromResponse, returnUrl: lastSearchPageUrl, onApplicationSent: afterApplicationSent,
        })) {
          isOnVacancyPageFromResponse = false;
          await waitForPageReady('after redirect');
          continue;
        }

        if (Date.now() < nextApplicationAt) {
          await waitForApplicationSlot();
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
          deferredQuestions,
          readQADatabase: qaDB.readQADatabase,
          autoSendExact: argv.autoSendExactAnswers,
          vacancyFilters,
          waitForUrlCondition,
          START_URL,
          pageClosedByUser: getPageClosedByUser,
        });

        if (!NO_VACANCY_OPENED.has(result.status) && result.status !== 'success') {
          scheduleNextApplication(`Vacancy ${result.vacancyId ?? ''} opened (${result.status}${result.reason ? `: ${result.reason}` : ''})`);
        }
        if (!await handleResult(result)) {
          return;
        }
      }
    },
  };
}
