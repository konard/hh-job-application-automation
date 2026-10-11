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
import { salaryValues, usdRate } from './salary.mjs';

/** Contacts written back as placeholders when they appear in a saved answer */
const CONTRACTED = ['linkedin', 'telegram', 'phone', 'email', 'salary_gross', 'salary_net', 'salary_gross_usd', 'salary_net_usd'];

/**
 * @param {string} filePath - data/contacts.lino
 * @returns {Promise<Object<string, string|string[]>>}
 */
export async function loadContacts(filePath, { rate = usdRate } = {}) {
  const entries = await createQADatabase(filePath).readQADatabase();
  const contacts = Object.fromEntries([...entries].map(([key, value]) => [key, Array.isArray(value) ? value : String(value)]));
  // Salary answers ({{salary_gross}}, …) from the net baselines in rubles and dollars (salary.mjs)
  const amount = (key) => Number(String(contacts[key] ?? '').replace(/\D/g, ''));
  const [netRub, netUsd] = [amount('salary_net_rub'), amount('salary_net_usd')];
  if (netRub > 0 || netUsd > 0) {
    const usdRub = netUsd > 0 ? await rate() : null;
    if (netUsd > 0 && !usdRub) {
      console.log('⚠️  No dollar rate (Central Bank unreachable, none cached): gross in dollars is left as an open question');
    }
    Object.assign(contacts, salaryValues({ netRub, netUsd, usdRate: usdRub }));
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
    return key.endsWith('_usd')
      ? new RegExp(`\\$\\s?${amount}(?!\\d)|(?<!\\d)${amount}\\s?(?:\\$|USD(?!\\p{L})|долл\\p{L}*)`, 'gu')
      : new RegExp(`(?<!\\d)${amount}\\s?(?:₽|руб\\p{L}*\\.?|р\\.)`, 'gu');
  }
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
}

/**
 * Write contact values in an answer as placeholders
 * @param {string} text
 * @param {Object} contacts
 * @returns {string}
 */
export function contractContacts(text, contacts) {
  return CONTRACTED.filter((key) => typeof contacts[key] === 'string' && contacts[key])
    .sort((a, b) => contacts[b].length - contacts[a].length)
    .reduce((result, key) => result.replace(contactPattern(key, contacts[key]), `{{${key}}}`), String(text));
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
    async readQADatabase() {
      const raw = await db.readQADatabase();
      // An answer with a placeholder that has no value (e.g. no dollar rate) is not typed as is
      return new Map([...raw].map(([question, answer]) => [question, expandAnswer(answer, contacts)])
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
