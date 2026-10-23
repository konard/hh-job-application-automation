/**
 * Pauses between vacancies. By default the pace adapts (ADAPTIVE_PACE below): as fast as hh.ru
 * allows without captchas, between 1 and 7 min. A fixed --job-application-interval is used as is.
 * Either way a pause is the interval plus a random extra of up to a quarter of it, counted from the
 * start of work on a vacancy.
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

/**
 * The adaptive pace (the default): the interval between vacancies looks for the fastest pace hh.ru
 * accepts without captchas. It starts at 2 min; each application sent takes 10-20 s off it (down to
 * 1 min), each captcha on hh.ru adds twice that (20-40 s, up to 7 min). After a captcha the pace is
 * held for a while before it is tried faster again: 15 min, doubled while captchas keep coming within
 * one more hold after the last one, and never longer than a day, so a faster pace is tried at least
 * once a day.
 */
export const ADAPTIVE_PACE = {
  minMs: 60000,
  maxMs: 7 * 60000,
  startMs: 2 * 60000,
  stepMs: [10000, 20000],
  penalty: 2,
  holdMs: 15 * 60000,
  maxHoldMs: 24 * 60 * 60000,
};

/** A step of 10-20 s, drawn from the event itself, so the same history always gives the same pace */
function stepOf(event, [least, most]) {
  let hash = 0;
  for (const char of `${event.at}${event.vacancyId ?? ''}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const seconds = Math.round((most - least) / 1000);
  return least + (hash % (seconds + 1)) * 1000;
}

/** A captcha that counts for the pace: one on hh.ru (the older events name no site: the main window's) */
const onHh = (event) => !event.host || /(^|\.)hh\.ru$/.test(event.host);

/**
 * The adaptive pace now, from the stats events since the last pacing_reset
 * @param {Array<Object>} events - stats.jsonl events (stats.mjs)
 * @param {Object} [pace=ADAPTIVE_PACE]
 * @returns {{intervalMs: number, holdUntil: number, holdMs: number, applications: number, captchas: number, since: string|null}}
 */
export function adaptivePace(events, pace = ADAPTIVE_PACE) {
  const resetAt = events.findLastIndex((event) => event.type === 'pacing_reset');
  const reset = events[resetAt];
  const state = { intervalMs: reset?.intervalMs ?? pace.startMs, holdUntil: 0, holdMs: 0, applications: 0, captchas: 0, since: reset?.at ?? null };
  if (!reset) {
    return state;
  }
  let lastCaptchaAt = null;
  const later = events.slice(resetAt + 1).map((event) => ({ event, at: Date.parse(event.at) - (event.type === 'captcha' ? event.ms ?? 0 : 0) }))
    .sort((a, b) => a.at - b.at);
  for (const { event, at } of later) {
    if (event.type === 'application_sent') {
      state.applications += 1;
      if (at >= state.holdUntil) {
        state.intervalMs = Math.max(pace.minMs, state.intervalMs - stepOf(event, pace.stepMs));
      }
    } else if (isCaptchaEpisode(event) && onHh(event)) {
      state.captchas += 1;
      state.intervalMs = Math.min(pace.maxMs, state.intervalMs + pace.penalty * stepOf(event, pace.stepMs));
      // Captchas again soon after the last hold: the faster pace is tried less often
      const again = lastCaptchaAt !== null && at - lastCaptchaAt < 2 * state.holdMs;
      state.holdMs = again ? Math.min(pace.maxHoldMs, state.holdMs * 2) : pace.holdMs;
      state.holdUntil = at + state.holdMs;
      lastCaptchaAt = at;
    }
  }
  return state;
}

/**
 * One event per captcha: captcha_shown when it was seen, or (older events, and a run that wrote no
 * captcha_shown) the captcha event written once it was gone
 * @param {Object} event
 * @returns {boolean}
 */
export const isCaptchaEpisode = (event) => event.type === 'captcha_shown' || (event.type === 'captcha' && !event.shown);
