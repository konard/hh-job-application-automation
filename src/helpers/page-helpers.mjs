/**
 * Small hh.ru page helpers shared by the vacancy list, modal and response page flows
 *
 * @module helpers/page-helpers
 */

import { SELECTORS } from '../hh-selectors.mjs';

/**
 * Texts hh.ru shows once an application has been sent
 */
const RESPONSE_SENT_TEXTS = ['Вы откликнулись', 'Вы уже откликались', 'Отклик отправлен'];

/**
 * Return the first selector that matches an element on the page
 * @param {Object} commander - Browser commander instance
 * @param {string[]} selectors - Selectors to try in order
 * @param {Object} [options]
 * @param {boolean} [options.visible=false] - Also require the element to be visible
 * @returns {Promise<string|null>}
 */
export async function findFirstSelector(commander, selectors, { visible = false } = {}) {
  for (const selector of selectors) {
    if (await commander.count({ selector }) > 0 && (!visible || await commander.isVisible({ selector }))) {
      return selector;
    }
  }
  return null;
}

/**
 * Find the toggle that expands the cover letter section (data-qa first, then by text)
 * @param {Object} commander - Browser commander instance
 * @param {Object} options
 * @param {string[]} options.texts - Texts to search for, in order
 * @param {string[]} options.elementTypes - Element types to search in
 * @returns {Promise<string|Object|null>} Selector or null
 */
export async function findCoverLetterToggle(commander, { texts, elementTypes }) {
  let selector = await commander.findToggleButton({
    dataQaSelectors: [SELECTORS.coverLetterToggle, SELECTORS.addCoverLetterButton],
  });
  for (const textToFind of texts) {
    selector ??= await commander.findToggleButton({ textToFind, elementTypes });
  }
  return selector;
}

/**
 * Check whether the current page says the application was already sent
 * @param {Object} commander - Browser commander instance
 * @returns {Promise<boolean>} False also when navigation interrupted the check
 */
export async function isResponseSubmitted(commander) {
  const { value } = await commander.safeEvaluate({
    fn: (texts) => {
      // Normalize whitespace (including nbsp) for matching
      const bodyText = document.body.textContent.replace(/\s+/g, ' ');
      return texts.some((text) => bodyText.includes(text));
    },
    args: [RESPONSE_SENT_TEXTS],
    defaultValue: false,
    operationName: 'response submitted check',
  });
  return value;
}

/**
 * Check whether a submit button is enabled (no disabled attribute or class)
 * @param {Object} commander - Browser commander instance
 * @param {string} selector - Button selector
 * @returns {Promise<boolean>}
 */
export function isButtonEnabled(commander, selector) {
  return commander.isEnabled({ selector, disabledClasses: ['disabled'] });
}

/**
 * Persist a vacancy ID that should be skipped because it has a questionnaire
 * @param {Function} addIgnoredVacancyId - Database method
 * @param {string|null} vacancyId - Vacancy ID
 */
export async function rememberIgnoredVacancy(addIgnoredVacancyId, vacancyId) {
  if (!vacancyId) {
    return;
  }
  const wasAdded = await addIgnoredVacancyId(vacancyId);
  console.log(
    wasAdded
      ? `💾 Saved ignored questionnaire vacancy ID: ${vacancyId}`
      : `💾 Questionnaire vacancy ID already persisted: ${vacancyId}`,
  );
}

const OVERLAYS = [
  { selector: SELECTORS.cookiesAccept, message: '🍪 Accepted the cookies policy banner' },
  // Asks for the desired salary to save it into the resume; it blocks the response form
  { selector: SELECTORS.additionalDataClose, message: '💬 Closed the desired salary popup' },
];

/**
 * Runs in the page: the close button of the open chat panel, or the panel's buttons when
 * none is recognised. Only a visible element of the panel with "close" in its data-qa counts.
 * @returns {{selector: string}|{buttons: string[]}|null} Null when the panel is not open
 */
export function findChatPanelClose({ panelSelector }) {
  const panel = document.querySelector(panelSelector);
  const isVisible = (element) => element.getClientRects().length > 0;
  if (!panel || !isVisible(panel)) {
    return null;
  }
  const close = [...panel.querySelectorAll('[data-qa]')]
    .find((element) => isVisible(element) && /close/i.test(element.getAttribute('data-qa')));
  if (close) {
    return { selector: `${panelSelector} [data-qa="${close.getAttribute('data-qa')}"]` };
  }
  return {
    buttons: [...panel.querySelectorAll('button, [role="button"]')].filter(isVisible)
      .map((button) => button.getAttribute('data-qa') || button.getAttribute('aria-label') || button.textContent.trim().slice(0, 30)),
  };
}

let reportedUnknownChatPanel = false;

/**
 * Close the chat panel hh.ru opens after an application, so it does not cover the vacancy list
 * @param {Object} commander - Browser commander instance
 */
export async function closeChatPanel(commander) {
  const { value } = await commander.safeEvaluate({
    fn: findChatPanelClose,
    args: [{ panelSelector: SELECTORS.chatPanel }],
    defaultValue: null,
    operationName: 'chat panel check',
  });
  if (value?.selector) {
    await commander.clickButton({ selector: value.selector, scrollIntoView: false }).catch(() => {});
    console.log('💬 Closed the chat panel');
  } else if (value?.buttons && !reportedUnknownChatPanel) {
    reportedUnknownChatPanel = true;
    console.log(`⚠️  The chat panel is open but has no recognised close button; left as is. Its buttons: ${value.buttons.join(', ')}`);
  }
}

/**
 * Dismiss hh.ru overlays that cover the page: the cookies banner, the desired salary popup
 * and the chat panel
 * @param {Object} commander - Browser commander instance
 */
export async function dismissOverlays(commander) {
  for (const { selector, message } of OVERLAYS) {
    if (await commander.isVisible({ selector }).catch(() => false)) {
      await commander.clickButton({ selector, scrollIntoView: false }).catch(() => {});
      console.log(message);
    }
  }
  await closeChatPanel(commander);
}
