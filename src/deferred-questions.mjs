/**
 * Questions to answer later: a vacancy whose form asks one of them is skipped for now, and
 * its ID is kept under the question in data/deferred-questions.lino, so the vacancy can be
 * applied to once the answer is in qa.lino.
 *
 * - `s` at an open-questions prompt defers the open questions of that form
 * - a form whose open question was deferred before is skipped right away
 * - `--skip-question "<text>"` (repeatable) skips forms that ask a matching question,
 *   answered or not
 * - a question added to the file while its form waits at the open-questions prompt skips that
 *   form too (askUnlessDeferred)
 *
 * File format (Links Notation, like qa.lino):
 *   Какой портфель автоматизаций и AI-продуктов вам удалось реализовать?
 *     137956393
 *     138011234
 *
 * @module deferred-questions
 */

import { createQADatabase, findBestMatch, normalizeQuestion } from './qa-database.mjs';
import { stat } from 'fs/promises';
import { createMutex } from './helpers/mutex.mjs';
import { withdrawPrompt } from './confirmations.mjs';

/** What `s` does at an open-questions prompt */
export const DEFER_CHOICE = 'skip this vacancy until the open question(s) are answered in qa.lino';

/** A deferred question matches another wording of it, not merely a question on the same topic */
const MATCH_THRESHOLD = 0.7;

/**
 * One bullet line per question
 * @param {string[]} questions
 * @returns {string}
 */
export function formatQuestions(questions) {
  return questions.map((question) => `   • ${question}`).join('\n');
}

/**
 * The pattern a question matches: one contained in it ("портфель автоматизаций"), or the
 * same question in other words
 * @param {string} question - Question on the form
 * @param {string[]} patterns - Deferred questions or --skip-question texts
 * @returns {string|null} The matching pattern
 */
export function matchQuestion(question, patterns) {
  const normalized = normalizeQuestion(question);
  const contained = patterns.find((pattern) => {
    const fragment = normalizeQuestion(pattern);
    return fragment && normalized.includes(fragment);
  });
  if (contained) {
    return contained;
  }
  const similar = findBestMatch(question, new Map(patterns.map((pattern) => [pattern, pattern])), {
    threshold: MATCH_THRESHOLD,
  });
  return similar?.question ?? null;
}

/**
 * Create the deferred questions store
 * @param {string} filePath - Path to deferred-questions.lino
 * @param {Object} [options]
 * @param {string[]} [options.skipQuestions=[]] - --skip-question texts
 * @returns {Object}
 */
export function createDeferredQuestions(filePath, { skipQuestions = [] } = {}) {
  const db = createQADatabase(filePath);
  const exclusive = createMutex();

  /**
   * @returns {Promise<Map<string, string[]>>} Question -> IDs of the vacancies that ask it
   */
  async function read() {
    const entries = await db.readQADatabase();
    return new Map([...entries].map(([question, ids]) => [question, [ids].flat().map(String)]));
  }

  /**
   * Keep the vacancy under each question; another wording of a deferred question is kept
   * under the existing one
   * @param {string[]} questions
   * @param {string|null} vacancyId
   */
  function defer(questions, vacancyId) {
    return exclusive(async () => {
      const deferred = await read();
      for (const question of questions) {
        const key = matchQuestion(question, [...deferred.keys()]) ?? question;
        const ids = deferred.get(key) ?? [];
        if (vacancyId && !ids.includes(String(vacancyId))) {
          ids.push(String(vacancyId));
        }
        deferred.set(key, ids);
      }
      await db.writeQADatabase(deferred);
    });
  }

  /**
   * Drop a vacancy that has been applied to; a question with no vacancies left is dropped too
   * @param {string} vacancyId
   */
  function forget(vacancyId) {
    return exclusive(async () => {
      const deferred = await read();
      for (const [question, ids] of deferred) {
        const left = ids.filter((id) => id !== String(vacancyId));
        if (left.length === 0) {
          deferred.delete(question);
        } else {
          deferred.set(question, left);
        }
      }
      await db.writeQADatabase(deferred);
    });
  }

  /**
   * Questions on a form that make the vacancy wait: --skip-question ones whether answered or
   * not, deferred ones while they are open
   * @param {Object} form
   * @param {string[]} form.questions - Every question on the form
   * @param {string[]} form.openQuestions - Questions without an answer
   * @returns {Promise<string[]>}
   */
  async function questionsToSkip({ questions, openQuestions }) {
    const deferred = [...(await read()).keys()];
    return [...new Set([
      ...questions.filter((question) => matchQuestion(question, skipQuestions)),
      ...openQuestions.filter((question) => matchQuestion(question, deferred)),
    ])];
  }

  /**
   * IDs of the deferred vacancies that still wait: their question has no answer in qa.lino,
   * or it is skipped with --skip-question
   * @param {Map<string, string|string[]>} qaMap
   * @returns {Promise<Set<string>>}
   */
  async function pendingVacancyIds(qaMap) {
    const pending = new Set();
    for (const [question, ids] of await read()) {
      if (matchQuestion(question, skipQuestions) || !findBestMatch(question, qaMap)) {
        ids.forEach((id) => pending.add(id));
      }
    }
    return pending;
  }

  /**
   * Watch the file while a form waits for the user: once it changes and one of the form's open
   * questions is deferred in it, onDeferred gets those questions (once)
   * @param {() => Promise<string[]>} openQuestions - The form's questions still open
   * @param {(questions: string[]) => void} onDeferred
   * @param {Object} [options]
   * @param {number} [options.intervalMs=2000] - How often the file's time is checked
   * @returns {() => void} Stops watching
   */
  function watchOpen(openQuestions, onDeferred, { intervalMs = 2000 } = {}) {
    let seen = null;
    let busy = false;
    let stopped = false;
    const modified = async () => (await stat(filePath).catch(() => null))?.mtimeMs ?? 0;
    const check = async () => {
      if (busy || stopped) {
        return;
      }
      busy = true;
      try {
        const time = await modified();
        if (time === seen) {
          return;
        }
        seen = time;
        const deferred = [...(await read()).keys()];
        const matched = (await openQuestions()).filter((question) => matchQuestion(question, deferred));
        if (matched.length > 0 && !stopped) {
          stop();
          onDeferred(matched);
        }
      } catch {
        // The page or the file is busy now: the next check tries again
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(check, intervalMs);
    timer.unref?.();
    const stop = () => {
      stopped = true;
      clearInterval(timer);
    };
    modified().then((time) => { seen ??= time; });
    return stop;
  }

  return { read, defer, forget, questionsToSkip, pendingVacancyIds, watchOpen, skipQuestions, filePath };
}

/**
 * Ask at the open-questions prompt while watching deferred-questions.lino: a question of the
 * form deferred meanwhile withdraws the prompt, so the vacancy is skipped like with `s`, under
 * those questions only
 * @param {Object|null} deferredQuestions - createDeferredQuestions(), or null
 * @param {() => Promise<string[]>} openQuestions - The form's questions still open
 * @param {() => Promise<string>} ask - The prompt (askUser)
 * @returns {Promise<{choice: string, deferred?: string[]}>} choice 'deferred' with the questions
 */
export async function askUnlessDeferred(deferredQuestions, openQuestions, ask) {
  if (!deferredQuestions) {
    return { choice: await ask() };
  }
  let deferred = null;
  const stop = deferredQuestions.watchOpen(openQuestions, (questions) => {
    deferred = questions;
    withdrawPrompt('a question of this form was added to deferred-questions.lino');
  });
  try {
    const choice = await ask();
    return deferred ? { choice: 'deferred', deferred } : { choice };
  } finally {
    stop();
  }
}
