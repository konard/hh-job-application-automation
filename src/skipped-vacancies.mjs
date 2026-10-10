/**
 * Vacancies skipped by the run: none is skipped silently. Every skip is logged and kept in
 * data/skipped-vacancies.lino with the reason, the time and, when known, the title and the
 * employer's application link, so the vacancy is not opened again on the next run (or once more
 * for a transient reason) and the user can see and handle what was left.
 *
 * File format (Links Notation, like qa.lino; one vacancy ID with its fields):
 *   138295841
 *     "reason: external_site"
 *     "title: Go-разработчик | Ромашка"
 *     "url: https://career.example.com/jobs/1"
 *     "time: 2026-10-10T12:00:00.000Z"
 *     "attempts: 1"
 *
 * Whether a recorded vacancy is opened again depends on its reason (SKIP_REASONS):
 * - never:  final until the user removes the entry (`bun run skipped -- --clear <reason|id>`)
 * - once:   transient (a timeout, a button that did not respond): opened again on a later run;
 *           skipped a second time, it is final
 * - questionnaire: final while --ignore-vacancies-with-questionnaire is on
 * - deferred: data/deferred-questions.lino decides (opened once its questions are answered)
 * Filtered vacancies are kept by vacancy-filters.mjs in data/filtered-vacancies.lino.
 *
 * The file holds only public vacancy data (IDs, titles from the vacancy card, the employer's
 * link) and is committed like deferred-questions.lino.
 *
 * @module skipped-vacancies
 */

import fs from 'fs/promises';
import { createQADatabase } from './qa-database.mjs';
import { createMutex } from './helpers/mutex.mjs';

/**
 * Reasons of a skip and whether the vacancy is opened again
 * @type {Object<string, {retry: 'never'|'once'|'questionnaire'|'deferred', text: string}>}
 */
export const SKIP_REASONS = {
  external_site: { retry: 'never', text: 'applied on the employer\'s site (bun run prefill-form -- <url>)' },
  resume_not_visible: { retry: 'never', text: 'the resume is not visible to all employers' },
  skipped_by_user: { retry: 'never', text: 'skipped by the user (s, or the popup closed without sending)' },
  unanswered_questions: { retry: 'once', text: 'questions without saved answers' },
  questions_deferred: { retry: 'deferred', text: 'waits for answers in deferred-questions.lino' },
  questionnaire_ignored: { retry: 'questionnaire', text: '--ignore-vacancies-with-questionnaire' },
  apply_button_disabled: { retry: 'once', text: 'the «Откликнуться» button on the list was disabled' },
  apply_click_failed: { retry: 'once', text: 'the «Откликнуться» button on the list could not be clicked' },
  modal_timeout: { retry: 'once', text: 'the application popup did not appear' },
  button_not_found: { retry: 'once', text: 'the send button was not found' },
  button_disabled: { retry: 'once', text: 'the send button stayed disabled' },
  click_failed: { retry: 'once', text: 'the send button could not be clicked' },
  timeout: { retry: 'once', text: 'a timeout on the response form' },
};

/** Fields of an entry, in the order they are written */
const FIELDS = ['reason', 'title', 'url', 'time', 'attempts'];

/**
 * One line, at most the given length
 * @param {string} text
 * @param {number} [max=150]
 * @returns {string}
 */
const oneLine = (text, max = 150) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
};

/**
 * Whether a recorded vacancy is left alone on this run
 * @param {{reason: string, attempts: number}} entry
 * @param {Object} [options]
 * @param {boolean} [options.ignoreQuestionnaires=false] - --ignore-vacancies-with-questionnaire
 * @returns {boolean}
 */
export function isSkippedForGood(entry, { ignoreQuestionnaires = false } = {}) {
  // An unknown reason counts as transient: the safe side is to look at the vacancy once more
  const { retry } = SKIP_REASONS[entry.reason] ?? { retry: 'once' };
  switch (retry) {
  case 'never':
    return true;
  case 'questionnaire':
    return ignoreQuestionnaires;
  case 'deferred':
    return false;
  default:
    return entry.attempts >= 2;
  }
}

