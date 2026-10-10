/**
 * Vacancies filtered out automatically: not a programming job (electrical installation, circuit
 * design), or manual / field work that needs physical presence. The rules are in
 * data/vacancy-filters.lino, each filtered vacancy is kept in data/filtered-vacancies.lino with the
 * rule that matched, its title and the time, and is not opened again.
 *
 * Rules (Links Notation, like qa.lino), a part of the text is enough, case and ё/е do not matter:
 *   vacancy
 *     схемотехник
 *   question
 *     дифавтомат
 *   on-site
 *     выезды на объекты
 *   programming
 *     разработчик
 *   remote
 *     удаленн
 *
 * - vacancy: the vacancy card in the search list (title, company, labels), checked before it is
 *   opened, so a filtered vacancy costs no request; and the vacancy name on its response form
 * - question: a question of the response form (full form or popup)
 * - page: any text of the response form
 * - on-site: physical presence at the employer's site (installation, field trips, warehouse,
 *   production line), looked for in the card, the vacancy description, the questions and the form.
 *   It filters only a vacancy that is clearly not programming: no `programming` and no `remote`
 *   fragment in its card, name or description. So an office or hybrid software job is never
 *   filtered by it, whatever its description says about the office or a warehouse it automates
 * - programming, remote: those guards (they filter nothing themselves)
 *
 * The vacancy description is read only when an on-site rule could apply and the card does not
 * settle it (see needsDescription): one request for the vacancy page, in vacancies.mjs.
 *
 * @module vacancy-filters
 */

import { createQADatabase } from './qa-database.mjs';
import { createMutex } from './helpers/mutex.mjs';
import fs from 'fs/promises';
import path from 'path';

/** Kinds that filter a vacancy on their own, in the order they are checked */
export const FILTER_KINDS = ['vacancy', 'question', 'page'];
/** Every kind of rule in the file */
export const RULE_KINDS = [...FILTER_KINDS, 'on-site', 'programming', 'remote'];

/**
 * Text as rules compare it: lowercase, ё as е, single spaces
 * @param {string} text
 * @returns {string}
 */
