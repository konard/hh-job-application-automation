/**
 * Resume (CV) selection: Russian by default for search; date ordering within each language.
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
import fs from 'node:fs/promises';
import path from 'node:path';
import { resumeLanguage } from './cv.mjs';

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** The month of a name, in Russian or English; -1 when it is none */
const monthOf = (name) => {
  const lower = name.toLowerCase();
  const en = MONTHS_EN.findIndex((prefix) => lower.startsWith(prefix));
  return en !== -1 ? en : MONTHS.findIndex((prefix) => lower.startsWith(prefix));
};
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse an hh.ru update date such as "Резюме обновлено 7 октября 2026 в 14:28",
 * "сегодня в 9:05", "вчера в 23:10", "07.10.2026 14:28" or "5 минут назад", and the same in
 * English: "Updated 7 October 2026 at 14:28", "October 7", "today at 9:05", "5 minutes ago"
 * @param {string} text
 * @param {Date} [now=new Date()]
 * @returns {number|null} Timestamp or null when the text has no date
 */
export function parseUpdatedAt(text, now = new Date()) {
  const time = text.match(/(\d{1,2}):(\d{2})/);
  const [hours, minutes] = time ? [Number(time[1]), Number(time[2])] : [0, 0];
  if (/только что|just now/i.test(text)) {
    return now.getTime();
  }
  const ago = text.match(/(\d+|an?)?\s*(минут|час|minute|hour)\p{L}*\s+(?:назад|ago)/iu);
  if (ago) {
    const unit = /^(?:час|hour)/i.test(ago[2]) ? 60 * 60 * 1000 : 60 * 1000;
    return now.getTime() - (Number(ago[1]) || 1) * unit;
  }
  const relative = text.match(/(сегодня|вчера|today|yesterday)/i);
  if (relative) {
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    if (/^(?:вчера|yesterday)$/i.test(relative[1])) {
      date.setDate(date.getDate() - 1);
    }
    return date.getTime();
  }
  const numeric = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (numeric) {
    return new Date(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]), hours, minutes).getTime();
  }
  // «7 октября 2026», "7 October 2026" or "October 7, 2026"
  const dayFirst = text.match(/(\d{1,2})\s+([a-zа-яё]+)(?:\s+(\d{4}))?/i);
  const monthFirst = text.match(/([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  const absolute = dayFirst && monthOf(dayFirst[2]) !== -1 ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] }
    : monthFirst && monthOf(monthFirst[1]) !== -1 ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] } : null;
  if (!absolute) {
    return null;
  }
  const date = new Date(Number(absolute.year ?? now.getFullYear()), monthOf(absolute.month), Number(absolute.day), hours, minutes);
  if (!absolute.year && date.getTime() > now.getTime() + DAY_MS) {
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
    // The page as served encodes the JSON's quotes (&quot;); a page saved from the DOM does not
    const state = decodeEntities(match[1]);
    if (state.includes('"applicantResumes"')) {
      return state;
    }
  }
  return null;
}

/**
 * Text with its HTML entities decoded: &quot; &amp; &lt; &gt; &#39; and numeric ones
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  const named = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    }
    return named[code.toLowerCase()] ?? entity;
  });
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
      updatedText: block.textContent.match(/(?:обновлен[оа]?|updated)\s[^·•]{0,40}/i)?.[0] ?? null,
    })),
    // A template's text lives in its content fragment; reading it adds nothing to the page
    stateText: [...document.querySelectorAll('template')]
      .map((template) => template.content?.textContent || template.textContent)
      .find((text) => text.includes('"applicantResumes"')) ?? null,
  }), { resume: SELECTORS.resume, resumeCardLink: SELECTORS.resumeCardLink, resumeRecommendations: SELECTORS.resumeRecommendations });
  return mergeResumeState(listed, stateText);
}

const PROFILE_URL = 'https://hh.ru/applicant/resumes';

/** Saved exports identify the actual CV language even when its job title is English. */
export async function loadApplicationResumes(directory = path.join(process.cwd(), 'data/resume/cv')) {
  const entries = await fs.readdir(directory).catch(() => []);
  const resumes = await Promise.all(entries.filter((entry) => /^[a-z0-9]+$/i.test(entry)).map(async (hash) => {
    const resume = await fs.readFile(path.join(directory, hash, 'resume.json'), 'utf8').then(JSON.parse).catch(() => null);
    return resume?.hash === hash ? { hash, title: resume.title, language: resumeLanguage(resume), updatedText: resume.updated } : null;
  }));
  return resumes.filter(Boolean);
}

