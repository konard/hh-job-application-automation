/**
 * Vacancies filtered out automatically: not a programming job (electrical installation, circuit
 * design). The rules are in data/vacancy-filters.lino,
 * each filtered vacancy is kept in data/filtered-vacancies.lino with the rule that matched, and
 * is not opened again.
 *
 * Rules (Links Notation, like qa.lino), a part of the text is enough, case and ё/е do not matter:
 *   vacancy
 *     схемотехник
 *   question
 *     дифавтомат
 *
 * - vacancy: the vacancy card in the search list (title, company, labels), checked before it is
 *   opened, so a filtered vacancy costs no request; and the vacancy name on its response form
 * - question: a question of the response form (full form or popup)
 * - page: any text of the response form
 *
 * @module vacancy-filters
 */

import { createQADatabase } from './qa-database.mjs';
import { createMutex } from './helpers/mutex.mjs';
import fs from 'fs/promises';
import path from 'path';

export const FILTER_KINDS = ['vacancy', 'question', 'page'];

/**
 * Text as rules compare it: lowercase, ё as е, single spaces
 * @param {string} text
 * @returns {string}
 */
export function normalizeFilterText(text) {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * The first rule found in the texts
 * @param {Object<string, string[]>} rules - Patterns by kind
 * @param {Object} texts
 * @param {string} [texts.vacancy] - Vacancy card or name
 * @param {string[]} [texts.questions] - Questions of the form
 * @param {string} [texts.page] - Text of the form
 * @returns {{kind: string, pattern: string, text: string}|null}
 */
export function findFilterMatch(rules, { vacancy = '', questions = [], page = '' }) {
  const textsByKind = { vacancy: [vacancy], question: questions, page: [page] };
  for (const kind of FILTER_KINDS) {
    for (const pattern of rules[kind] ?? []) {
      const fragment = normalizeFilterText(pattern);
      const text = fragment && textsByKind[kind].find((candidate) => normalizeFilterText(candidate).includes(fragment));
      if (text) {
        return { kind, pattern, text };
      }
    }
  }
  return null;
}

/**
 * One line for the log
 * @param {{kind: string, pattern: string, text: string}} match
 * @returns {string}
 */
export function describeFilterMatch({ kind, pattern, text }) {
  const shown = text.replace(/\s+/g, ' ').trim();
  return `${kind} "${pattern}"${kind === 'page' ? '' : `: ${shown.length > 120 ? `${shown.slice(0, 117)}...` : shown}`}`;
}

/**
 * Create the filters
 * @param {Object} options
 * @param {string} options.rulesPath - data/vacancy-filters.lino
 * @param {string} options.filteredPath - data/filtered-vacancies.lino
 * @returns {Object}
 */
export function createVacancyFilters({ rulesPath, filteredPath }) {
  const rulesDb = createQADatabase(rulesPath);
  const filteredDb = createQADatabase(filteredPath);
  const exclusive = createMutex();

  /** @returns {Promise<Object<string, string[]>>} Patterns by kind */
  async function rules() {
    const entries = await rulesDb.readQADatabase();
    // One pattern comes as a string, several as a list, or joined by newlines when one is long
    return Object.fromEntries(FILTER_KINDS.map((kind) => [kind, [entries.get(kind) ?? []].flat()
      .flatMap((value) => String(value).split('\n')).map((value) => value.trim()).filter(Boolean)]));
  }

  return {
    rulesPath,
    filteredPath,
    rules,

    /**
     * @param {Object} texts - See findFilterMatch
     * @returns {Promise<{kind: string, pattern: string, text: string}|null>}
     */
    async match(texts) {
      return findFilterMatch(await rules(), texts);
    },

    /**
     * Keep the vacancy with the rule that filtered it out
     * @param {string} vacancyId
     * @param {{kind: string, pattern: string, text: string}} match
     */
    async remember(vacancyId, match) {
      if (!vacancyId) {
        return;
      }
      await exclusive(async () => {
        await fs.mkdir(path.dirname(filteredPath), { recursive: true });
        await filteredDb.addOrUpdateQA(String(vacancyId), `${match.kind}: ${match.pattern}`);
      });
    },

    /** @returns {Promise<Set<string>>} IDs of the vacancies filtered out before */
    async filteredVacancyIds() {
      return new Set([...(await filteredDb.readQADatabase()).keys()].map(String));
    },
  };
}
