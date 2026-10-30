/** Account-wide application limits: visible evidence, saved answers and restart-safe deadlines. */
import { randomUUID } from 'node:crypto';
import { readEvents, recordEvent } from './stats.mjs';
import { LIMIT_COOLDOWN_MS, limitHeldUntil } from './pacing.mjs';
import { saveApplicationDraft } from './application-drafts.mjs';
import { extractVacancyIdFromResponseUrl } from './hh-selectors.mjs';

export function isDailyApplicationLimit(error) {
  if (!error) return false;
  if (error.code === 'negotiations-limit-exceeded') return true;
  const text = String(error.text ?? '').replace(/\s+/g, ' ');
  return /(?:applications?|отклик)/iu.test(text) && /(?:24[ -]?(?:hour|час)|daily|сут(?:ки|ок)|дневн|per day|в день)/iu.test(text) &&
    /cannot send more|application limit|reached.{0,30}limit|не более|лимит.{0,30}отклик|отклик.{0,30}лимит|исчерпа|превышен/iu.test(text);
}

export function applicationStateReadError(commander, result, url) {
  const error = new Error('Could not read application errors; keeping the current page');
  error.expectedNavigation = Boolean(result.navigationError || commander.getUrl() !== url ||
    commander.shouldAbort?.() || commander.navigationManager?.isNavigating());
  return error;
}

/** Runs in the page: only rendered error/alert elements count, never vacancy text or hidden templates. */
export function readVisibleApplicationLimit() {
  const visible = (element) => {
    if (!element.getClientRects().length) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          (node.getBoundingClientRect().height === 0 && style.overflow !== 'visible')) return false;
    }
    return true;
  };
  const elements = [...document.querySelectorAll('[data-qa-popup-error-code], [role="alert"], form[name="vacancy_response"] [data-qa*="error"]')];
  for (const element of elements) {
    if (!visible(element)) continue;
    const code = element.getAttribute('data-qa-popup-error-code') ?? '';
    const text = element.innerText.replace(/\s+/g, ' ').trim();
    const limited = code === 'negotiations-limit-exceeded' ||
      (/(?:applications?|отклик)/iu.test(text) && /(?:24[ -]?(?:hour|час)|daily|сут(?:ки|ок)|дневн|per day|в день)/iu.test(text) &&
       /cannot send more|application limit|reached.{0,30}limit|не более|лимит.{0,30}отклик|отклик.{0,30}лимит|исчерпа|превышен/iu.test(text));
    if (!limited) continue;
    const form = element.closest('form[name="vacancy_response"]') ?? document.querySelector('form[name="vacancy_response"]');
    return { code: code || 'negotiations-limit-exceeded', text, url: window.location.href,
      vacancyId: new URL(window.location.href).searchParams.get('vacancyId') ?? form?.querySelector('input[name="vacancy_id"]')?.value ?? null,
      documentId: window.__hhApplicationLimitDocument ??= window.crypto.randomUUID(), hasForm: Boolean(form),
      requiresReview: Boolean(form?.querySelector('[data-hh-answer-draft]')) };
  }
  return null;
}

export async function readApplicationLimit(commander) {
  const url = commander.getUrl();
  const result = await commander.safeEvaluate({ fn: readVisibleApplicationLimit, defaultValue: null,
    operationName: 'daily application limit check', silent: true });
  if (result.success === false) throw applicationStateReadError(commander, result, url);
  return isDailyApplicationLimit(result.value) ? result.value : null;
}

const capturing = new WeakMap();
const observed = new WeakMap();
const documents = new WeakMap();

/** Re-observing the same document does not extend the deadline, even after it has expired. */
export function prepareApplicationLimit({ commander, vacancyId, saveAnswers = async () => {}, forceCapture = false,
  saveDraft = saveApplicationDraft, getEvents = () => process.env.NODE_ENV === 'test' ? [] : readEvents(),
  record = recordEvent, now = Date.now }) {
  if (capturing.has(commander)) return capturing.get(commander);
  const operation = (async () => {
    const error = await readApplicationLimit(commander);
    if (!error) return null;
    documents.set(commander, documents.get(commander) ?? randomUUID());
    const documentId = error.documentId ?? documents.get(commander);
    const id = error.vacancyId ?? vacancyId ?? extractVacancyIdFromResponseUrl(commander.getUrl());
    const key = `${documentId}:${id ?? ''}`;
    if (!forceCapture && observed.get(commander)?.key === key) return observed.get(commander).result;
    await saveAnswers();
    if (commander.getUrl() !== error.url && error.url) return null;
    const current = await readApplicationLimit(commander);
    if (!current || (current.vacancyId && String(current.vacancyId) !== String(id))) return null;
    if (id && current.hasForm !== false) await saveDraft({ commander, vacancyId: id, error: current, requiresReview: Boolean(current.requiresReview) });
    const events = getEvents();
    const previous = events.findLast(event => event.type === 'limit_reached' && event.documentId === documentId);
    const until = previous ? (previous.until ?? Date.parse(previous.at) + LIMIT_COOLDOWN_MS)
      : limitHeldUntil(events, now()) || now() + LIMIT_COOLDOWN_MS;
    const url = error.url ?? commander.getUrl();
    const result = { status: 'daily_limit', until, url, vacancyId: id, visible: true,
      resumeUrl: id ? `https://hh.ru/applicant/vacancy_response?vacancyId=${id}&startedWithQuestion=false` : url };
    if (!previous) record('limit_reached', { vacancyId: id, documentId, until, url, source: 'application_error' });
    observed.set(commander, { key, result });
    return result;
  })().finally(() => capturing.delete(commander));
  capturing.set(commander, operation);
  return operation;
}

/** Keep the document intact during the hold; only reload a still-failed form after the deadline. */
export async function waitForApplicationLimit({ commander, limit, isPageClosed = () => false, saveAnswers,
  now = Date.now, prepare = prepareApplicationLimit }) {
  const url = commander.getUrl();
  while (!isPageClosed() && commander.getUrl() === url && now() < limit.until) {
    const result = await commander.wait({ ms: Math.min(30000, limit.until - now()), reason: 'daily application limit cooldown' });
    if (result?.aborted) return false;
  }
  if (isPageClosed() || commander.getUrl() !== url) return false;
  if (limit.visible) {
    const current = await prepare({ commander, vacancyId: limit.vacancyId, forceCapture: true, saveAnswers });
    if (commander.getUrl() !== url || isPageClosed()) return false;
    // The user may have dismissed the error or successfully sent the form meanwhile.
    if (current) await commander.goto({ url: limit.resumeUrl ?? url, waitForStableUrlBefore: false, waitForNetworkIdle: false });
  }
  return true;
}
