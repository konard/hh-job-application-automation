/**
 * Resume (CV) selection: find the most recently updated resume and its suggested vacancies
 *
 * The resumes page shows no update date, but it embeds hh.ru's own page state in a
 * `<template class="ResumeProfileFront-InitialState">`: every resume with its `hash` and
 * `updated` time (milliseconds), and `latestResumeHash`. That state is read from the page
 * that is already open, so choosing costs no extra hh.ru request. A visible «Обновлено …»
 * text is parsed when there is no state; hh.ru's list order is the last resort.
 *
 * @module resumes
 */

import { SELECTORS } from './hh-selectors.mjs';

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse an hh.ru update date such as "Резюме обновлено 7 октября 2026 в 14:28",
 * "сегодня в 9:05", "вчера в 23:10", "07.10.2026 14:28" or "5 минут назад"
 * @param {string} text
 * @param {Date} [now=new Date()]
 * @returns {number|null} Timestamp or null when the text has no date
 */
export function parseUpdatedAt(text, now = new Date()) {
  const time = text.match(/(\d{1,2}):(\d{2})/);
  const [hours, minutes] = time ? [Number(time[1]), Number(time[2])] : [0, 0];
  if (/только что/i.test(text)) {
    return now.getTime();
  }
  const ago = text.match(/(\d+)?\s*(минут|час)[а-я]*\s+назад/i);
  if (ago) {
    const unit = ago[2].toLowerCase() === 'час' ? 60 * 60 * 1000 : 60 * 1000;
    return now.getTime() - Number(ago[1] ?? 1) * unit;
  }
  const relative = text.match(/(сегодня|вчера)/i);
  if (relative) {
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    if (relative[1].toLowerCase() === 'вчера') {
      date.setDate(date.getDate() - 1);
    }
    return date.getTime();
  }
  const numeric = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (numeric) {
    return new Date(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]), hours, minutes).getTime();
  }
  const absolute = text.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/i);
  const month = absolute && MONTHS.findIndex((prefix) => absolute[2].toLowerCase().startsWith(prefix));
  if (!absolute || month === -1) {
    return null;
  }
  const date = new Date(Number(absolute[3] ?? now.getFullYear()), month, Number(absolute[1]), hours, minutes);
  if (!absolute[3] && date.getTime() > now.getTime() + DAY_MS) {
    // "30 декабря" read in January is last year's
    date.setFullYear(date.getFullYear() - 1);
  }
  return date.getTime();
}

/**
 * Read hh.ru's resume list state (the JSON of the `…-InitialState` template)
 * @param {string|null} text - Template content
 * @returns {{resumes: Array<{hash: string, title: string, updatedAt: number|null, latest: boolean}>, latestHash: string|null}|null}
 */
