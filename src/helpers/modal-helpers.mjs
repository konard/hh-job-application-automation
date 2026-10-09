/**
 * Modal handling helpers
 *
 * Application-specific helpers for handling modals on hh.ru
 * Note: This is kept at application level (not browser-commander)
 * because the selectors and behavior are specific to hh.ru
 *
 * @module helpers/modal-helpers
 */

import { SELECTORS } from '../hh-selectors.mjs';
import { log } from '../logging.mjs';

/**
 * Closes a modal if present on the page
 *
 * @param {Object} options - Options for closing modal
 * @param {Object} options.commander - Browser commander instance
 * @param {string} [options.closeButtonSelector] - Selector for close button (defaults to response popup close)
 * @param {number} [options.waitAfterClose=1000] - Milliseconds to wait after closing
 * @returns {Promise<boolean>} - True if modal was closed, false otherwise
 */
export async function closeModalIfPresent({
  commander,
  closeButtonSelector = SELECTORS.responsePopupClose,
  waitAfterClose = 1000,
} = {}) {
  try {
    if (await commander.count({ selector: closeButtonSelector }) === 0) {
      return false;
    }
    await commander.clickButton({ selector: closeButtonSelector });
    await commander.wait({ ms: waitAfterClose, reason: 'modal to close' });
    console.log('✅ Closed the application modal');
    return true;
  } catch (error) {
    log.debug(() => `🔍 closeModalIfPresent: error - ${error.message}`);
    return false;
  }
}

/**
 * Check if this is a direct application modal (application on external site)
 * and close it if found
 *
 * Direct applications redirect to employer's website instead of allowing
 * application through hh.ru. We want to skip these automatically.
 *
 * The direct application modal has this structure:
 * - Container: div.magritte-desktop-container with data-qa="magritte-alert" inside
 * - Title: "Вакансия с прямым откликом"
 * - Cancel button: data-qa="vacancy-response-link-advertising-cancel"
 *
 * @param {Object} options - Options
 * @param {Object} options.commander - Browser commander instance
 * @returns {Promise<{isDirectApplication: boolean, closed: boolean}>}
 */
export async function checkAndCloseDirectApplicationModal({ commander } = {}) {
  const notDirect = { isDirectApplication: false, closed: false };
  const cancelButtonSelector = SELECTORS.directApplicationCancelButton;

  try {
    if (await commander.count({ selector: cancelButtonSelector }) === 0) {
      return notDirect;
    }

    // Cancel button found - verify by looking for direct application text nearby
    const detection = await commander.safeEvaluate({
      fn: (cancelSelector, alertSelector, overlaySelector) => {
        const cancelButton = document.querySelector(cancelSelector);
        if (!cancelButton) return { found: false, reason: 'no cancel button' };

        const markers = ['прямым откликом', 'сайте работодателя'];
        const hasMarker = (el) => markers.some((marker) => (el?.textContent || '').includes(marker));

        // The modal uses "magritte-alert" data-qa attribute, not "modal-overlay"
        if (hasMarker(document.querySelector(alertSelector))) {
          return { found: true, reason: 'magritte-alert with direct application text' };
        }
        let container = cancelButton.parentElement;
        for (let i = 0; i < 5 && container; i++, container = container.parentElement) {
          if (hasMarker(container)) {
            return { found: true, reason: 'parent container with direct application text' };
          }
        }
        if (hasMarker(document.querySelector(overlaySelector))) {
          return { found: true, reason: 'modal-overlay with direct application text' };
        }
        return { found: false, reason: 'cancel button found but no direct application text nearby' };
      },
      args: [cancelButtonSelector, SELECTORS.directApplicationAlert, SELECTORS.modalOverlay],
      defaultValue: { found: false, reason: 'evaluate failed' },
      operationName: 'direct application check',
      silent: true,
    });

    log.debug(() => `🔍 Direct application detection: ${JSON.stringify(detection)}`);

    if (detection.navigationError || !detection.value.found) {
      return notDirect;
    }

    console.log('💡 Detected direct application modal (application on external site)');
    console.log(`   Detection reason: ${detection.value.reason}`);
    console.log('⏭️  Automatically skipping this vacancy...');

    await commander.clickButton({ selector: cancelButtonSelector, scrollIntoView: false });
    await commander.wait({ ms: 1000, reason: 'direct application modal to close' });

    console.log('✅ Direct application skipped, continuing with next vacancy...');
    return { isDirectApplication: true, closed: true };
  } catch (error) {
    log.debug(() => `🔍 checkAndCloseDirectApplicationModal: error - ${error.message}`);
    return notDirect;
  }
}
