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
import { UNAVAILABLE_TEXT } from './hh-words.mjs';

/**
 * Redirect back to the search page if the application was sent from a vacancy page
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {boolean} options.isOnVacancyPageFromResponse - Whether we came to the vacancy page from vacancy_response
 * @param {string} options.returnUrl - URL to return to (last search page)
 * @param {Function} [options.onApplicationSent] - Called with the vacancy ID before returning; false means it was already counted
 * @param {Function} [options.onUnavailable] - Called with the vacancy ID of a vacancy hh.ru does not show to this account
 * @returns {Promise<boolean>} True if the confirmed vacancy was handled (including another handler leaving it)
 */
export async function checkAndRedirectIfNeeded({
  commander, isOnVacancyPageFromResponse, returnUrl, onApplicationSent = async () => {}, onUnavailable = async () => {},
}) {
  try {
    const currentUrl = commander.getUrl();
    log.debug(() => `checkAndRedirectIfNeeded: ${currentUrl} (from response: ${isOnVacancyPageFromResponse})`);

    // Only check on vacancy pages when we came from vacancy_response
    if (!isOnVacancyPageFromResponse || !URL_PATTERNS.vacancyPage.test(currentUrl)) {
      return false;
    }

    // «Вам недоступна эта вакансия»: hh.ru closed it to this account; it is remembered and left
    if (await commander.evaluate({ fn: (words) => new RegExp(words, 'iu').test(document.body?.innerText ?? ''), args: [UNAVAILABLE_TEXT] })) {
      await onUnavailable(extractVacancyId(currentUrl));
      console.log(`Back to the vacancy list: ${returnUrl}`);
      await commander.goto({ url: returnUrl, waitForStableUrlBefore: false });
      return true;
    }

    const clicked = await createApplyButtonTracker(commander).checkAndClear();
    // A click is not a confirmed application; errors and unfinished forms must stay open.
    if (!await isResponseSubmitted(commander)) return false;
    if (clicked) {
      console.log('Detected "Откликнуться" button was clicked on vacancy page!');
    } else {
      console.log('Detected application submission via response text on vacancy page!');
    }

    // Counting and leaving the confirmation page are separate. Another handler may have
    // counted the application without navigating (e.g. a native manual Send).
    await onApplicationSent(extractVacancyId(currentUrl));
    // The callback may have returned to search, or the user may have opened another form.
    if (commander.getUrl() !== currentUrl) return true;
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
