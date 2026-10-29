/**
 * Salary questions answered by pattern: pattern in, pattern out, both learned from data/qa.lino.
 * The saved questions and answers stay as they are; a question saved word for word keeps its own
 * answer. For any other question about the expected pay:
 *   - pattern in: it is a salary question when it has a salary word (built in, or learned: a word
 *     found in saved salary questions and hardly anywhere else), and it asks for the gross when it
 *     has a gross word (built in, or learned from the questions answered with a gross sum)
 *   - pattern out: the answer is one of the user's own saved answers of that shape (net; gross with
 *     net), those that say nothing else and the most (the sum, the month, net or gross), picked by
 *     the question so it stays the same for it; its sums are placeholders, so it is typed in the
 *     currency of the vacancy (answer-contexts.lino)
 * Hourly expectations use calculated hourly placeholders, never a learned monthly wording.
 * Questions about past pay, accepting a given range, or annual pay stay with saved answers.
 *
 * @module salary-questions
 */

import { isPattern } from './qa-database.mjs';
import { splitQuestions } from './multi-question.mjs';

/** Built-in words that make a question a salary question */
const SALARY = /зарплат|заработн|з\s?\/\s?пл?(?!\p{L})|в\s+каком\s+диапазоне|(?<!\p{L})зп(?!\p{L})|оклад|вознагражден|(?:финансов|денежн)\p{L}*\s+(?:ожидани|пожелани|услови)|ожидани\p{L}*\s+по\s+(?:доход|оплат|вознагражд)|(?:уровень|уровня|уровне)\s+дохода|желаем\p{L}*\s+доход|(?:от|на)\s+как\p{L}*\s+сумм|вилк|компенсац|(?:ожидаем|желаем|комфортн)\p{L}*\s+(?:уров\p{L}*\s+)?(?:доход|оплат)|(?:уров|размер)\p{L}*\s+(?:ожидаемого\s+|желаемо\p{L}*\s+)?(?:доход|оплат)|доход\p{L}*\s+для\s+себя|salary|compensation|pay expectation|rate expectation/iu;
/** Built-in words of a gross sum */
const GROSS = /gross|гросс|брутто|до\s+(?:вычета|уплаты|налог|ндфл)|before\s+tax/iu;
const NET = /\bnet\b|нетто|на\s+руки|после\s+(?:вычета|уплаты)|after\s+tax/iu;
const PRIMARY_NET = /\bnet\s+(?:monthly\s+)?(?:salary|pay|income|compensation)\b/iu;
export const ambiguousSalaryTax = (question) => NET.test(question) && GROSS.test(question);
/**
 * Not the expected pay: a past or current job, a given sum or range to agree to, a sum in a year,
 * the pay as a word of something else (a bank card, a 1C module, the way it is paid)
 */
const NOT_EXPECTATION = /(?:прошл|предыдущ|текущ|последн)\p{L}*\s+(?:мест|работ|должност|зарплат|заработн|доход|оклад|з\s?\/\s?п|зп|компенсац|уров)(?!\p{L}*\s+ожидан)|сейчас\s+получа|получали|устраива|подходит|подойд|соглас(?:ны|на|ен|итесь|ились)|готов\p{L}*\s+ли|рассматрива\p{L}*\s+ли|входит\p{L}*\s+ли|входит\p{L}*\s+в\s+ваш|вписыва|в\s+рамках|через\s+год|зарплатн\p{L}*\s+карт|подсистем|выплат\p{L}*\s+(?:зарплат|заработн)|вариант\p{L}*\s+оформлени/iu;
const ANNUAL = /в\s+год|годов\p{L}*\s+(?:доход|оклад|компенсац|зарплат)|за\s+год|annual|per\s+year/iu;
const HOURLY = /в\s+час|почасов|часов\p{L}*\s+ставк|за\s+час|hourly|per\s+hour|an?\s+hour|(?:руб\.?|₽|rub|usd[tc]?|eur|[$€])\s*\/\s*(?:час|ч|hours?|hrs?|h)(?!\p{L})/iu;
const OTHER_PERIOD = new RegExp(`${ANNUAL.source}|${HOURLY.source}`, 'iu');
const HOURLY_RATE = /ставк|стоимост|оплат|rate|pay|salary|compensation/iu;
const PAST_HOURLY = /(?:прошл|предыдущ|текущ|последн)\p{L}*\s+(?:(?:почасов|часов)\p{L}*\s+)?ставк|(?:previous|current|last)\s+(?:hourly\s+)?(?:rate|pay|salary)|как\s+(?:рассчит|настро|реализ)|how\s+(?:to|do\s+you)\s+(?:calculat|configur|implement)/iu;
const PLACEHOLDER = /\{\{(salary_\w+?)(?:_usdt|_usd|_eur)?\}\}/g;
/** What a plain salary answer says besides its sums */
const PLAIN_WORDS = new Set(['от', 'в', 'месяц', 'ежемесячно', 'час', 'на', 'руки', 'до', 'вычета', 'ндфл', 'налогов', 'from', 'net', 'gross', 'per', 'month', 'hour', 'salary', 'before', 'taxes', 'a']);

