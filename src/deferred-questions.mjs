/**
 * Questions to answer later: a vacancy whose form asks one of them is skipped for now, and
 * its ID is kept under the question in data/deferred-questions.lino, so the vacancy can be
 * applied to once the answer is in qa.lino.
 *
 * - `s` at an open-questions prompt defers the open questions of that form
 * - a form whose open question was deferred before is skipped right away
 * - `--skip-question "<text>"` (repeatable) skips forms that ask a matching question,
 *   answered or not
 *
 * File format (Links Notation, like qa.lino):
 *   Какой портфель автоматизаций и AI-продуктов вам удалось реализовать?
 *     137956393
 *     138011234
 *
 * @module deferred-questions
 */

import { createQADatabase, findBestMatch, normalizeQuestion } from './qa-database.mjs';
import { createMutex } from './helpers/mutex.mjs';

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

  return { read, defer, forget, questionsToSkip, pendingVacancyIds, skipQuestions, filePath };
}
