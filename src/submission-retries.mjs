/** Failed applications wait five hours in RAM; restarting the process clears the queue. */
import { URL_PATTERNS, extractVacancyIdFromResponseUrl } from './hh-selectors.mjs';
import { withdrawPrompt } from './confirmations.mjs';
import { isResponseSubmitted } from './helpers/page-helpers.mjs';
import { saveApplicationDraft } from './application-drafts.mjs';
import { closeModalIfPresent } from './helpers/modal-helpers.mjs';
import { alertUntilDone } from './notify.mjs';

export const SUBMISSION_RETRY_MS = 5 * 60 * 60 * 1000;

export function createSubmissionRetries({ now = Date.now } = {}) {
  const pending = new Map();
  return {
    defer(vacancyId, details = {}) {
      const id = String(vacancyId ?? '');
      if (!/^\d+$/.test(id)) throw new Error('A submission retry needs a vacancy ID');
      // Re-reading the same visible error must not keep moving its deadline.
      if (!pending.has(id)) pending.set(id, {
        ...details, vacancyId: id, until: now() + SUBMISSION_RETRY_MS,
        url: details.url ?? `https://hh.ru/applicant/vacancy_response?vacancyId=${id}&startedWithQuestion=false`,
      });
      return pending.get(id);
    },
    get: (id) => pending.get(String(id)),
    // A controlled code reload may hand off RAM state through an environment variable. Normal
    // starts do not read a queue file or reconstruct retries from the log.
    restore(entries) {
      for (const entry of entries) {
        if (!/^\d+$/.test(String(entry.vacancyId)) || !Number.isFinite(entry.until) ||
          !/^https:\/\/hh\.ru\/applicant\/vacancy_response\?/.test(entry.url)) throw new Error('Invalid in-memory retry handoff');
        pending.set(String(entry.vacancyId), { ...entry, vacancyId: String(entry.vacancyId) });
      }
    },
    ids: () => [...pending.keys()],
    forget: (id) => pending.delete(String(id)),
    nextDue: () => [...pending.values()].filter((entry) => entry.until <= now()).sort((a, b) => a.until - b.until)[0] ?? null,
    takeDue() {
      const entry = this.nextDue();
      if (entry) pending.delete(entry.vacancyId);
      return entry;
    },
  };
}

export const submissionRetries = createSubmissionRetries();

const BLOCKING_ERROR = /limit|ban|block|captcha|many|лимит|огранич|заблок|блокир|слишком мно|не более|запрещ/i;
export const isPassingError = (error) => Boolean(error) &&
  !BLOCKING_ERROR.test(`${error.code} ${error.text}`) &&
  (/^(?:unknown|internal[-_]?server[-_]?error|server[-_]?error|service[-_]?unavailable)$/i.test(error.code) ||
    /произошла ошибка|an error occurred|something went wrong/iu.test(error.text));

export async function readSubmissionError(commander) {
  const result = await commander.safeEvaluate({
    fn: () => {
      const element = [...document.querySelectorAll('[data-qa-popup-error-code]')].find((item) => item.getClientRects().length > 0);
      if (!element) {
        const held = document.querySelector('form[data-hh-application-error]');
        try { return held ? { ...JSON.parse(held.getAttribute('data-hh-application-error')), held: true } : null; }
        catch { return null; }
      }
      return {
        code: element.getAttribute('data-qa-popup-error-code') ?? '', text: element.innerText.replace(/\s+/g, ' ').trim(),
        vacancyId: element.closest('form')?.querySelector('input[name="vacancy_id"]')?.value ?? '',
      };
    },
    defaultValue: null, operationName: 'popup error check', silent: true,
  });
  if (result.success === false) throw new Error('Could not read application errors; keeping the current page');
  return result.value;
}

const handling = new WeakMap();
const reported = new WeakMap();

/** Save first, then defer generic errors in RAM; other errors keep the form open. */
export function deferFailedSubmission({ commander, vacancyId, title = '', saveAnswers, returnUrl,
  retries = submissionRetries, saveDraft = saveApplicationDraft }) {
  if (handling.has(commander)) return handling.get(commander);
  const run = (async () => {
    const url = commander.getUrl();
    if (await isResponseSubmitted(commander) === true) return false;
    const error = await readSubmissionError(commander);
    const id = extractVacancyIdFromResponseUrl(url) ?? vacancyId ?? error?.vacancyId;
    if (!id || !error || (error.vacancyId && error.vacancyId !== String(id))) return false;
    await saveAnswers();
    // The user may have sent successfully or navigated while the snapshot was being saved.
    const currentError = await readSubmissionError(commander);
    if (commander.getUrl() !== url || !currentError || (currentError.vacancyId && currentError.vacancyId !== String(id))) return false;
    const autoSkip = isPassingError(currentError);
    const backup = await saveDraft({ commander, vacancyId: id, error: currentError, requiresReview: !autoSkip });
    if (commander.getUrl() !== url || await isResponseSubmitted(commander) === true) return false;
    const entry = autoSkip ? retries.defer(id, { title, ...(URL_PATTERNS.vacancyResponse.test(url) ? { url } : {}) }) : null;
    const signature = `${url}:${id}:${error.code}:${error.text}`;
    if (reported.get(commander) !== signature) {
      const result = entry ? `skipped for 5 hours in RAM; retry after ${new Date(entry.until).toISOString()}` : 'keeping this form open for manual review';
      console.log(`${entry ? '⏭️' : '🛑'} Vacancy ${id}: hh.ru submission error; answers saved${backup?.file ? `; recovery copy: ${backup.file}` : ''}; ${result}.`);
      withdrawPrompt(entry ? `vacancy ${id} is waiting for its five-hour submission retry` : `vacancy ${id} has a submission error; its form stays open`);
      reported.set(commander, signature);
    }
    if (entry) {
      if (URL_PATTERNS.vacancyResponse.test(url)) {
        await commander.goto({ url: returnUrl || 'https://hh.ru/search/vacancy?from=resumelist', waitForStableUrlBefore: false });
      } else if (!await closeModalIfPresent({ commander })) {
        await commander.goto({ url: returnUrl || url, waitForStableUrlBefore: false });
      }
    } else {
      alertUntilDone(commander, { isDone: () => isResponseSubmitted(commander) });
    }
    return true;
  })().finally(() => handling.delete(commander));
  handling.set(commander, run);
  return run;
}