/** Fallback wording follows the message language independently of its requested currency. */
const DEFAULT_ANSWERS = {
  en: { net: 'From {{salary_net}} net per month.', gross: 'From {{salary_gross}} gross per month ({{salary_net}} net).' },
  ru: { net: 'От {{salary_net}} в месяц на руки.', gross: 'От {{salary_gross}} в месяц до вычета {{salary_tax}}.' },
};
const HOURLY_ANSWERS = {
  ru: { net: 'От {{salary_net_hourly}} в час на руки.', gross: 'От {{salary_gross_hourly}} в час до вычета {{salary_tax}}.' },
  en: { net: 'From {{salary_net_hourly}} net per hour.', gross: 'From {{salary_gross_hourly}} gross per hour.' },
};

/** Monthly is the default only when the question does not explicitly request another period. */
export const salaryPeriod = (text) => ANNUAL.test(text) ? 'year' : HOURLY.test(text) ? 'hour' : 'month';

const words = (text) => (String(text).toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]{4,}/gu) ?? []);
const stems = (text) => new Set(words(text).map((word) => word.slice(0, 6)));
const english = (text) => !/[а-яё]/i.test(text);

/**
 * The shape of a saved salary answer, its sums as the base placeholders
 * @param {string} answer - As saved, with placeholders
 * @returns {{shape: 'net'|'gross', template: string, plain: boolean, detail: number}|null}
 */
