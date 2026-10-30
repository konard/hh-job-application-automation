/**
 * Page Triggers - Declarative page handlers using the pageTrigger pattern
 *
 * This module implements the pageTrigger pattern from browser-commander for
 * cleaner, more declarative page handling with automatic lifecycle management:
 * - Automatic action start/stop lifecycle management
 * - Built-in AbortController support for cancellation
 * - Automatic cleanup when navigating away
 *
 * @see https://github.com/konard/hh-job-application-automation/issues/89
 */

import { makeUrlCondition } from 'browser-commander';
import { readQAPairs, savePairs } from './vacancy-response.mjs';
import { log } from './logging.mjs';
import { createApplyButtonTracker } from './helpers/session-tracker.mjs';
import { isResponseSubmitted } from './helpers/page-helpers.mjs';
import { URL_PATTERNS, extractVacancyIdFromResponseUrl, extractVacancyId } from './hh-selectors.mjs';
import { withdrawPrompt } from './confirmations.mjs';

/**
 * Save the answers typed into the full form as they are typed, so what the user answers in the browser
 * is learned (qa.lino) also when they send it themselves
 * @returns {() => Promise<void>} Stops the saving after a last save
 */
export function saveFormAnswers({ commander, addOrUpdateQA }) {
  // Read every second, written once an answer stops changing: the last read is written when
  // the form is sent, since by then the page is gone (a save after it lost the last words typed)
  let lastRead = null;
  let previous = '';
  const save = async (pairs, reason) => {
    const count = pairs ? await savePairs(pairs, addOrUpdateQA) : 0;
    if (count > 0) {
      console.log(`Saved ${count} Q&A pair(s) ${reason}`);
    }
  };
  const interval = setInterval(async () => {
    const pairs = await readQAPairs({ commander }).catch(() => null);
    if (!pairs) {
      return;
    }
    const now = JSON.stringify(pairs);
    lastRead = pairs;
    if (now === previous) {
      await save(pairs, '(auto-save)').catch(() => {});
    }
    previous = now;
  }, 1000);
  return async () => {
    clearInterval(interval);
    await save(await readQAPairs({ commander }).catch(() => null) ?? lastRead, 'before navigation').catch((error) => {
      log.debug(() => `⚠️ Error saving Q&A on cleanup: ${error.message}`);
    });
  };
}

/**
 * Register all page triggers for the HH.ru automation
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.commander - Browser commander instance
 * @param {Function} options.addOrUpdateQA - Function to save Q&A pairs
 * @param {Function} options.handleVacancyResponsePage - Handler for vacancy response page
 * @param {Function} options.onVacancyPageFromResponse - Callback when navigating to vacancy from response
 * @param {Function} options.onApplicationSubmitted - Called with the vacancy ID when an application was sent from the vacancy page
 * @param {Function} options.onSearchPageVisited - Callback when search page URL changes (for tracking pagination)
 * @param {Function} options.getReturnUrl - Returns the URL to go back to after submission
 * @returns {Function} Cleanup function to unregister all triggers
 */
