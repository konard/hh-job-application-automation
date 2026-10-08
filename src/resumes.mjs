/**
 * Resume (CV) selection: find the most recently updated resume and its suggested vacancies
 *
 * @module resumes
 */

import { SELECTORS } from './hh-selectors.mjs';

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

/**
 * Parse an hh.ru update date such as "Обновлено 5 октября 2026 в 14:30", "сегодня в 9:05" or "вчера в 23:10"
 * @param {string} text
 * @param {Date} [now=new Date()]
 * @returns {number|null} Timestamp or null when the text has no date
 */
export function parseUpdatedAt(text, now = new Date()) {
  const time = text.match(/(\d{1,2}):(\d{2})/);
  const [hours, minutes] = time ? [Number(time[1]), Number(time[2])] : [0, 0];
  const relative = text.match(/(сегодня|вчера)/i);
  if (relative) {
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    if (relative[1].toLowerCase() === 'вчера') {
      date.setDate(date.getDate() - 1);
    }
    return date.getTime();
  }
  const absolute = text.match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/i);
  const month = absolute && MONTHS.findIndex((prefix) => absolute[2].toLowerCase().startsWith(prefix));
  if (!absolute || month === -1) {
    return null;
  }
  return new Date(Number(absolute[3] ?? now.getFullYear()), month, Number(absolute[1]), hours, minutes).getTime();
}

/**
 * Pick the most recently updated resume. Resumes without a visible update date keep
 * hh.ru's own order (the first one wins).
 * @param {Array<{updatedText: string|null}>} resumes - In page order
 * @returns {Object|undefined}
 */
export function chooseResume(resumes) {
  const dated = resumes
    .map((resume) => ({ resume, updatedAt: resume.updatedText ? parseUpdatedAt(resume.updatedText) : null }))
    .filter(({ updatedAt }) => updatedAt !== null);
  if (dated.length === 0) {
    return resumes[0];
  }
  return dated.reduce((best, item) => (item.updatedAt > best.updatedAt ? item : best)).resume;
}

/**
 * Read the resumes listed on the current profile page
 * @param {Object} commander - Browser commander instance
 * @returns {Promise<Array<{hash: string, title: string, searchUrl: string|null, updatedText: string|null}>>}
 */
export function readResumes(commander) {
  return commander.evaluate(({ resume, resumeCardLink, resumeRecommendations }) =>
    [...document.querySelectorAll(resume)].map((block) => ({
      hash: block.querySelector(resumeCardLink)?.getAttribute('data-qa').replace('resume-card-link-', '') ?? null,
      title: block.getAttribute('data-qa-title') ?? '',
      searchUrl: block.querySelector(resumeRecommendations)?.href ?? null,
      updatedText: block.textContent.match(/обновлен[оа]?\s[^·•]{0,40}/i)?.[0] ?? null,
    })), { resume: SELECTORS.resume, resumeCardLink: SELECTORS.resumeCardLink, resumeRecommendations: SELECTORS.resumeRecommendations });
}

const PROFILE_URL = 'https://hh.ru/applicant/resumes';

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
  const resume = chooseResume(resumes);
  if (!resume) {
    return null;
  }
  console.log(`📄 Using resume "${resume.title}"${resume.updatedText ? ` (${resume.updatedText})` : ''} of ${resumes.length}`);
  return resume.searchUrl ?? `https://hh.ru/search/vacancy?resume=${resume.hash}&from=resumelist`;
}