export function parseResumeState(text) {
  if (!text || !text.includes('applicantResumes')) {
    return null;
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    try {
      state = JSON.parse(text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(state?.applicantResumes)) {
    return null;
  }
  const latestHash = typeof state.latestResumeHash === 'string' ? state.latestResumeHash : null;
  const resumes = state.applicantResumes
    .map((resume) => {
      const attributes = resume?._attributes ?? {};
      const updatedAt = Number(attributes.updated ?? attributes.lastEditTime);
      return {
        hash: attributes.hash ?? null,
        title: [resume?.title ?? []].flat().map((part) => part?.string ?? '').join('').trim(),
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
        latest: Boolean(latestHash) && attributes.hash === latestHash,
      };
    })
    .filter((resume) => resume.hash);
  return { resumes, latestHash };
}

/**
 * The resume list state inside a whole hh.ru page (as fetched, not parsed into a DOM)
 * @param {string} html
 * @returns {string|null} Template content holding `applicantResumes`
 */
export function resumeStateFromHtml(html) {
  for (const match of String(html).matchAll(/<template\b[^>]*InitialState[^>]*>([\s\S]*?)<\/template>/g)) {
    if (match[1].includes('"applicantResumes"')) {
      return match[1];
    }
  }
  return null;
}

/**
 * Local date and time for logs: 2026-10-07 14:28
 * @param {number} timestamp
 * @returns {string}
 */
export function formatUpdatedAt(timestamp) {
  const date = new Date(timestamp);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Pick the most recently updated resume and say why
 *
 * 1. The latest update date (hh.ru's state, else a visible «Обновлено …» text); equal dates keep list order
 * 2. hh.ru's `latestResumeHash` when no resume has a date
 * 3. hh.ru's list order (the first resume)
 *
 * @param {Array<{updatedAt?: number|null, updatedText?: string|null, latest?: boolean}>} resumes - In page order
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @returns {{resume: Object|undefined, updatedAt: number|null, reason: string}}
 */
export function pickResume(resumes, { now = new Date() } = {}) {
  if (resumes.length === 0) {
    return { resume: undefined, updatedAt: null, reason: 'no resumes' };
  }
  const dated = resumes
    .map((resume) => ({
      resume,
      updatedAt: resume.updatedAt ?? (resume.updatedText ? parseUpdatedAt(resume.updatedText, now) : null),
    }))
    .filter(({ updatedAt }) => updatedAt !== null);
  if (dated.length > 0) {
    const best = dated.reduce((current, item) => (item.updatedAt > current.updatedAt ? item : current));
    return {
      resume: best.resume,
      updatedAt: best.updatedAt,
      reason: `updated ${formatUpdatedAt(best.updatedAt)}, the latest of ${dated.length} dated resume(s)`,
    };
  }
  const latest = resumes.find((resume) => resume.latest);
  if (latest) {
    return { resume: latest, updatedAt: null, reason: 'no update dates; hh.ru marks it as the latest resume' };
  }
  return { resume: resumes[0], updatedAt: null, reason: "no update date found; hh.ru's list order" };
}

/**
 * The most recently updated resume (see pickResume)
 * @param {Array<Object>} resumes - In page order
 * @param {Object} [options]
 * @returns {Object|undefined}
 */
export function chooseResume(resumes, options) {
  return pickResume(resumes, options).resume;
}

/**
 * Resumes of the page merged with the update dates of hh.ru's state, by hash
 * @param {Array<Object>} listed - Read from the resume cards
 * @param {string|null} stateText - Content of the state template
 * @returns {Array<Object>}
 */
export function mergeResumeState(listed, stateText) {
  const state = parseResumeState(stateText);
  if (!state) {
    return listed;
  }
  if (listed.length === 0) {
    return state.resumes;
  }
  const byHash = new Map(state.resumes.map((resume) => [resume.hash, resume]));
  return listed.map((resume) => {
    const known = byHash.get(resume.hash);
    return known ? { ...resume, updatedAt: known.updatedAt, latest: known.latest } : resume;
  });
}

/**
 * Read the resumes listed on the current profile page, with their update dates
 * @param {Object} commander - Browser commander instance
 * @returns {Promise<Array<{hash: string, title: string, searchUrl: string|null, updatedText: string|null, updatedAt?: number|null, latest?: boolean}>>}
 */
export async function readResumes(commander) {
  const { listed, stateText } = await commander.evaluate(({ resume, resumeCardLink, resumeRecommendations }) => ({
    listed: [...document.querySelectorAll(resume)].map((block) => ({
      hash: block.querySelector(resumeCardLink)?.getAttribute('data-qa').replace('resume-card-link-', '') ?? null,
      title: block.getAttribute('data-qa-title') ?? '',
      searchUrl: block.querySelector(resumeRecommendations)?.href ?? null,
      updatedText: block.textContent.match(/обновлен[оа]?\s[^·•]{0,40}/i)?.[0] ?? null,
    })),
    // A template's text lives in its content fragment; reading it adds nothing to the page
    stateText: [...document.querySelectorAll('template')]
      .map((template) => template.content?.textContent || template.textContent)
      .find((text) => text.includes('"applicantResumes"')) ?? null,
  }), { resume: SELECTORS.resume, resumeCardLink: SELECTORS.resumeCardLink, resumeRecommendations: SELECTORS.resumeRecommendations });
  return mergeResumeState(listed, stateText);
}

const PROFILE_URL = 'https://hh.ru/applicant/resumes';

/**
 * Log line naming the chosen resume and why
 * @param {Object} choice - pickResume result
 * @param {number} count
 * @returns {string}
 */
export function describeChoice({ resume, reason }, count) {
  return `📄 Using resume "${resume.title || resume.hash}" of ${count}: ${reason}`;
}

/**
 * URL of the suggested vacancies for the most recently updated resume
 * @param {Object} commander - Browser commander instance
 * @returns {Promise<string|null>}
 */
export async function findSuggestedVacanciesUrl(commander) {
  if (await commander.count({ selector: SELECTORS.resume }) === 0) {
    await commander.goto({ url: PROFILE_URL, waitForStableUrlBefore: false });
  }
  const resumes = await readResumes(commander);
  const choice = pickResume(resumes);
  if (!choice.resume) {
    return null;
  }
  console.log(describeChoice(choice, resumes.length));
  return choice.resume.searchUrl ?? `https://hh.ru/search/vacancy?resume=${choice.resume.hash}&from=resumelist`;
}

/**
 * The open search page's URL, switched to the most recently updated resume when it shows another one.
 * Its filters are kept; the resume list is fetched once from inside the page (no navigation).
 * @param {Object} commander - Browser commander instance
 * @param {string} url - Search URL with a `resume` parameter
 * @returns {Promise<string>}
 */
export async function latestResumeSearchUrl(commander, url) {
  const current = new URL(url).searchParams.get('resume');
  const html = await commander.evaluate(async (resumesUrl) => {
    try {
      const response = await fetch(resumesUrl, { credentials: 'include' });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  }, PROFILE_URL).catch(() => null);
  const state = parseResumeState(resumeStateFromHtml(html ?? ''));
  const choice = state ? pickResume(state.resumes) : { resume: undefined };
  if (!choice.resume) {
    console.log('📄 Keeping the resume of the open search page: the resume list could not be read');
    return url;
  }
  console.log(describeChoice(choice, state.resumes.length));
  if (choice.resume.hash === current) {
    return url;
  }
  const switched = new URL(url);
  switched.searchParams.set('resume', choice.resume.hash);
  console.log('📄 The open search page showed another resume; switching, filters kept');
  return switched.toString();
}
