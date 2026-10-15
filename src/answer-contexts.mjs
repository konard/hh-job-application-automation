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
 * one the vacancy shows: its texts are looked at in order (the card with its pay first, then the
 * description, the form's other questions, the employer's messages), and in a text the first
 * context in the file's order counts; else the default. A word made of letters is found at the start of a word, and as a
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
 * @param {string|string[]} [known] - The vacancy, the texts that tell most first: its card,
 *   description, the form's other questions
 * @returns {Array} One context per group that has one
 */
export function chooseContexts(contexts, question, known = '') {
  const shows = (context, text) => context.words.some((word) => hasWord(word, text));
  const texts = [known].flat().filter(Boolean);
  return [...new Set(contexts.map(({ group }) => group))].flatMap((group) => {
    const candidates = contexts.filter((context) => context.group === group);
    const own = candidates.filter((context) => shows(context, question));
    const chosen = (own.length === 1 ? own[0] : null) ??
      texts.map((text) => candidates.find((context) => shows(context, text))).find(Boolean) ??
      candidates.find((context) => context.isDefault);
    return chosen ? [chosen] : [];
  });
}

/**
 * Whether the texts show a context of any group: when none does, the vacancy itself may tell
 * @param {Array} contexts - parseAnswerContexts
 * @param {string|string[]} texts
 * @returns {boolean}
 */
export function showsContext(contexts, texts) {
  return [texts].flat().some((text) => contexts.some(({ words }) => words.some((word) => hasWord(word, text))));
}

/**
 * The saved answers in the contexts of a question, read once for each set of contexts
 * @param {Function} readQADatabase - withContacts' (contacts.mjs): takes {contexts}
 * @param {Array} contexts - parseAnswerContexts
 * @returns {(question: string, known?: string|string[]) => Promise<Map>}
 */
export function answersInContexts(readQADatabase, contexts) {
  const maps = new Map();
  return (question, known) => {
    const chosen = chooseContexts(contexts, question, known);
    const key = chosen.map(({ group, name }) => `${group}: ${name}`).join('\n');
    if (!maps.has(key)) {
      maps.set(key, readQADatabase({ contexts: chosen }));
    }
    return maps.get(key);
  };
}

/** A sum of money as people write it: «$6 000», «6000 USDT», «450 000 ₽», «350 тыс. рублей», «210к» */
const SUM = /[$€₽]\s?\d[\d\s\u00a0.,]*\d|\d(?:[\d\s\u00a0.,]*\d)?\s?(?:[$€₽]|(?:тыс\.?\s?)?(?:usdt?|usd|eur|rub|руб\p{L}*\.?|р\.|долл\p{L}*|евро)|тыс\.?|[kк])(?!\p{L})/giu;

/**
 * Whether two answers are the same but for their sums: an answer typed before in another context
 * («От 6000 USDT на руки или эквивалент.» for «От 450 000 ₽ на руки или эквивалент.»)
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameButSums(a, b) {
  const bare = (text) => String(text ?? '').replace(SUM, '{{sum}}').replace(/\s+/g, ' ').trim().toLowerCase();
  return new RegExp(SUM.source, 'iu').test(String(a)) && bare(a) === bare(b);
}

/**
 * @param {string} [filePath]
 * @returns {Promise<Array>} parseAnswerContexts; none without the file
 */
export async function loadAnswerContexts(filePath = ANSWER_CONTEXTS_FILE) {
  return parseAnswerContexts(await createQADatabase(filePath).readQADatabase().catch(() => new Map()));
}