export function registerPageTriggers({
  commander,
  addOrUpdateQA,
  handleVacancyResponsePage,
  onVacancyPageFromResponse = () => {},
  onApplicationSubmitted = () => {},
  onSearchPageVisited = () => {},
  getReturnUrl,
}) {
  // ID of the vacancy whose vacancy_response page was visited last
  let lastVacancyResponseId = null;

  /**
   * An application was sent and hh.ru opened its vacancy page: count it once and go back
   * to the vacancy list right away
   */
  const returnAfterSent = async (vacancyId) => {
    if (lastVacancyResponseId !== vacancyId) {
      return; // Already handled
    }
    lastVacancyResponseId = null;
    const counted = await onApplicationSubmitted(vacancyId);
    if (counted !== false) console.log(`✅ Application sent for vacancy ${vacancyId}`);
    // Already counted does not mean already left. Only skip navigation when the page itself
    // changed; never pull the user away from a newly opened form or chat.
    if (!URL_PATTERNS.vacancyPage.test(commander.getUrl()) || extractVacancyId(commander.getUrl()) !== vacancyId) return;
    const returnUrl = getReturnUrl();
    console.log(`Returning to: ${returnUrl}`);
    // Not awaited: the navigation stops the running page action
    commander.goto({ url: returnUrl, waitForStableUrlBefore: false }).catch(() => {});
  };

  /**
   * Page actions start only once the page is idle, which takes half a minute on hh.ru
   * vacancy pages, so the sent application is detected as soon as the URL changes.
   * browser-commander 0.28's `readyOn: 'domcontentloaded'` does not replace this watch: it
   * starts on full page loads only (hh.ru opens the vacancy page in place), and a start is
   * dropped while the form action still runs
   */
  const watchVacancyPage = async (vacancyId) => {
    for (let second = 0; second < 30 && lastVacancyResponseId === vacancyId; second++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (extractVacancyId(commander.getUrl()) !== vacancyId) {
        return;
      }
      if (await isResponseSubmitted(commander)) {
        return returnAfterSent(vacancyId);
      }
    }
  };

  const unregisterVacancyResponse = commander.pageTrigger({
    name: 'vacancy-response-page',
    priority: 10,
    // The trigger can fire again on the same page while the handler still runs: skipped
    concurrency: 'skip',
    condition: makeUrlCondition(URL_PATTERNS.vacancyResponse),
    action: async (ctx) => {
      log.debug(() => `📋 [vacancy-response-page] Action started for: ${ctx.url}`);
      lastVacancyResponseId = extractVacancyIdFromResponseUrl(ctx.url) ?? lastVacancyResponseId;

      // Periodic Q&A save, plus a final save when leaving the page
      const stopSaving = saveFormAnswers({ commander, addOrUpdateQA });
      ctx.onCleanup(async () => {
        // The form was sent or left in the browser, so a question on stdin no longer applies
        withdrawPrompt();
        await stopSaving();
      });

      try {
        await handleVacancyResponsePage();
      } catch (error) {
        if (!commander.isActionStoppedError(error)) {
          console.error('Error in vacancy response handler:', error.message);
        }
      }
    },
  });

  const unregisterVacancyPage = commander.pageTrigger({
    name: 'vacancy-page',
    priority: 5,
    condition: makeUrlCondition(URL_PATTERNS.vacancyPage),
    action: async (ctx) => {
      const vacancyId = extractVacancyId(ctx.url);
      if (!vacancyId || vacancyId !== lastVacancyResponseId) {
        return;
      }

      console.log(`Navigated to vacancy details page (ID: ${vacancyId}) from vacancy_response`);
      onVacancyPageFromResponse(vacancyId);

      const buttonTracker = createApplyButtonTracker(commander);
      if (await buttonTracker.install()) {
        console.log('Click listener installed for vacancy page');
      }

      // hh.ru opens the vacancy page after the form is sent (also when the user sent it in
      // the browser), or the user sends it from here with the "Откликнуться" button
      while (!ctx.isStopped() && lastVacancyResponseId === vacancyId) {
        if (await buttonTracker.checkAndClear()) {
          console.log('Detected "Откликнуться" button was clicked on vacancy page!');
        }
        if (await isResponseSubmitted(commander)) {
          return returnAfterSent(vacancyId);
        }
        await ctx.wait(2000);
      }
    },
  });

  const unregisterSearchPage = commander.pageTrigger({
    name: 'search-page',
    priority: 3,
    condition: makeUrlCondition(URL_PATTERNS.searchVacancy),
    action: (ctx) => onSearchPageVisited(ctx.url),
  });

  // Track in-page navigation (e.g., pagination) and forget the vacancy_response
  // tracking when navigating somewhere other than its vacancy page
  const onUrlChange = ({ previousUrl, newUrl }) => {
    // A question about the form must not outlive it: its answer would act on another page
    if (URL_PATTERNS.vacancyResponse.test(previousUrl ?? '') && !URL_PATTERNS.vacancyResponse.test(newUrl)) {
      withdrawPrompt();
    }
    if (URL_PATTERNS.searchVacancy.test(newUrl)) {
      onSearchPageVisited(newUrl);
    }
    // Also when its trigger does not start (the main loop then fills the form itself)
    if (URL_PATTERNS.vacancyResponse.test(newUrl)) {
      lastVacancyResponseId = extractVacancyIdFromResponseUrl(newUrl) ?? lastVacancyResponseId;
    }
    if (lastVacancyResponseId && extractVacancyId(newUrl) === lastVacancyResponseId) {
      watchVacancyPage(lastVacancyResponseId).catch((error) => {
        log.debug(() => `Vacancy page watch failed: ${error.message}`);
      });
    }
    if (lastVacancyResponseId && extractVacancyId(newUrl) !== lastVacancyResponseId &&
        !URL_PATTERNS.vacancyResponse.test(newUrl)) {
      lastVacancyResponseId = null;
    }
  };
  commander.onUrlChange(onUrlChange);

  return () => {
    unregisterVacancyResponse();
    unregisterVacancyPage();
    unregisterSearchPage();
    commander.navigationManager?.off('onUrlChange', onUrlChange);
    log.debug(() => '📋 All page triggers unregistered');
  };
}
