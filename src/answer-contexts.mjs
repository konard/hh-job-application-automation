/**
 * Answers that depend on the vacancy: data/answer-contexts.lino names contexts in groups, the
 * words that show each one, and the placeholders it gives other values. One saved answer then fits
 * every vacancy: «От {{salary_net}} в месяц на руки.» is in dollars for a vacancy paid in dollars.
 *
 *   "currency: usd"                            group «currency», context «usd»
 *     $                                        words that show it (several lines)
 *     в валюте
 *     "{{salary_net}}: {{salary_net_usd}}"     in this context {{salary_net}} is the dollar sum
 *   "currency: rub (default)"                  the group's context when nothing shows another
 *     ₽
 *     "{{salary_net_usd}}: {{salary_net}}"
 *
 * In each group the context is the one the question itself shows (only one of them), else the
 * first, in the file's order, that the vacancy shows (its card, description, the form's other
 * questions), else the default. A word made of letters is found at the start of a word, and as a
 * whole word when it is up to 3 letters («usd» is not «usdt», «руб.» is not «рубрика»). The
 * contacts take the chosen contexts' values in contacts.mjs (contactsInContexts).
 *
 * @module answer-contexts
 */

import path from 'node:path';
import { createQADatabase } from './qa-database.mjs';

export const ANSWER_CONTEXTS_FILE = path.join(process.cwd(), 'data', 'answer-contexts.lino');

const OVERRIDE = /^\{\{(\w+)\}\}:\s*(.*)$/s;
const KEY = /^\s*([^:]+?)\s*:\s*(.+?)\s*(\(default\))?\s*$/i;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a word of a context is in a text
 * @param {string} word
 * @param {string} text
 * @returns {boolean}
 */
export function hasWord(word, text) {
  const start = /^\p{L}/u.test(word) ? '(?<!\\p{L})' : '';
  const end = /^\p{L}{1,3}$/u.test(word) ? '(?!\\p{L})' : '';
  return new RegExp(`${start}${escape(word)}${end}`, 'iu').test(String(text ?? ''));
}

/**
 * @param {Map<string, string|string[]>} entries - data/answer-contexts.lino as read
 * @returns {Array<{group: string, name: string, isDefault: boolean, words: string[], values: Object<string, string>}>}
 *   In the file's order
 */
export function parseAnswerContexts(entries) {
  return [...entries].flatMap(([key, lines]) => {
    const [, group, name, isDefault] = String(key).match(KEY) ?? [];
    if (!group) {
      return [];
    }
    const words = [];
    const values = {};
    for (const line of [lines].flat().map(String)) {
      const override = line.match(OVERRIDE);
      if (override) {
        values[override[1]] = override[2].trim();
      } else if (line.trim()) {
        words.push(line.trim());
      }
    }
    return [{ group: group.trim(), name: name.trim(), isDefault: Boolean(isDefault), words, values }];
  });
}

/**
 * The context of each group for a question
 * @param {Array} contexts - parseAnswerContexts
 * @param {string} question
 * @param {string} [known] - The vacancy: its card, description, the form's other questions
 * @returns {Array} One context per group that has one
 */
export function chooseContexts(contexts, question, known = '') {
  const shows = (context, text) => context.words.some((word) => hasWord(word, text));
  return [...new Set(contexts.map(({ group }) => group))].flatMap((group) => {
    const candidates = contexts.filter((context) => context.group === group);
    const own = candidates.filter((context) => shows(context, question));
    const chosen = (own.length === 1 ? own[0] : null) ??
      candidates.find((context) => shows(context, known)) ??
      candidates.find((context) => context.isDefault);
    return chosen ? [chosen] : [];
  });
}

/**
 * @param {string} [filePath]
 * @returns {Promise<Array>} parseAnswerContexts; none without the file
 */
export async function loadAnswerContexts(filePath = ANSWER_CONTEXTS_FILE) {
  return parseAnswerContexts(await createQADatabase(filePath).readQADatabase().catch(() => new Map()));
}
