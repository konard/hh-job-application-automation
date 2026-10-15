/**
 * What Formal AI (github.com/link-assistant/formal-ai) gets wrong when it formalizes a question or
 * an answer of data/qa.lino. Its formalizeText gives sentences of statements:
 *   [{text, polarity: 'asserted'|'denied', subject: {kind, surface}, terms: [{kind, surface}], unknown: [surface]}]
 * Each check below names one way the result does not say what the text says. src/formalize-qa.mjs
 * runs them over the whole database.
 *
 * @module formal-check
 */

const YES = /^(да|yes|конечно|есть|готов[а]?)[.!]?$/i;
const NO = /^(нет|no|не готов[а]?)[.!]?$/i;
const SPACED_NUMBER = /\d{1,3}(?:[  ]\d{3})+/;
const CURRENCY = /\d\s*[₽$€]|[₽$€]\s*\d{2}|\$\/|(?<!\p{L})(?:usd|rub|eur|руб|доллар|евро)/iu;
const WORD = /[\p{L}\p{N}]+/gu;

/** @returns {Array<{kind: string, surface: string}>} The words of the statements, subjects first */
export function formalWords(statements) {
  return statements.flatMap((statement) => [statement.subject, ...(statement.terms ?? [])].filter(Boolean));
}

/**
 * @param {string} text - A question or an answer
 * @param {Array} statements - formalizeText(text)
 * @param {'question'|'answer'} role
 * @returns {Array<{check: string, detail: string}>} What the formalization misses; none when it says it all
 */
export function formalProblems(text, statements, role) {
  const problems = [];
  const words = formalWords(statements);
  const unknown = words.filter((word) => word.kind === 'unknown');
  const total = (String(text).match(WORD) ?? []).length;
  if (words.length > 0 && unknown.length === words.length) {
    problems.push({ check: 'all-words-unknown', detail: `${unknown.length} of ${total} words unknown` });
  } else if (unknown.length > 0) {
    problems.push({ check: 'unknown-words', detail: unknown.map((word) => word.surface).join(', ') });
  }
  if (role === 'question' && /\?\s*$/.test(text)) {
    // No statement says it is asked: a question reads as a claim
    problems.push({ check: 'question-as-claim', detail: statements.map((s) => s.polarity).join(', ') });
  }
  const bare = String(text).trim();
  if (YES.test(bare) && (statements.length === 0 || unknown.length === words.length)) {
    problems.push({ check: 'yes-not-recognized', detail: bare });
  }
  if (NO.test(bare) && !statements.some((statement) => statement.polarity === 'denied')) {
    problems.push({ check: 'no-not-denied', detail: bare });
  }
  const spaced = String(text).match(SPACED_NUMBER);
  if (spaced && words.filter((word) => word.kind === 'number').length > spaced[0].split(/[  ]/).length - 1) {
    problems.push({ check: 'number-split', detail: spaced[0] });
  }
  const currency = String(text).match(CURRENCY);
  if (currency && !words.some((word) => /currency|unit|money/i.test(word.kind) || CURRENCY.test(word.surface))) {
    problems.push({ check: 'currency-dropped', detail: currency[0] });
  }
  // A sentence cut inside a word: «Node.js» read as «Node.» and «js»
  const split = statements.find((statement, index) => index > 0 && /^\p{Ll}/u.test(statement.text ?? '') &&
    /\p{L}\.$/u.test(statements[index - 1].text ?? '') && String(text).includes(`${statements[index - 1].text}${statement.text}`.slice(-40)));
  if (split) {
    problems.push({ check: 'sentence-cut-in-word', detail: split.text });
  }
  return problems;
}
