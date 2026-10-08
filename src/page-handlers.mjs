/**
 * Redirect check used by the main loop
 *
 * The primary navigation handling is done by page-triggers.mjs using the
 * pageTrigger pattern from browser-commander. This check is an additional
 * safety net in the main loop for vacancy pages opened from vacancy_response.
 *
 * @see page-triggers.mjs
 * @see https://github.com/konard/hh-job-application-automation/issues/89
 */

import { isNavigationError } from 'browser-commander';
import { log } from './logging.mjs';
import { createApplyButtonTracker } from './helpers/session-tracker.mjs';
import { isResponseSubmitted } from './helpers/page-helpers.mjs';
import { URL_PATTERNS, extractVacancyId } from './hh-selectors.mjs';

/**
 * Redirect back to the search page if the application was sent from a vacancy page
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {boolean} options.isOnVacancyPageFromResponse - Whether we came to the vacancy page from vacancy_response
 * @param {string} options.returnUrl - URL to return to (last search page)
 * @param {Function} [options.onApplicationSent] - Called with the vacancy ID before returning; false means it was already handled
 * @returns {Promise<boolean>} True if redirect was performed
 */
export async function checkAndRedirectIfNeeded({ commander, isOnVacancyPageFromResponse, returnUrl, onApplicationSent = async () => {} }) {
  try {
    const currentUrl = commander.getUrl();
    log.debug(() => `checkAndRedirectIfNeeded: ${currentUrl} (from response: ${isOnVacancyPageFromResponse})`);

    // Only check on vacancy pages when we came from vacancy_response
    if (!isOnVacancyPageFromResponse || !URL_PATTERNS.vacancyPage.test(currentUrl)) {
      return false;
    }

    // Redirect if the apply button was clicked OR if response text is on the page
    if (await createApplyButtonTracker(commander).checkAndClear()) {
      console.log('Detected "Откликнуться" button was clicked on vacancy page!');
    } else if (await isResponseSubmitted(commander)) {
      console.log('Detected application submission via response text on vacancy page!');
    } else {
      return false;
    }

    // Another handler already counted it and went back to the list
    if (await onApplicationSent(extractVacancyId(currentUrl)) === false) {
      return false;
    }
    console.log(`Response submitted from vacancy page, redirecting to: ${returnUrl}`);
    await commander.goto({ url: returnUrl, waitForStableUrlBefore: false });
    return true;
  } catch (error) {
    console.log(isNavigationError(error)
      ? 'Navigation detected during redirect check, continuing...'
      : `Error checking redirect condition: ${error.message}`);
    return false;
  }
}