export function answerShape(answer) {
  const text = [answer].flat().join('\n').trim();
  if (!/\{\{salary_(?:net|gross)/.test(text)) {
    return null;
  }
  const template = text.replace(PLACEHOLDER, '{{$1}}').replace(/\s*\.?$/, '.');
  const words = template.replace(/\{\{\w+\}\}/g, ' ');
  const rest = words.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const gross = /\{\{salary_gross(?:_hourly)?\}\}/.test(template);
  const net = /\{\{salary_net(?:_hourly)?\}\}/.test(template);
  const hourly = template.includes('_hourly}}');
  return {
    shape: gross ? 'gross' : 'net',
    ...(hourly ? { period: 'hour' } : {}),
    template,
    plain: rest.every((word) => PLAIN_WORDS.has(word)),
    // The most said: both sums, the month, net or gross named
    detail: Number(gross) + Number(net) + Number(/месяц|ежемесячно|month/i.test(words)) +
      Number(/на руки|net|до вычета|before/i.test(words)),
  };
}

/**
 * Learn the patterns from the saved questions and answers
 * @param {Map<string, string|string[]>} saved - qa.lino as stored (placeholders, not filled in)
 * @returns {{salaryStems: Set<string>, grossStems: Set<string>, variants: Object<string, string[]>}}
 *   variants: by «shape:language» («net:ru», «gross:en»)
 */
export function learnSalaryPatterns(saved) {
  const salary = [];
  const other = [];
  for (const [question, answer] of saved) {
    if (isPattern(question)) {
      continue;
    }
    const shape = answerShape(answer);
    (shape && !shape.period && !OTHER_PERIOD.test(question) && !NOT_EXPECTATION.test(question) ? salary : other).push({ question, shape, stems: stems(question) });
  }
  const count = (list, stem) => list.filter((item) => item.stems.has(stem)).length;
  const all = new Set(salary.flatMap((item) => [...item.stems]));
  // A word of salary questions, hardly anywhere else
  const salaryStems = new Set([...all].filter((stem) => {
    const inSalary = count(salary, stem);
    return inSalary >= 3 && inSalary / (inSalary + count(other, stem)) >= 0.9;
  }));
  // A word of the questions answered with a gross sum, hardly of those answered net
  const gross = salary.filter((item) => item.shape.shape === 'gross');
  const net = salary.filter((item) => item.shape.shape === 'net');
  const grossStems = new Set([...all].filter((stem) => {
    const inGross = count(gross, stem);
    return inGross >= 3 && inGross / (inGross + count(net, stem)) >= 0.9;
  }));
  const variants = {};
  for (const item of salary.filter(({ shape }) => shape.plain)) {
    const key = `${item.shape.shape}:${english(item.shape.template.replace(/\{\{\w+\}\}/g, '')) ? 'en' : 'ru'}`;
    (variants[key] ??= []).push(item.shape);
  }
  for (const [key, list] of Object.entries(variants)) {
    const most = Math.max(...list.map(({ detail }) => detail));
    variants[key] = [...new Set(list.filter(({ detail }) => detail === most).map(({ template }) => template))].sort();
  }
  return { salaryStems, grossStems, variants };
}

/** A number from a text, the same for the same text */
function hash(text) {
  let value = 0;
  for (const char of String(text)) {
    value = (value * 31 + char.codePointAt(0)) >>> 0;
  }
  return value;
}

/**
 * What a question asks about the pay
 * @param {string} question
 * @param {ReturnType<typeof learnSalaryPatterns>} [patterns]
 * @returns {{shape: 'net'|'gross', language: 'ru'|'en', period?: 'hour'}|null}
 */
export function salaryQuestion(question, patterns = null) {
  const text = String(question ?? '');
  // A list of questions is not one salary question
  const numbered = text.match(/(?:^|\n)\s*\d+[.)]\s/g)?.length ?? 0;
  if (!text.trim() || text.length > 400 || numbered > 1 || splitQuestions(text).length > 1 || NOT_EXPECTATION.test(text) || ANNUAL.test(text)) {
    return null;
  }
  const own = stems(text);
  const learned = (set) => [...own].filter((stem) => set?.has(stem)).length;
  const hourly = HOURLY.test(text);
  if (hourly && PAST_HOURLY.test(text)) return null;
  if (!SALARY.test(text) && !(hourly && HOURLY_RATE.test(text)) && learned(patterns?.salaryStems) < 2) {
    return null;
  }
  return {
    shape: PRIMARY_NET.test(text) ? 'net' : GROSS.test(text) || learned(patterns?.grossStems) > 0 ? 'gross' : 'net',
    language: english(text) ? 'en' : 'ru',
    ...(hourly ? { period: 'hour' } : {}),
  };
}

const CURRENCY = /[$€₽]|\b(?:usd[tc]?|eur|rub|dollars?|euros?|rubles?)\b|доллар|рубл|руб\.|евро/iu;
const CLARIFY = /цифр|сумм|подскаж|уточн|укаж|напиш|можно|figures?|amount|numbers?|please|could you|what about|how about|\?/iu;
const OTHER_MONEY_TOPIC = /бюджет|выручк|оборот|расход|налогооблож|revenue|budget|expenses?|как.*налог|how.*tax/iu;

/**
 * A follow-up may omit "salary": "цифры в долларах и до вычета налогов". Only continue a
 * recent salary question or a consecutive chain of its clarifications; unrelated topics stop it.
 * Returns a salary question for deterministic inference, never an exact saved-question claim.
 */
export function salaryClarificationQuestion(question, known = []) {
  const text = String(question ?? '').trim();
  if (salaryQuestion(text) || !text || text.length > 400 || NOT_EXPECTATION.test(text) || OTHER_PERIOD.test(text)) return null;
  const clarifies = (value) => (CURRENCY.test(value) || NET.test(value) || GROSS.test(value)) &&
    CLARIFY.test(value) && !OTHER_MONEY_TOPIC.test(value) && !OTHER_PERIOD.test(value) && !NOT_EXPECTATION.test(value);
  if (!clarifies(text)) return null;
  const previous = [known].flat().map(String).filter((value) => value.trim() && value.trim() !== text).slice(0, 4);
  const chain = [];
  let anchor;
  for (const value of previous) {
    if (salaryQuestion(value)) { anchor = value; break; }
    if (!clarifies(value)) return null;
    chain.push(value);
  }
  if (!anchor) return null;
  const tax = [text, ...chain, anchor].find((value) => NET.test(value) || GROSS.test(value)) ?? anchor;
  const shape = PRIMARY_NET.test(tax) ? 'net' : GROSS.test(tax) ? 'gross' : 'net';
  // A bare "USD gross?" keeps the previous message's language, rather than treating the
  // currency code as an English sentence.
  const languageText = text.replace(/\b(?:usd[tc]?|eur|rub|gross|net)\b/giu, '').replace(/[^\p{L}]/gu, '');
  const language = english(languageText ? text : anchor) ? 'en' : 'ru';
  const topic = salaryQuestion(anchor)?.period === 'hour'
    ? (language === 'ru' ? 'Ожидания по почасовой ставке' : 'Hourly salary expectations')
    : (language === 'ru' ? 'Зарплатные ожидания' : 'Salary expectations');
  return `${topic} ${shape}: ${text}`;
}

/** Keep only compatible plain salary suggestions; the transcript and saved wording stay intact. */
export function salaryAnswerForQuestion(question, answer) {
  const asked = salaryQuestion(question);
  if (!asked || Array.isArray(answer)) return answer;
  const checkShape = (NET.test(question) || GROSS.test(question)) && (!ambiguousSalaryTax(question) || PRIMARY_NET.test(question));
  const compatible = String(answer).split(' | ').filter((variant) => {
    const shape = answerShape(variant);
    if (shape && (shape.period ?? 'month') !== (asked.period ?? 'month')) return false;
    return !checkShape || !shape?.plain || shape.shape === asked.shape;
  });
  return compatible.length ? compatible.join(' | ') : null;
}

/**
 * The answer of a salary question by pattern
 * @param {string} question
 * @param {ReturnType<typeof learnSalaryPatterns>} patterns
 * @returns {string|null} With placeholders ({{salary_net}}, {{salary_gross}}, {{salary_tax}})
 */
export function inferSalaryAnswer(question, patterns) {
  const asked = salaryQuestion(question, patterns);
  if (!asked) {
    return null;
  }
  if (asked.period === 'hour') return HOURLY_ANSWERS[asked.language][asked.shape];
  const { variants } = patterns;
  const list = variants[`${asked.shape}:${asked.language}`] ?? [DEFAULT_ANSWERS[asked.language][asked.shape]];
  return list?.length ? list[hash(question) % list.length] : null;
}