/**
 * The fields of an entry from its lines
 * @param {string|string[]} value - What the Links Notation reader returns for an ID
 * @returns {{reason: string, title?: string, url?: string, time?: string, attempts: number}}
 */
export function parseEntry(value) {
  const fields = {};
  for (const line of [value].flat().flatMap((item) => String(item).split('\n'))) {
    const at = line.indexOf(':');
    if (at > 0) {
      fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return { ...fields, reason: fields.reason ?? 'unknown', attempts: Number(fields.attempts) || 1 };
}

/**
 * The lines of an entry
 * @param {Object} entry
 * @returns {string[]}
 */
function formatEntry(entry) {
  return FIELDS.filter((field) => entry[field] !== undefined && entry[field] !== '')
    .map((field) => `${field}: ${entry[field]}`);
}

/**
 * Create the store of skipped vacancies
 * @param {string} filePath - data/skipped-vacancies.lino
 * @param {Object} [options]
 * @param {Function} [options.now] - Current time (for tests)
 * @returns {Object}
 */
export function createSkippedVacancies(filePath, { now = () => new Date() } = {}) {
  const db = createQADatabase(filePath);
  const exclusive = createMutex();

  /** @returns {Promise<Map<string, Object>>} Vacancy ID -> entry */
  async function read() {
    return new Map([...await db.readQADatabase()].map(([id, value]) => [String(id), parseEntry(value)]));
  }

  /**
   * Rewrite the entries
   * @param {Map<string, Object>} entries
   */
  function write(entries) {
    return db.writeQADatabase(new Map([...entries].map(([id, entry]) => [id, formatEntry(entry)])));
  }

  /**
   * Keep a skipped vacancy; a vacancy skipped again counts one more attempt and keeps the
   * title and link known before
   * @param {string|number} vacancyId
   * @param {Object} skip
   * @param {string} skip.reason - One of SKIP_REASONS
   * @param {string} [skip.title] - Title (and employer) from the vacancy card or form
   * @param {string} [skip.url] - Where to apply (the employer's site) or the vacancy page
   * @returns {Promise<Object|null>} The entry, null without a vacancy ID
   */
  function record(vacancyId, { reason, title, url }) {
    if (!/^\d+$/.test(String(vacancyId ?? ''))) {
      return Promise.resolve(null);
    }
    return exclusive(async () => {
      const entries = await read();
      const before = entries.get(String(vacancyId));
      const entry = {
        reason,
        title: oneLine(title) || before?.title,
        url: oneLine(url, 1000) || before?.url,
        time: now().toISOString(),
        attempts: (before?.attempts ?? 0) + 1,
      };
      entries.set(String(vacancyId), entry);
      await write(entries);
      return entry;
    });
  }

  /**
   * Drop vacancies: applied to, or cleared by the user so they are opened again
   * @param {(id: string, entry: Object) => boolean} shouldDrop
   * @returns {Promise<number>} How many were dropped
   */
  function drop(shouldDrop) {
    return exclusive(async () => {
      const entries = await read();
      const kept = new Map([...entries].filter(([id, entry]) => !shouldDrop(id, entry)));
      if (kept.size !== entries.size) {
        await write(kept);
      }
      return entries.size - kept.size;
    });
  }

  return {
    filePath,
    read,
    record,

    /**
     * A vacancy that has been applied to is no longer skipped
     * @param {string|number} vacancyId
     */
    forget: (vacancyId) => drop((id) => id === String(vacancyId)),

    /**
     * Remove the entries of a reason, or one vacancy, so they are opened again
     * @param {string} reasonOrId
     * @returns {Promise<number>}
     */
    clear: (reasonOrId) => drop((id, entry) => id === String(reasonOrId) || entry.reason === reasonOrId),

    /**
     * IDs of the vacancies not to open on this run
     * @param {Object} [options] - See isSkippedForGood
     * @returns {Promise<Set<string>>}
     */
    async skippedVacancyIds(options) {
      return new Set([...await read()].filter(([, entry]) => isSkippedForGood(entry, options)).map(([id]) => id));
    },

    /**
     * Move the IDs of the former data/ignored-vacancy-ids.txt here (reason questionnaire_ignored)
     * and remove that file
     * @param {string} txtPath
     * @returns {Promise<number>} How many IDs were moved
     */
    async importIgnoredVacancyIds(txtPath) {
      let content;
      try {
        content = await fs.readFile(txtPath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') {
          return 0;
        }
        throw error;
      }
      const ids = content.split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line));
      await exclusive(async () => {
        const entries = await read();
        for (const id of ids) {
          if (!entries.has(id)) {
            entries.set(id, { reason: 'questionnaire_ignored', time: now().toISOString(), attempts: 1 });
          }
        }
        await write(entries);
      });
      await fs.unlink(txtPath);
      return ids.length;
    },
  };
}

