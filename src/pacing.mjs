/**
 * Pauses between vacancies: one even pace, sized so that hh.ru's limit of 200 applications
 * a day still fits into a day of continuous work.
 *
 * With the default 240 s interval a pause is 240-300 s; with ~30 s to open and send an
 * application that is 270-330 s per vacancy, 261-320 applications a day, which leaves room
 * for skipped vacancies and captchas.
 *
 * @module pacing
 */

/** hh.ru allows this many applications a day */
export const DAILY_APPLICATION_LIMIT = 200;
/** Time to open a vacancy and send the application, besides the pause */
export const APPLICATION_WORK_MS = 30000;
/** The random extra is up to this share of the interval */
const RANDOM_SHARE = 0.25;

/**
 * Pause before the next vacancy: the interval plus a random extra of up to a quarter of it
 * @param {Object} options
 * @param {number} options.intervalMs - --job-application-interval in ms
 * @param {Function} [options.random=Math.random]
 * @returns {number} Milliseconds, rounded to whole seconds
 */
export function pauseMs({ intervalMs, random = Math.random }) {
  return Math.round(intervalMs * (1 + random() * RANDOM_SHARE) / 1000) * 1000;
}

/**
 * Applications a day of continuous work allows when every pause is the longest one
 * @param {number} intervalMs
 * @returns {number}
 */
export function worstCaseApplicationsPerDay(intervalMs) {
  const longestCycleMs = intervalMs * (1 + RANDOM_SHARE) + APPLICATION_WORK_MS;
  return Math.floor((24 * 60 * 60 * 1000) / longestCycleMs);
}
