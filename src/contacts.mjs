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

/** Contacts written back as placeholders when they appear in a saved answer */
const CONTRACTED = ['linkedin', 'telegram', 'phone', 'email'];

/**
 * @param {string} filePath - data/contacts.lino
 * @returns {Promise<Object<string, string|string[]>>}
 */
export async function loadContacts(filePath) {
  const entries = await createQADatabase(filePath).readQADatabase();
  return Object.fromEntries([...entries].map(([key, value]) => [key, Array.isArray(value) ? value : String(value)]));
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
      return new Map([...raw].map(([question, answer]) => [question, expandAnswer(answer, contacts)]));
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