export function normalizeFilterText(text) {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * The first pattern found in one of the texts
 * @param {string[]} patterns
 * @param {string[]} texts
 * @returns {{pattern: string, text: string}|null}
 */
function findPattern(patterns = [], texts) {
  for (const pattern of patterns) {
    const fragment = normalizeFilterText(pattern);
    const text = fragment && texts.find((candidate) => normalizeFilterText(candidate).includes(fragment));
    if (text) {
      return { pattern, text };
    }
  }
  return null;
}

/**
 * Whether the vacancy is a programming job, or can be done remotely, by its card, name or
 * description: then on-site rules do not apply
 * @param {Object<string, string[]>} rules
 * @param {string[]} texts
 * @returns {boolean}
 */
const isGuarded = (rules, texts) => Boolean(findPattern(rules.programming, texts) || findPattern(rules.remote, texts));

/**
 * The first rule found in the texts
 * @param {Object<string, string[]>} rules - Patterns by kind
 * @param {Object} texts
 * @param {string} [texts.vacancy] - Vacancy card or name
 * @param {string} [texts.description] - Vacancy description (when it was read)
 * @param {string[]} [texts.questions] - Questions of the form
 * @param {string} [texts.page] - Text of the form
 * @returns {{kind: string, pattern: string, text: string}|null}
 */
export function findFilterMatch(rules, { vacancy = '', description = '', questions = [], page = '' }) {
  const textsByKind = { vacancy: [vacancy], question: questions, page: [page] };
  for (const kind of FILTER_KINDS) {
    const found = findPattern(rules[kind], textsByKind[kind]);
    if (found) {
      return { kind, ...found };
    }
  }
  // The form page is no guard: it holds the user's own resume title ("Go developer")
  if (isGuarded(rules, [vacancy, description])) {
    return null;
  }
  const onSite = findPattern(rules['on-site'], [vacancy, description, ...questions, page]);
  return onSite && { kind: 'on-site', ...onSite };
}

/**
 * Whether the vacancy description is worth reading before the vacancy is opened: an on-site rule
 * could filter it, and its card is neither filtered already nor a programming or remote job
 * @param {Object<string, string[]>} rules
 * @param {string} card - Vacancy card text
 * @returns {boolean}
 */
export function needsDescription(rules, card) {
  return (rules['on-site'] ?? []).length > 0 && !isGuarded(rules, [card]) && !findFilterMatch(rules, { vacancy: card });
}

/**
 * One line for the log: the matched text around the pattern
 * @param {{kind: string, pattern: string, text: string}} match
 * @returns {string}
 */
export function describeFilterMatch({ kind, pattern, text }) {
  if (kind === 'page') {
    return `${kind} "${pattern}"`;
  }
  const shown = text.replace(/\s+/g, ' ').trim();
  if (shown.length <= 120) {
    return `${kind} "${pattern}": ${shown}`;
  }
  const at = Math.max(0, normalizeFilterText(shown).indexOf(normalizeFilterText(pattern)) - 50);
  return `${kind} "${pattern}": ${at > 0 ? '...' : ''}${shown.slice(at, at + 117)}...`;
}

/**
 * Create the filters
 * @param {Object} options
 * @param {string} options.rulesPath - data/vacancy-filters.lino
 * @param {string} options.filteredPath - data/filtered-vacancies.lino
 * @param {Function} [options.now] - Current time (for tests)
 * @returns {Object}
 */
export function createVacancyFilters({ rulesPath, filteredPath, now = () => new Date() }) {
  const rulesDb = createQADatabase(rulesPath);
  const filteredDb = createQADatabase(filteredPath);
  const exclusive = createMutex();
  // Descriptions read in this run, so the response form of the vacancy uses them too
  const descriptions = new Map();

  /** @returns {Promise<Object<string, string[]>>} Patterns by kind */
  async function rules() {
    const entries = await rulesDb.readQADatabase();
    // One pattern comes as a string, several as a list, or joined by newlines when one is long
    return Object.fromEntries(RULE_KINDS.map((kind) => [kind, [entries.get(kind) ?? []].flat()
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
     * @param {string} card - Vacancy card text
     * @returns {Promise<boolean>} See needsDescription
     */
    async needsDescription(card) {
      return needsDescription(await rules(), card);
    },

    /**
     * Keep a description read in this run
     * @param {string} vacancyId
     * @param {string} description
     */
    keepDescription(vacancyId, description) {
      if (vacancyId && description) {
        descriptions.set(String(vacancyId), description);
      }
    },

    /**
     * @param {string} vacancyId
     * @returns {string} The description read in this run, or ''
     */
    description: (vacancyId) => descriptions.get(String(vacancyId)) ?? '',

    /**
     * Keep the vacancy with the rule that filtered it out, its title and the time
     * @param {string} vacancyId
     * @param {{kind: string, pattern: string, text: string}} match
     * @param {Object} [vacancy]
     * @param {string} [vacancy.title] - Title (and employer) from the card or form
     */
    async remember(vacancyId, match, { title } = {}) {
      if (!vacancyId) {
        return;
      }
      const shownTitle = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
      await exclusive(async () => {
        await fs.mkdir(path.dirname(filteredPath), { recursive: true });
        await filteredDb.addOrUpdateQA(String(vacancyId), [
          `${match.kind}: ${match.pattern}`,
          ...(shownTitle ? [`title: ${shownTitle}`] : []),
          `time: ${now().toISOString()}`,
        ]);
      });
    },

    /** @returns {Promise<Set<string>>} IDs of the vacancies filtered out before */
    async filteredVacancyIds() {
      return new Set([...(await filteredDb.readQADatabase()).keys()].map(String));
    },
  };
}
