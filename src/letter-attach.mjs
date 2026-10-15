/**
 * The cover letter attached after the application was sent. hh.ru sometimes sends an application
 * at the click on the list, with no popup, or one goes without its letter; then it offers to attach
 * the letter: «Приложить письмо» in the card on the list, «Приложить сопроводительное письмо» on
 * the vacancy page. Both open the same popup, where the letter is typed and sent. It counts as
 * delivered once the popup has closed and the offer is gone. The fallbacks, in order:
 *   1. the card's offer on the list (no page is opened)
 *   2. the vacancy page's offer, then back to the list
 *   3. nothing worked: the vacancy is kept in skipped-vacancies.lino («letter_not_attached») and
 *      the run says so, so the letter can be attached by hand
 *
 * @module letter-attach
 */

import { typeLongText } from './helpers/page-helpers.mjs';

export const LETTER_SELECTORS = {
  cardInformer: '[data-qa="vacancy-response-letter-informer"]',
  cardToggle: '[data-qa="vacancy-response-letter-toggle"]',
  pageButton: '[data-qa="responded-success-attach-cover-letter"]',
  textarea: 'textarea[data-qa="vacancy-response-popup-form-letter-input"]',
  submit: '[data-qa="vacancy-response-letter-submit"]',
};

/** The attribute that tells the offer of one card (no visible change on the page) */
const TARGET = 'data-letter-offer';

/**
 * Runs in the page: what the card of a vacancy on the list shows after the click on «Откликнуться»
 * @param {string} vacancyId
 * @param {string} informer - LETTER_SELECTORS.cardInformer
 * @param {string} toggle - LETTER_SELECTORS.cardToggle
 * @param {string} target - TARGET
 * @returns {{applied: boolean, offer: string|null}} applied: hh.ru says the application is sent;
 *   offer: the selector of the card's «Приложить письмо»
 */
export function readCardAfterClick(vacancyId, informer, toggle, target) {
  const card = document.querySelector(`a[href*="/vacancy/${vacancyId}"]`)?.closest('[data-qa="vacancy-serp__vacancy"]');
  if (!card) {
    return { applied: false, offer: null };
  }
  const text = card.innerText ?? '';
  const button = card.querySelector(`${informer} ${toggle}`);
  if (button) {
    button.setAttribute(target, vacancyId);
  }
  return {
    applied: Boolean(card.querySelector(informer)) || /Вы откликнулись|Ваш отклик отправлен/.test(text),
    offer: button ? `[${target}="${vacancyId}"]` : null,
  };
}

/**
 * What the card shows after the click
 * @returns {Promise<{applied: boolean, offer: string|null}>}
 */
export async function cardAfterClick(commander, vacancyId) {
  if (!vacancyId) {
    return { applied: false, offer: null };
  }
  try {
    return await commander.evaluate({
      fn: readCardAfterClick,
      args: [vacancyId, LETTER_SELECTORS.cardInformer, LETTER_SELECTORS.cardToggle, TARGET],
    }) ?? { applied: false, offer: null };
  } catch {
    return { applied: false, offer: null };
  }
}

const count = (commander, selector) => commander.count({ selector }).catch(() => 0);

/**
 * Wait until a check holds
 * @returns {Promise<boolean>}
 */
async function waitFor(commander, check, ms, reason) {
  for (let waited = 0; waited < ms; waited += 500) {
    if (await check()) {
      return true;
    }
    await commander.wait({ ms: 500, reason });
  }
  return check();
}

/**
 * Open the letter popup by an offer, type the letter and send it
 * @param {Object} commander
 * @param {string} offer - The selector of «Приложить письмо»
 * @param {string} letter
 * @returns {Promise<{attached: boolean, reason?: string}>}
 */
