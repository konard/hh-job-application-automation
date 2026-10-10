/**
 * The cover letter in the language of the vacancy: the English one (data/cover-letter.en.txt,
 * next to the chosen letter) when the vacancy's questions are clearly in English
 *
 * @module cover-letter
 */

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
 * @returns {string}
 */
export function coverLetterFor(message, questions = []) {
  if (typeof message === 'string' || !message) {
    return message ?? '';
  }
  return message.en && isClearlyEnglish(questions) ? message.en : message.ru;
}

/**
 * The English letter next to a letter file: data/cover-letter.txt → data/cover-letter.en.txt
 * @param {string} file
 * @returns {string}
 */
export const englishLetterFile = (file) => (file ? file.replace(/(\.[^./]+)?$/, '.en$1') : '');
