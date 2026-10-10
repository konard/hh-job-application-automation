/**
 * hh.ru's notice on a response form when the resume is not visible to all employers:
 * «Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно всем работодателям,
 * зарегистрированным на hh.ru»». It depends on the resume, not the vacancy (once it shows, every
 * vacancy that needs it does), so the run asks the user to change the visibility instead of
 * skipping vacancy after vacancy.
 *
 * @module resume-visibility
 */

import { askUser, isInteractive } from './confirmations.mjs';

export const RESUME_HIDDEN_NOTICE = 'поменяйте видимость резюме';

/**
 * Runs in the page: whether the notice is rendered in the scope. hh.ru keeps it in every response
 * popup inside a collapsed block (data-qa="hidden-resume-warning", height 0) that opens only for a
 * hidden resume, so text inside a collapsed or hidden element does not count
 * @param {string|null} selector - The popup; the whole page when null
 * @param {string} notice - Lowercase text, ё as е
 * @returns {boolean}
 */
export function findShownNotice(selector, notice) {
  const scope = selector ? document.querySelector(selector) : document.body;
  if (!scope) {
    return false;
  }
  const collapsed = (element) => {
    const style = window.getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden' ||
      (element.getBoundingClientRect().height === 0 && style.overflow !== 'visible');
  };
  const walker = document.createTreeWalker(scope, window.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.toLowerCase().replace(/ё/g, 'е').includes(notice)) {
      continue;
    }
    let shown = true;
    for (let element = node.parentElement; element && element !== scope.parentElement; element = element.parentElement) {
      if (collapsed(element)) {
        shown = false;
        break;
      }
    }
    if (shown) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the form (or the page) shows the notice
 * @param {Object} commander
 * @param {string} [scopeSelector] - The popup; the whole page when not given
 * @returns {Promise<boolean>}
 */
export async function isResumeHiddenNoticeShown(commander, scopeSelector) {
  const { value } = await commander.safeEvaluate({
    fn: findShownNotice,
    args: [scopeSelector ?? null, RESUME_HIDDEN_NOTICE],
    defaultValue: false,
    operationName: 'resume visibility notice',
    silent: true,
  });
  return value;
}

/**
 * When the notice is shown, ask the user to change the visibility of the resume (on hh.ru in their
 * own browser or the app: the automation browser keeps to one tab) or to skip the vacancy
 * @param {Object} commander
 * @param {Object} [options]
 * @param {string} [options.scopeSelector] - The popup; the whole page when not given
 * @param {string|number} [options.vacancyId]
 * @returns {Promise<'visible'|'skip'|'withdrawn'>} 'visible' when there is no notice or the user
 *   has changed the visibility, 'skip' also when nobody can answer (unattended run), 'withdrawn'
 *   when the page changed meanwhile (e.g. the user reloaded it)
 */
export async function waitForVisibleResume(commander, { scopeSelector, vacancyId } = {}) {
  if (!await isResumeHiddenNoticeShown(commander, scopeSelector)) {
    return 'visible';
  }
  console.log(`🙈 hh.ru takes responses to vacancy ${vacancyId ?? ''} only from a resume visible to all employers ` +
    '(«поменяйте видимость резюме на «Видно всем работодателям, зарегистрированным на hh.ru»»)');
  if (!isInteractive()) {
    return 'skip';
  }
  const choice = await askUser('Make the resume visible to all employers (on hh.ru in your own browser or the app: ' +
    'the automation browser keeps to this tab), then', { skip: 'skip this vacancy' });
  return choice === 'continue' ? 'visible' : choice;
}
