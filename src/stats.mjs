#!/usr/bin/env bun
/**
 * What the automation did, day by day: `bun run stats [-- --days <n>]`
 *
 * Each event is one JSON line in logs/stats.jsonl (personal: logs/ stays out of git), written by
 * the application loop and the chat window alike:
 *   application_sent  {vacancyId, ms}        ms: from the start of work on the vacancy to the send
 *   vacancy_skipped   {vacancyId, reason}
 *   captcha           {ms, ai}               ai: Haiku's reading was sent (else the user solved it)
 *   rejection_read    {chatId, live}         live: read as it showed in the chat window
 *   letter_attached   {vacancyId, via}
 *   limit_reached     {}                     hh.ru's daily limit of applications
 *
 * @module stats
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATS_FILE = path.join(process.cwd(), 'logs', 'stats.jsonl');
/** An application should take less than this, its pause before the next one included */
export const APPLICATION_TARGET_MS = 7 * 60 * 1000;

/**
 * Record an event; a failure to write never stops the automation
 * @param {string} type
 * @param {Object} [data]
 * @param {string} [file]
 */
export function recordEvent(type, data = {}, file = STATS_FILE) {
  // The tests' events are not the user's
  if (file === STATS_FILE && process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), type, ...data })}\n`);
  } catch {
    // Stats are a convenience
  }
}

/** @returns {Array<Object>} The events, the broken lines left out */
export function readEvents(file = STATS_FILE) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

/** The local day of a time: «2026-10-16» */
const dayOf = (at) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * The events counted by day
 * @param {Array<Object>} events
 * @returns {Array<{day: string, applications: number, perHour: number|null, typicalMs: number|null, longestMs: number|null,
 *   overTarget: number, captchas: number, captchasByAi: number, skipped: number, rejections: number, rejectionsLive: number,
 *   letters: number, limit: boolean}>} The latest day last
 */
export function summarizeByDay(events) {
  const days = new Map();
  for (const event of events) {
    const day = dayOf(event.at);
    if (!days.has(day)) {
      days.set(day, []);
    }
    days.get(day).push(event);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => {
    const of = (type) => list.filter((event) => event.type === type);
    const sent = of('application_sent');
    const times = sent.map((event) => event.ms).filter(Number.isFinite).sort((a, b) => a - b);
    // From one send to the next: what an application takes with its pause
    const gaps = sent.map((event) => Date.parse(event.at)).sort((a, b) => a - b)
      .flatMap((at, index, all) => (index > 0 ? [at - all[index - 1]] : []));
    const hours = sent.length > 1 ? (Date.parse(sent.at(-1).at) - Date.parse(sent[0].at)) / 3600000 : 0;
    return {
      day,
      applications: sent.length,
      perHour: hours > 0 ? (sent.length - 1) / hours : null,
      typicalMs: times.length ? times[Math.floor(times.length / 2)] : null,
      longestMs: times.length ? times.at(-1) : null,
      overTarget: gaps.filter((gap) => gap > APPLICATION_TARGET_MS).length,
      captchas: of('captcha').length,
      captchasByAi: of('captcha').filter((event) => event.ai).length,
      skipped: of('vacancy_skipped').filter((event) => event.reason !== 'letter_not_attached').length,
      rejections: of('rejection_read').length,
      rejectionsLive: of('rejection_read').filter((event) => event.live).length,
      letters: of('letter_attached').length,
      limit: of('limit_reached').length > 0,
    };
  });
}

const minutes = (ms) => (ms === null ? '-' : `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`);

/**
 * @param {ReturnType<typeof summarizeByDay>} days
 * @returns {string[]} One line a day
 */
export function formatDays(days) {
  return days.map((day) => [
    `📊 ${day.day}: ${day.applications} application(s)${day.limit ? ' (hh.ru\'s daily limit reached)' : ''}`,
    day.perHour === null ? null : `${day.perHour.toFixed(1)}/h`,
    `work on one ${minutes(day.typicalMs)} typical, ${minutes(day.longestMs)} longest`,
    `${day.overTarget} over 7 min with the pause`,
    `${day.captchas} captcha(s) (${day.captchasByAi} by AI)`,
    `${day.skipped} skipped`,
    `${day.rejections} rejection(s) read (${day.rejectionsLive} as they came)`,
    day.letters ? `${day.letters} letter(s) attached later` : null,
  ].filter(Boolean).join(', '));
}

/** The line for today, printed when a run starts */
export function todayLine(file = STATS_FILE) {
  const today = summarizeByDay(readEvents(file)).find((day) => day.day === dayOf(Date.now()));
  return today ? formatDays([today])[0] : '📊 Today: nothing yet';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const days = Number(args.includes('--days') ? args[args.indexOf('--days') + 1] : 14);
  const summary = summarizeByDay(readEvents()).slice(-days);
  console.log(summary.length ? formatDays(summary).join('\n') : `📊 No stats yet (${path.relative(process.cwd(), STATS_FILE)})`);
}
