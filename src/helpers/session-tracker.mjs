/**
 * Session Storage Tracker Helper
 *
 * Tracks "Откликнуться" (Apply) button clicks across page navigations through a
 * sessionStorage flag. The generic logic lives in browser-commander
 * (installClickListener / checkAndClearFlag); this module only binds it to hh.ru.
 *
 * @module session-tracker
 */

/**
 * Session storage key for redirect flag
 */
export const SESSION_KEYS = {
  shouldRedirectAfterResponse: 'shouldRedirectAfterResponse',
};

/**
 * Create a tracker for the "Откликнуться" (Apply) button
 *
 * @param {Object} commander - Browser commander instance
 * @returns {{install: () => Promise<boolean>, checkAndClear: () => Promise<boolean>}}
 */
export function createApplyButtonTracker(commander) {
  const storageKey = SESSION_KEYS.shouldRedirectAfterResponse;
  return {
    install: () => commander.installClickListener({ buttonText: 'Откликнуться', storageKey }),
    checkAndClear: () => commander.checkAndClearFlag({ storageKey }),
  };
}
