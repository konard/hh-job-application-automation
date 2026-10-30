/**
 * The cover letter follows the verified application CV language, including dollar pay.
 * Without a verified language, clearly English employer questions choose the English template.
 *
 * @module cover-letter
 */
import { typeLongText } from './helpers/page-helpers.mjs';

/**
 * Whether texts are clearly in English: enough letters, nearly all of them Latin
 * @param {string[]} texts
 * @returns {boolean}
 */
export function isClearlyEnglish(texts) {
  const letters = texts.join(' ').match(/\p{L}/gu) ?? [];
  const latin = letters.filter((letter) => /[a-z]/i.test(letter)).length;
  return letters.length >= 20 && latin / letters.length >= 0.9;
}

/**
 * The cover letter to type
 * @param {string|{ru: string, en?: string}} message - The letter, or the letter with its English version
 * @param {string[]} questions - The vacancy's questions on the page
 * @param {'ru'|'en'|null} language - Verified application CV language, when available
 * @returns {string}
 */
export function coverLetterFor(message, questions = [], language = null) {
  if (typeof message === 'string' || !message) {
    return message ?? '';
  }
  return message.en && (language === 'en' || (language === null && isClearlyEnglish(questions))) ? message.en : message.ru;
}

/** Correct an unchanged language template, preserving custom letters and questionnaire answers. */
export async function fillCoverLetter({ commander, selector, message, questions = [], language = null }) {
  const text = coverLetterFor(message, questions, language);
  if (!text) return { filled: false };
  if (message && typeof message === 'object') {
    const replaced = await commander.evaluate({
      fn: (selector, desired, templates) => {
        const textarea = document.querySelector(selector);
        if (!textarea) return false;
        const normalize = (value) => String(value).replace(/\r\n/g, '\n').trim();
        const current = normalize(textarea.value);
        if (!current || current === normalize(desired) || !templates.some((template) => normalize(template) === current)) return false;
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, '');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      args: [selector, text, Object.values(message).filter((value) => typeof value === 'string')],
    });
    if (replaced) console.log(`✉️  Correcting the unchanged cover-letter template to ${language?.toUpperCase() ?? 'the application language'}`);
  }
  return typeLongText(commander, { selector, text, scrollIntoView: true });
}

/**
 * The English letter next to a letter file: data/cover-letter.txt → data/cover-letter.en.txt
 * @param {string} file
 * @returns {string}
 */
export const englishLetterFile = (file) => (file ? file.replace(/(\.[^./]+)?$/, '.en$1') : '');
