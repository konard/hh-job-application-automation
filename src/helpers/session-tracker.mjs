/**
 * Session Storage Tracker Helper
 *
 * Tracks "Откликнуться" (Apply) button clicks across page navigations through a
 * sessionStorage flag. The buttons are found by their data-qa and link, in any language of hh.ru;
 * the flag is read with browser-commander's checkAndClearFlag.
 *
 * @module session-tracker
 */

/**
 * Session storage key for redirect flag
 */
export const SESSION_KEYS = {
  shouldRedirectAfterResponse: 'shouldRedirectAfterResponse',
};

/** The apply buttons of a vacancy page and of the list, by data-qa and link: the same in every language */
export const APPLY_BUTTONS = '[data-qa="vacancy-response-link-top"], [data-qa="vacancy-response-link-bottom"], ' +
  '[data-qa="vacancy-serp__vacancy_response"], a[href*="/applicant/vacancy_response"]';

/**
 * Runs in the page: a click on an apply button sets the sessionStorage flag (installed once a key)
 * @param {string} selector - APPLY_BUTTONS
 * @param {string} key
 * @returns {boolean}
 */
export function installApplyClickListener(selector, key) {
  window.__applyClickListeners ??= new Map();
  document.removeEventListener('click', window.__applyClickListeners.get(key), true);
  const listener = (event) => {
    if (event.target?.closest?.(selector)) {
      window.sessionStorage.setItem(key, 'true');
    }
  };
  window.__applyClickListeners.set(key, listener);
  document.addEventListener('click', listener, true);
  return true;
}

/**
 * Create a tracker for the "Откликнуться" (Apply) button
 *
 * @param {Object} commander - Browser commander instance
 * @returns {{install: () => Promise<boolean>, checkAndClear: () => Promise<boolean>}}
 */
export function createApplyButtonTracker(commander) {
  const storageKey = SESSION_KEYS.shouldRedirectAfterResponse;
  return {
    install: () => commander.safeEvaluate({
      fn: installApplyClickListener,
      args: [APPLY_BUTTONS, storageKey],
      defaultValue: false,
      operationName: 'apply click listener',
      silent: true,
    }).then(({ value }) => value),
    checkAndClear: () => commander.checkAndClearFlag({ storageKey }),
  };
}
