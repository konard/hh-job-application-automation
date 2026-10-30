/**
 * Pauses between vacancies. By default the pace adapts (ADAPTIVE_PACE below): as fast as hh.ru
 * allows without captchas, between 1 and 4 min. A fixed --job-application-interval is used as is.
 * Either way a pause is the interval plus a random extra of up to a quarter of it, counted from the
 * start of work on a vacancy.
 *
 * @module pacing
 */

/** hh.ru allows this many applications a day */
export const DAILY_APPLICATION_LIMIT = 200;
/** The wait after hh.ru's daily limit, before the next try */
export const LIMIT_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/**
 * Until when the daily limit holds: the explicit deadline of the latest limit_reached event,
 * or its time plus LIMIT_COOLDOWN_MS for older records. Restarts preserve the hold; 0 once over.
 * @param {Array<Object>} events - Of stats.mjs
 * @param {number} [now=Date.now()]
 * @returns {number} Milliseconds since the epoch, or 0
 */
export function limitHeldUntil(events, now = Date.now()) {
  const last = events.filter((event) => event.type === 'limit_reached').at(-1);
  const until = last ? (Number.isFinite(last.until) ? last.until : Date.parse(last.at) + LIMIT_COOLDOWN_MS) : 0;
  return until > now ? until : 0;
}

/** The random extra is up to this share of the interval */
const RANDOM_SHARE = 0.25;

/**
 * Pause before the next vacancy: the interval plus a random extra of up to a quarter of it
 * @param {Object} options
 * @param {number} options.intervalMs - --job-application-interval in ms
 * @param {Function} [options.random=Math.random]
 * @returns {number} Milliseconds, rounded to whole seconds
 */
export function pauseMs({ intervalMs, random = Math.random, maxIntervalMs = Infinity }) {
  return Math.min(maxIntervalMs, Math.round(intervalMs * (1 + random() * RANDOM_SHARE) / 1000) * 1000);
}

/** The least time between an application sent and the next vacancy opened: 30-60 s */
const LEAST_GAP_MS = 30000;

/**
 * When the next vacancy may be opened: the pause counts from the start of work on the last one
 * (so a long form or a captcha does not add a whole pause on top), and never sooner than 30-60 s
 * after the send. Adaptive jitter is capped at four minutes; manual work may take longer.
 * @param {Object} options
 * @param {number} options.startedAt - When work on the last vacancy began
 * @param {number} options.intervalMs
 * @param {number} [options.now]
 * @param {Function} [options.random=Math.random]
 * @returns {number} A time in ms
 */
export function nextVacancyAt({ startedAt, intervalMs, maxIntervalMs = Infinity, now = Date.now(), random = Math.random }) {
  return Math.max(startedAt + pauseMs({ intervalMs, maxIntervalMs, random }), now + LEAST_GAP_MS * (1 + random()));
}

/**
 * Applications a day of continuous work allows when every pause is the longest one
 * @param {number} intervalMs
 * @returns {number}
 */
export function worstCaseApplicationsPerDay(intervalMs, { maxIntervalMs = Infinity } = {}) {
  const longestCycleMs = Math.min(maxIntervalMs, intervalMs * (1 + RANDOM_SHARE));
  return Math.floor((24 * 60 * 60 * 1000) / longestCycleMs);
}

/**
 * The adaptive pace (the default): the interval between vacancies looks for the fastest pace hh.ru
 * accepts without captchas. It starts at 2 min; each application sent takes 10-20 s off it (down to
 * 1 min), each captcha on hh.ru adds one step (10-20 s, up to 4 min). A captcha holds speed-up
 * for five minutes. Repeated captchas can extend that hold only until 15 minutes after its first
 * captcha; the next successful application can then speed up, even if captchas kept arriving.
 */
export const PACING_POLICY_VERSION = 2;
export const ADAPTIVE_PACE = {
  minMs: 60000,
  maxMs: 4 * 60000,
  startMs: 2 * 60000,
  stepMs: [10000, 20000],
  penalty: 1,
  holdMs: 5 * 60000,
  maxHoldMs: 15 * 60000,
};

/** Start the revised policy once at two minutes without deleting historical statistics. */
export function pacingResetNeeded(events) {
  return events.findLast((event) => event.type === 'pacing_reset')?.policyVersion !== PACING_POLICY_VERSION;
}

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
  const state = { intervalMs: Math.min(pace.maxMs, Math.max(pace.minMs, reset?.intervalMs ?? pace.startMs)), holdUntil: 0, holdMs: 0, applications: 0, captchas: 0, since: reset?.at ?? null };
  if (!reset) {
    return state;
  }
  let holdStartedAt = null;
  const later = events.slice(resetAt + 1).map((event) => ({ event, at: Date.parse(event.at) - (event.type === 'captcha' ? event.ms ?? 0 : 0) }))
    .sort((a, b) => a.at - b.at);
  for (const { event, at } of later) {
    if (event.type === 'application_sent') {
      state.applications += 1;
      if (at >= state.holdUntil) {
        state.intervalMs = Math.max(pace.minMs, state.intervalMs - stepOf(event, pace.stepMs));
        state.holdUntil = 0;
        state.holdMs = 0;
        holdStartedAt = null;
      }
    } else if (isCaptchaEpisode(event) && onHh(event)) {
      state.captchas += 1;
      state.intervalMs = Math.min(pace.maxMs, state.intervalMs + pace.penalty * stepOf(event, pace.stepMs));
      holdStartedAt ??= at;
      state.holdUntil = Math.min(at + pace.holdMs, holdStartedAt + pace.maxHoldMs);
      state.holdMs = Math.max(0, state.holdUntil - at);
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
