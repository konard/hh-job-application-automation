/**
 * Pauses between vacancies: one even pace, sized so that hh.ru's limit of 200 applications
 * a day still fits into a day of continuous work.
 *
 * With the default 240 s interval a pause is 240-300 s, counted from the start of work on a
 * vacancy: 240-300 s per vacancy when its work is shorter, 288-360 applications a day, which leaves
 * room for skipped vacancies, captchas and forms that wait for the user.
 *
 * @module pacing
 */

/** hh.ru allows this many applications a day */
export const DAILY_APPLICATION_LIMIT = 200;
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

/** The least time between an application sent and the next vacancy opened: 30-60 s */
const LEAST_GAP_MS = 30000;

/**
 * When the next vacancy may be opened: the pause counts from the start of work on the last one
 * (so a long form or a captcha does not add a whole pause on top), and never sooner than 30-60 s
 * after the send. An application then takes the pause, 240-300 s by default (under 7 min), unless
 * its own work is longer
 * @param {Object} options
 * @param {number} options.startedAt - When work on the last vacancy began
 * @param {number} options.intervalMs
 * @param {number} [options.now]
 * @param {Function} [options.random=Math.random]
 * @returns {number} A time in ms
 */
export function nextVacancyAt({ startedAt, intervalMs, now = Date.now(), random = Math.random }) {
  return Math.max(startedAt + pauseMs({ intervalMs, random }), now + LEAST_GAP_MS * (1 + random()));
}

/**
 * Applications a day of continuous work allows when every pause is the longest one
 * @param {number} intervalMs
 * @returns {number}
 */
export function worstCaseApplicationsPerDay(intervalMs) {
  const longestCycleMs = intervalMs * (1 + RANDOM_SHARE);
  return Math.floor((24 * 60 * 60 * 1000) / longestCycleMs);
}