/** Prefer Russian for suggested vacancies, regardless of which translation was edited last. */
export function pickSearchResume(resumes, knownResumes = []) {
  const languages = new Map(knownResumes.map((resume) => [resume.hash, resume.language]));
  const russian = resumes.filter((resume) => languages.has(resume.hash)
    ? languages.get(resume.hash) === 'ru' : /[а-яё]/iu.test(resume.title ?? ''));
  const choice = pickResume(russian.length ? russian : resumes);
  return russian.length ? { ...choice, reason: `Russian CV is the search default; ${choice.reason}` } : choice;
}

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
 * Suggested vacancies for the Russian search CV, falling back to the latest available CV.
 * @param {Object} commander - Browser commander instance
 * @returns {Promise<string|null>}
 */
export async function findSuggestedVacanciesUrl(commander, { knownResumes } = {}) {
  if (await commander.count({ selector: SELECTORS.resume }) === 0) {
    // hh.ru's beacons keep the network busy: waiting for it to go idle took the 4-minute timeout
    await commander.goto({ url: PROFILE_URL, waitForNetworkIdle: false, waitForStableUrlBefore: false });
  }
  const resumes = await readResumes(commander);
  const choice = pickSearchResume(resumes, knownResumes ?? await loadApplicationResumes());
  if (!choice.resume) {
    return null;
  }
  console.log(describeChoice(choice, resumes.length));
  return choice.resume.searchUrl ?? `https://hh.ru/search/vacancy?resume=${choice.resume.hash}&from=resumelist`;
}

/**
 * Switch the open matching search to the Russian CV when it shows another one.
 * Its filters are kept; the resume list is fetched once from inside the page (no navigation).
 * @param {Object} commander - Browser commander instance
 * @param {string} url - Search URL with a `resume` parameter
 * @returns {Promise<string>}
 */
export async function latestResumeSearchUrl(commander, url, { knownResumes } = {}) {
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
  const choice = state ? pickSearchResume(state.resumes, knownResumes ?? await loadApplicationResumes()) : { resume: undefined };
  if (!choice.resume) {
    console.log('📄 Keeping the search URL: the resume list could not be read');
    return url;
  }
  console.log(describeChoice(choice, state.resumes.length));
  if (choice.resume.hash === current) {
    return url;
  }
  const switched = new URL(url);
  switched.searchParams.set('resume', choice.resume.hash);
  console.log(current ? '📄 The matching search used another resume; updating its URL, filters kept'
    : '📄 Prepared the matching-search URL for the selected resume; the open form is unchanged');
  return switched.toString();
}

/** Restart on an unfinished application without navigating away from its answers. */
export async function resolveApplicationStart(commander, explicitUrl, options = {}) {
  if (explicitUrl) return { startUrl: explicitUrl, preserveCurrentForm: false };
  const current = commander.getUrl();
  if (/^https:\/\/hh\.ru\/applicant\/vacancy_response\?/.test(current)) {
    const startUrl = await latestResumeSearchUrl(commander, 'https://hh.ru/search/vacancy?from=resumelist', options);
    return { startUrl, preserveCurrentForm: true };
  }
  const startUrl = /^https:\/\/hh\.ru\/search\/vacancy\?/.test(current) && current.includes('resume=')
    ? await latestResumeSearchUrl(commander, current, options)
    : await findSuggestedVacanciesUrl(commander, options);
  return { startUrl, preserveCurrentForm: false };
}
