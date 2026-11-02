/** Account-wide application limits: visible evidence, saved answers and restart-safe deadlines. */
import { randomUUID } from 'node:crypto';
import { readEvents, recordEvent } from './stats.mjs';
import { LIMIT_COOLDOWN_MS, limitHeldUntil } from './pacing.mjs';
import { saveApplicationDraft } from './application-drafts.mjs';
import { extractVacancyIdFromResponseUrl } from './hh-selectors.mjs';
import { silenceAlertsUntil } from './notify.mjs';

export function isDailyApplicationLimit(error) {
  if (!error) return false;
  if (error.code === 'negotiations-limit-exceeded') return true;
  const text = String(error.text ?? '').replace(/\s+/g, ' ');
  return /(?:applications?|отклик)/iu.test(text) && /(?:24[ -]?(?:hour|час)|daily|сут(?:ки|ок)|дневн|per day|в день)/iu.test(text) &&
    /cannot send more|application limit|reached.{0,30}limit|не более|лимит.{0,30}отклик|отклик.{0,30}лимит|исчерпа|превышен/iu.test(text);
}

export function applicationStateReadError(commander, result, url) {
  const error = new Error('Could not read application errors; keeping the current page');
  error.code = 'APPLICATION_STATE_READ_FAILED';
  error.expectedNavigation = Boolean(result.navigationError || commander.getUrl() !== url ||
    commander.shouldAbort?.() || commander.navigationManager?.isNavigating());
  return error;
}

/** Only a known interrupted read is retryable; an unreadable stable page is still an error. */
export const isApplicationStateNavigation = error => error?.code === 'APPLICATION_STATE_READ_FAILED' && error.expectedNavigation === true;

/** Runs in the page: only rendered error/alert elements count, never vacancy text or hidden templates. */
export function readVisibleApplicationLimit({ dismissCaptcha = false, knownLimitUntil = 0, expectedUrl = '' } = {}) {
  const visible = (element) => {
    if (!element.getClientRects().length) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' ||
          (node.getBoundingClientRect().height === 0 && style.overflow !== 'visible')) return false;
    }
    return true;
  };
  const elements = [...document.querySelectorAll('[data-qa-popup-error-code], [role="alert"], form[name="vacancy_response"] [data-qa*="error"]')];
  // Only the priority handler supplies proof of an already recorded, unexpired account pause.
  // Ordinary reads still require a rendered server error; body text is never used as evidence.
  const knownRoot = knownLimitUntil > Date.now() && expectedUrl === window.location.href ? document.body : null;
  if (knownRoot) elements.push(knownRoot);
  for (const element of elements) {
    if (!visible(element)) continue;
    const code = element === knownRoot ? 'negotiations-limit-exceeded' : element.getAttribute('data-qa-popup-error-code') ?? '';
    const text = element === knownRoot ? 'Previously confirmed account application pause' : element.innerText.replace(/\s+/g, ' ').trim();
    const limited = code === 'negotiations-limit-exceeded' ||
      (/(?:applications?|отклик)/iu.test(text) && /(?:24[ -]?(?:hour|час)|daily|сут(?:ки|ок)|дневн|per day|в день)/iu.test(text) &&
       /cannot send more|application limit|reached.{0,30}limit|не более|лимит.{0,30}отклик|отклик.{0,30}лимит|исчерпа|превышен/iu.test(text));
    if (!limited) continue;
    const form = element.closest('form[name="vacancy_response"]') ?? document.querySelector('form[name="vacancy_response"]');
    const result = { code: code || 'negotiations-limit-exceeded', text, url: window.location.href,
      vacancyId: new URL(window.location.href).searchParams.get('vacancyId') ?? form?.querySelector('input[name="vacancy_id"]')?.value ?? null,
      documentId: window.__hhApplicationLimitDocument ??= window.crypto.randomUUID(), hasForm: Boolean(form),
      requiresReview: Boolean(form?.querySelector('[data-hh-answer-draft]')) };
    if (dismissCaptcha) {
      // Dismiss only HH's CAPTCHA dialog, never its form/answer, refresh or submit controls.
      // Rechecking the rendered limit in this same page operation prevents stale-evidence clicks.
      const input = [...document.querySelectorAll('input[data-qa="account-captcha-input"],input[name="captchaText"]')].find(visible);
      const dialog = input?.closest('[role="dialog"]');
      const buttons = [...dialog?.querySelectorAll('button[type="button"]') ?? []].filter(button => visible(button) &&
        (/^(?:close|закрыть)$/iu.test(button.getAttribute('aria-label') ?? '') ||
          /(?:^|-)close(?:-|$)/i.test(button.getAttribute('data-qa') ?? '') ||
          (!button.getAttribute('data-qa') && !button.textContent.trim() && button.querySelector('svg'))));
      if (buttons.length === 1) {
        buttons[0].click();
        result.captchaCloseRequested = true;
      } else result.captchaCloseRequested = false;
    }
    return result;
  }
  return null;
}

