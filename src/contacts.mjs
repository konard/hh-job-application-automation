/**
 * Contacts kept in one place (data/contacts.lino) and inserted into answers and the cover letter
 * by placeholders, so a changed contact is changed once:
 *   "Для оперативной связи предлагаю использовать мой Telegram: {{telegram}} ({{phone}})."
 *
 * Answers the user saves are stored with placeholders again: an answer that reads the same as its
 * saved template is not rewritten, and contact values in a new answer become placeholders.
 *
 * @module contacts
 */

import { createQADatabase } from './qa-database.mjs';
import { COMPANY_TAXES_FILE, exchangeRates, parseCompanyTaxes, salaryValues } from './salary.mjs';
import { inferSalaryAnswer, learnSalaryPatterns } from './salary-questions.mjs';

/** Contacts written back as placeholders when they appear in a saved answer */
const CONTRACTED = ['linkedin', 'telegram', 'phone', 'email', 'salary_gross', 'salary_net', 'salary_gross_usd', 'salary_net_usd', 'salary_gross_usdt', 'salary_net_usdt', 'salary_gross_eur', 'salary_net_eur'];

/** A link cut at its colon by the .lino reader: only its scheme is left */
export const cutLink = (value) => typeof value === 'string' && /^(?:https?|ftp|mailto|tg)$/i.test(value.trim());

/**
 * @param {string} filePath - data/contacts.lino
 * @returns {Promise<Object<string, string|string[]>>}
 */
export async function loadContacts(filePath, { rates = exchangeRates, companyTaxesFile = COMPANY_TAXES_FILE } = {}) {
  const entries = await createQADatabase(filePath).readQADatabase();
  const contacts = Object.fromEntries([...entries].map(([key, value]) => [key, Array.isArray(value) ? value : String(value)]));
  // A link not in quotes is cut at its colon («https»): left out, or every «https» in an answer
  // would become its placeholder
  for (const [key, value] of Object.entries(contacts)) {
    if (cutLink(value)) {
      console.log(`⚠️  The ${key} of ${filePath} is cut at its colon: put the link in quotes ("https://…")`);
      delete contacts[key];
    }
  }
  // Salary answers ({{salary_gross}}, …) from the net baselines in rubles, dollars and euros (salary.mjs)
  const amount = (key) => Number(String(contacts[key] ?? '').replace(/\D/g, ''));
  const [netRub, netUsd, netEur] = [amount('salary_net_rub'), amount('salary_net_usd'), amount('salary_net_eur')];
  if (netRub > 0 || netUsd > 0 || netEur > 0) {
    const { usd, eur, rubPer } = netUsd > 0 || netEur > 0 ? await rates() : {};
    // A contract in dollars or euros pays the user's company: its taxes are in the gross
    const company = parseCompanyTaxes(await createQADatabase(companyTaxesFile).readQADatabase().catch(() => new Map()));
    if ((netUsd > 0 && !usd) || (netEur > 0 && !eur)) {
      console.log('⚠️  No dollar or euro rate (Central Bank unreachable, none cached): gross in that currency is left as an open question');
    }
    Object.assign(contacts, salaryValues({ netRub, netUsd, netEur, usdRate: usd, eurRate: eur, company, rubPer }));
  }
  return contacts;
}

/**
 * Replace {{key}} with the contact (a list on separate lines); unknown placeholders stay
 * @param {string} text
 * @param {Object} contacts
 * @returns {string}
 */
export function expandContacts(text, contacts) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (placeholder, key) => {
    const value = contacts[key];
    return value === undefined ? placeholder : [value].flat().join('\n');
  });
}

/**
 * How a contact is found in an answer: as written, and the phone also as people write it
 * («+7 958 200-05-67», the way prefilled forms type it)
 * @param {string} key
 * @param {string} value
 * @returns {RegExp}
 */