/**
 * When a recorded vacancy is opened again, for the log
 * @param {{reason: string, attempts: number}} entry
 * @returns {string}
 */
function retryNote(entry) {
  switch (SKIP_REASONS[entry.reason]?.retry) {
  case 'never':
    return 'not opened again until cleared (bun run skipped -- --clear <reason|id>)';
  case 'questionnaire':
    return 'not opened again while --ignore-vacancies-with-questionnaire is on';
  case 'deferred':
    return 'opened again once its questions are answered';
  default:
    return entry.attempts >= 2 ? 'skipped twice, not opened again until cleared' : 'opened once more on the next run';
  }
}

/**
 * Log a skip and keep it in the store: no vacancy is skipped silently
 * @param {Object|null} skippedVacancies - The store; without it the skip is only logged
 * @param {string|number|null} vacancyId
 * @param {{reason: string, title?: string, url?: string}} skip
 * @returns {Promise<void>}
 */
export async function noteSkip(skippedVacancies, vacancyId, skip) {
  const text = SKIP_REASONS[skip.reason]?.text ?? skip.reason;
  try {
    const entry = await skippedVacancies?.record(vacancyId, skip);
    console.log(`⏭️  Vacancy ${vacancyId ?? '(no ID)'} skipped: ${text}` +
      (entry ? `; kept in data/skipped-vacancies.lino, ${retryNote(entry)}` : ''));
  } catch (error) {
    console.error(`Error recording skipped vacancy ${vacancyId} in data/skipped-vacancies.lino: ${error.message}`);
  }
}

/**
 * A readable list of the skipped vacancies, grouped by reason; vacancies applied on the
 * employer's site come with the command that prefills their form
 * @param {Map<string, Object>} entries
 * @param {Object} [options] - See isSkippedForGood
 * @returns {string}
 */
export function formatSkippedVacancies(entries, options) {
  const byReason = new Map();
  for (const [id, entry] of entries) {
    byReason.set(entry.reason, [...byReason.get(entry.reason) ?? [], [id, entry]]);
  }
  const sections = [...byReason].map(([reason, items]) => {
    const lines = items.map(([id, entry]) => {
      const retried = isSkippedForGood(entry, options) ? '' : ' (opened again on the next run)';
      const title = entry.title ? ` ${entry.title}` : '';
      const prefill = reason === 'external_site' && entry.url && !/^https:\/\/hh\.ru\//.test(entry.url)
        ? `\n     bun run prefill-form -- ${entry.url}`
        : '';
      return `   • ${id}${title} — ${entry.time ?? ''}${retried}\n     https://hh.ru/vacancy/${id}${prefill}`;
    });
    return `${reason}: ${SKIP_REASONS[reason]?.text ?? 'unknown reason'} (${items.length})\n${lines.join('\n')}`;
  });
  return sections.join('\n\n');
}