export function readHhCaptchaDialogVisible() {
  return [...document.querySelectorAll('input[data-qa="account-captcha-input"],input[name="captchaText"]')].some(input => {
    if (!input.getClientRects().length) return false;
    for (let node = input; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
    }
    return true;
  });
}

/** A CAPTCHA cannot hide an account refusal. Both hooks receive the unwrapped commander. */
export function createDailyLimitPriority({ saveAnswers = async () => {}, port = 9322,
  prepare = prepareApplicationLimit, wait = waitForApplicationLimit, silence = silenceAlertsUntil,
  saveDraft = saveApplicationDraft, getEvents = () => process.env.NODE_ENV === 'test' ? [] : readEvents(),
  now = Date.now, record = recordEvent, log = console.log } = {}) {
  const holds = new WeakMap();
  const known = new WeakMap();
  const check = async (commander, forceCapture = false) => {
    if (!/(^|\.)hh\.ru$/i.test(new URL(commander.getUrl()).hostname)) return null;
    const visible = await prepare({ commander, forceCapture, saveAnswers: () => saveAnswers(commander) });
    const until = Math.max(known.get(commander)?.until ?? 0, limitHeldUntil(getEvents(), now()));
    const url = commander.getUrl();
    const id = extractVacancyIdFromResponseUrl(url);
    const applicationPage = /\/(?:applicant\/vacancy_response|search\/vacancy|vacancy\/\d+)(?:[/?]|$)/.test(url);
    const limit = visible ?? (until > now() && applicationPage ? { status: 'daily_limit', until, url, vacancyId: id, visible: false,
      resumeUrl: id ? `https://hh.ru/applicant/vacancy_response?vacancyId=${id}&startedWithQuestion=false` : url } : null);
    if (!limit) return null;
    known.set(commander, limit);
    silence({ port, until: limit.until });
    if (!visible) {
      await saveAnswers(commander);
      const form = await commander.safeEvaluate({ fn: readVisibleApplicationLimit,
        args: [{ knownLimitUntil: limit.until, expectedUrl: url }], defaultValue: null, operationName: 'recorded daily limit form check', silent: true });
      if (form.success === false) throw applicationStateReadError(commander, form, url);
      if (id && form.value?.hasForm) await saveDraft({ commander, vacancyId: id, error: form.value, requiresReview: Boolean(form.value.requiresReview) });
    }
    const result = await commander.safeEvaluate({ fn: readVisibleApplicationLimit,
      args: [{ dismissCaptcha: true, knownLimitUntil: limit.until, expectedUrl: url }], defaultValue: null, operationName: 'dismiss captcha for daily application limit', silent: true });
    if (result.success === false) throw applicationStateReadError(commander, result, limit.url);
    if (result.value?.captchaCloseRequested) {
      const closed = await commander.safeEvaluate({ fn: readHhCaptchaDialogVisible, defaultValue: true,
        operationName: 'verify daily-limit captcha dismissal', silent: true });
      if (closed.success === false) throw applicationStateReadError(commander, closed, limit.url);
      if (closed.value === false) {
        log('💤 Daily application limit takes priority: CAPTCHA dismissed without submitting; answers saved and alerts silenced.');
        record('captcha_dismissed_for_limit', { vacancyId: limit.vacancyId });
      }
    }
    return limit;
  };
  return {
    onDailyLimit: commander => check(commander),
    waitForDailyLimit: (commander, limit) => {
      if (holds.has(commander)) return holds.get(commander);
      log(`💤 Account application limit: waiting until ${new Date(limit.until).toISOString()}; chats continue and no CAPTCHA answer is needed.`);
      const hold = wait({ commander, limit, saveAnswers: () => saveAnswers(commander), prepare,
        pollMs: 1000, onPoll: () => check(commander, true) })
        .finally(() => holds.delete(commander));
      holds.set(commander, hold);
      return hold;
    },
  };
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
  now = Date.now, prepare = prepareApplicationLimit, pollMs = 30000, onPoll = async () => {} }) {
  const url = commander.getUrl();
  while (!isPageClosed() && commander.getUrl() === url && now() < limit.until) {
    await onPoll();
    if (isPageClosed() || commander.getUrl() !== url) return false;
    const result = await commander.wait({ ms: Math.min(30000, Math.max(1, pollMs), limit.until - now()), reason: 'daily application limit cooldown' });
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