function contactPattern(key, value) {
  const digits = value.replace(/\D/g, '');
  if (key === 'phone' && digits.length >= 10) {
    return new RegExp(`(?<!\\d)\\+?${digits.split('').join('[\\s()-]*')}(?!\\d)`, 'g');
  }
  // A salary as people write it: «$6000», «6 000 $», «6000 долларов», «450000 рублей», «450 000 ₽»
  if (key.startsWith('salary_') && digits) {
    const amount = digits.replace(/\B(?=(\d{3})+$)/g, '[\\s\\u00a0]?');
    if (key.endsWith('_usdt')) {
      return new RegExp(`(?<!\\d)${amount}\\s?USDT(?!\\p{L})`, 'gu');
    }
    if (key.endsWith('_eur')) {
      return new RegExp(`€\\s?${amount}(?!\\d)|(?<!\\d)${amount}\\s?(?:€|EUR(?!\\p{L})|евро)`, 'gu');
    }
    return key.endsWith('_usd')
      ? new RegExp(`\\$\\s?${amount}(?!\\d)|(?<!\\d)${amount}\\s?(?:\\$|USDT?(?!\\p{L})|долл\\p{L}*)`, 'gu')
      : new RegExp(`(?<!\\d)${amount}\\s?(?:₽|руб\\p{L}*\\.?|р\\.)`, 'gu');
  }
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
}

const GROSS_TAX = /(до вычета )(?:НДФЛ|налогов)/g;

/**
 * Write contact values in an answer as placeholders
 * @param {string} text
 * @param {Object} contacts
 * @returns {string}
 */
export function contractContacts(text, contacts) {
  const contracted = CONTRACTED.filter((key) => typeof contacts[key] === 'string' && contacts[key])
    .sort((a, b) => contacts[b].length - contacts[a].length)
    .reduce((result, key) => result.replace(contactPattern(key, contacts[key]), `{{${key}}}`), String(text));
  // The tax a gross is before follows the currency: «НДФЛ» in rubles, «налогов» in another
  return /\{\{salary_gross/.test(contracted) ? contracted.replace(GROSS_TAX, '$1{{salary_tax}}') : contracted;
}

/**
 * The contacts with the placeholders of the chosen contexts; a value whose own placeholders have
 * no value (no dollar sum) keeps the contact as it was
 * @param {Object} contacts
 * @param {Array} chosen - chooseContexts (answer-contexts.mjs)
 * @returns {Object}
 */
export function contactsInContexts(contacts, chosen) {
  const result = { ...contacts };
  for (const { values } of chosen) {
    for (const [key, template] of Object.entries(values)) {
      const value = expandContacts(template, contacts);
      if (!/\{\{\w+\}\}/.test(value)) {
        result[key] = value;
      }
    }
  }
  return result;
}

const expandAnswer = (answer, contacts) => (Array.isArray(answer)
  ? answer.map((item) => expandContacts(item, contacts))
  : expandContacts(answer, contacts));

/**
 * The Q&A database with contacts filled in on reading and placeholders kept on writing
 * @param {{readQADatabase: Function, addOrUpdateQA: Function}} db
 * @param {Object} contacts
 * @returns {{readQADatabase: Function, addOrUpdateQA: Function}}
 */
export function withContacts(db, contacts) {
  return {
    ...db,
    /**
     * @param {{contexts?: Array, questions?: string[]}} [options] - contexts: the answers in these
     *   contexts (answer-contexts.mjs), e.g. salaries in dollars, whichever currency the answer was
     *   saved in; questions: also these questions' answers by pattern when they are not saved word
     *   for word (salary-questions.mjs)
     */
    async readQADatabase({ contexts, questions = [] } = {}) {
      const raw = await db.readQADatabase();
      const patterns = questions.some((question) => !raw.has(question)) ? learnSalaryPatterns(raw) : null;
      for (const question of questions.filter((item) => !raw.has(item))) {
        const answer = inferSalaryAnswer(question, patterns);
        if (answer) {
          raw.set(question, answer);
        }
      }
      const values = contexts ? contactsInContexts(contacts, contexts) : contacts;
      // An answer with a placeholder that has no value (e.g. no dollar rate) is not typed as is
      return new Map([...raw].map(([question, answer]) => [question, expandAnswer(answer, values)])
        .filter(([, answer]) => ![answer].flat().some((item) => /\{\{\w+\}\}/.test(item))));
    },
    async addOrUpdateQA(question, answer) {
      const saved = (await db.readQADatabase()).get(question);
      if (saved !== undefined && JSON.stringify(expandAnswer(saved, contacts)) === JSON.stringify(answer)) {
        return;
      }
      const templated = Array.isArray(answer)
        ? answer.map((item) => contractContacts(item, contacts))
        : contractContacts(answer, contacts);
      await db.addOrUpdateQA(question, templated);
    },
  };
}
