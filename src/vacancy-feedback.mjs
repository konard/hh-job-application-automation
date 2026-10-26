/** The viewed-but-not-applied survey is answered with the user's default, independently of applications. */

/** Runs in the browser. Dedicated survey attributes avoid interpreting application questions. */
export function observeVacancyFeedback(enabled = true) {
  window.__hhVacancyFeedback?.disconnect();
  delete window.__hhVacancyFeedback;
  if (!enabled || !/(^|\.)hh\.ru$/i.test(window.location.hostname)) return;
  const handled = new WeakSet();
  const answer = () => {
    const close = document.querySelector('[data-qa="vacancy-feedback__close"]');
    const dialog = close?.closest('[role="dialog"], [data-qa="modal-overlay"]');
    if (!dialog || !dialog.getClientRects().length || handled.has(dialog)) return;
    const option = dialog.querySelector('input[data-qa="vacancy-feedback__reason-MAYBE_LATER"]');
    if (!option || option.disabled) return;
    // Preserve any different choice the user has already made.
    if ([...dialog.querySelectorAll('input[name="reason"]')].some((input) => input.checked && input !== option)) return;
    handled.add(dialog);
    if (!option.checked) option.click();
    if (option.checked) {
      // Some versions leave the survey open after selecting a reason.
      if (close.isConnected) close.click();
      window.__hhVacancyFeedbackAnswered?.().catch(() => {});
    }
  };
  const observer = new window.MutationObserver(answer);
  window.__hhVacancyFeedback = observer;
  const start = () => {
    if (window.__hhVacancyFeedback !== observer) return;
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    answer();
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

/** Observe the current page and every navigation, including while the main loop is waiting. */
export async function watchVacancyFeedback(page, { enabled = true, log = console.log } = {}) {
  await page.exposeFunction('__hhVacancyFeedbackAnswered', () => log('💬 Vacancy feedback: selected "Maybe I\'ll apply later"'));
  const script = `(${observeVacancyFeedback.toString()})(${JSON.stringify(enabled)})`;
  if (page.addInitScript) await page.addInitScript({ content: script });
  else await page.evaluateOnNewDocument(observeVacancyFeedback, enabled);
  await page.evaluate(script);
}