export async function sendLetterByOffer(commander, offer, letter) {
  await commander.clickButton({ selector: offer, scrollIntoView: true });
  if (!await waitFor(commander, async () => await count(commander, LETTER_SELECTORS.textarea) > 0, 8000, 'cover letter popup')) {
    return { attached: false, reason: 'the letter popup did not open' };
  }
  const { verified, actualValue } = await typeLongText(commander, { selector: LETTER_SELECTORS.textarea, text: letter, checkEmpty: false });
  if (!verified && String(actualValue ?? '').trim() !== letter.trim()) {
    return { attached: false, reason: 'the letter did not get into the field' };
  }
  await commander.clickButton({ selector: LETTER_SELECTORS.submit, scrollIntoView: false });
  const closed = await waitFor(commander, async () => await count(commander, LETTER_SELECTORS.textarea) === 0, 10000, 'cover letter sent');
  if (!closed) {
    const said = await commander.evaluate({
      fn: (sel) => document.querySelector(sel)?.closest('[data-qa="modal-overlay"], [role="dialog"]')?.innerText ?? '',
      args: [LETTER_SELECTORS.textarea],
    }).catch(() => '');
    return { attached: false, reason: `the letter popup stayed open: ${String(said).replace(/\s+/g, ' ').slice(0, 200)}` };
  }
  // Delivered: the offer is gone (hh.ru shows the letter as sent)
  if (!await waitFor(commander, async () => await count(commander, offer) === 0, 5000, 'letter offer gone')) {
    return { attached: false, reason: 'hh.ru still offers to attach the letter' };
  }
  return { attached: true };
}

/**
 * Attach the cover letter to an application sent without it, by every way there is
 * @param {Object} options
 * @param {Object} options.commander
 * @param {string} options.vacancyId
 * @param {string} options.letter
 * @param {string|null} [options.offer] - The card's «Приложить письмо» (cardAfterClick)
 * @param {string} [options.returnUrl] - The list to go back to after the vacancy page
 * @returns {Promise<{attached: boolean, via?: string, noOffer?: boolean, reason?: string}>} noOffer: the
 *   vacancy page does not offer to attach a letter (one is attached already)
 */
export async function attachLetter({ commander, vacancyId, letter, offer = null, returnUrl }) {
  if (!letter) {
    return { attached: false, reason: 'no cover letter' };
  }
  const reasons = [];
  let noOffer = false;
  if (offer) {
    const result = await sendLetterByOffer(commander, offer, letter).catch((error) => ({ attached: false, reason: error.message.split('\n')[0] }));
    if (result.attached) {
      return { attached: true, via: 'the card on the list' };
    }
    reasons.push(`card: ${result.reason}`);
    console.log(`⚠️  The letter was not attached in the card (${result.reason}): trying the vacancy page`);
    await closeLetterPopup(commander);
  }
  try {
    await commander.goto({ url: `https://hh.ru/vacancy/${vacancyId}`, waitForStableUrlBefore: false });
    if (await waitFor(commander, async () => await count(commander, LETTER_SELECTORS.pageButton) > 0, 10000, 'vacancy page letter offer')) {
      const result = await sendLetterByOffer(commander, LETTER_SELECTORS.pageButton, letter);
      if (result.attached) {
        return { attached: true, via: 'the vacancy page' };
      }
      reasons.push(`vacancy page: ${result.reason}`);
      await closeLetterPopup(commander);
    } else {
      noOffer = true;
      reasons.push('vacancy page: no offer to attach the letter');
    }
  } catch (error) {
    reasons.push(`vacancy page: ${error.message.split('\n')[0]}`);
  } finally {
    if (returnUrl) {
      await commander.goto({ url: returnUrl, waitForStableUrlBefore: false }).catch(() => {});
    }
  }
  return { attached: false, noOffer, reason: reasons.join('; ') };
}

/** Close the letter popup left open, without sending */
async function closeLetterPopup(commander) {
  await commander.evaluate({
    fn: (sel) => {
      const footer = document.querySelector(sel)?.closest('[data-qa="modal-overlay"], [role="dialog"]')?.querySelector('[data-qa="modal-footer"]');
      [...(footer?.querySelectorAll('button') ?? [])].find((button) => /Закрыть|Отмена/.test(button.innerText))?.click();
    },
    args: [LETTER_SELECTORS.textarea],
  }).catch(() => {});
}
