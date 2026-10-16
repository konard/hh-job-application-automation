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
 * Questions about the pay of a past job, about a given range («устраивает?»), a year or an hour are
 * left to the saved answers as before.
 *
 * @module salary-questions
 */

import { isPattern } from './qa-database.mjs';

/** Built-in words that make a question a salary question */
const SALARY = /зарплат|заработн|з\s?\/\s?пл?(?!\p{L})|в\s+каком\s+диапазоне|(?<!\p{L})зп(?!\p{L})|оклад|вознагражден|(?:финансов|денежн)\p{L}*\s+(?:ожидани|пожелани|услови)|ожидани\p{L}*\s+по\s+(?:доход|оплат|вознагражд)|(?:уровень|уровня|уровне)\s+дохода|желаем\p{L}*\s+доход|(?:от|на)\s+как\p{L}*\s+сумм|вилк|компенсац|(?:ожидаем|желаем|комфортн)\p{L}*\s+(?:уров\p{L}*\s+)?(?:доход|оплат)|(?:уров|размер)\p{L}*\s+(?:ожидаемого\s+|желаемо\p{L}*\s+)?(?:доход|оплат)|доход\p{L}*\s+для\s+себя|salary|compensation|pay expectation|rate expectation/iu;
/** Built-in words of a gross sum */
const GROSS = /gross|гросс|брутто|до\s+(?:вычета|уплаты|налог|ндфл)|before\s+tax/iu;
/**
 * Not the expected pay: a past or current job, a given sum or range to agree to, a sum in a year,
 * the pay as a word of something else (a bank card, a 1C module, the way it is paid)
 */
const NOT_EXPECTATION = /(?:прошл|предыдущ|текущ|последн)\p{L}*\s+(?:мест|работ|должност|зарплат|заработн|доход|оклад|з\s?\/\s?п|зп|компенсац|уров)(?!\p{L}*\s+ожидан)|сейчас\s+получа|получали|устраива|подходит|подойд|соглас(?:ны|на|ен|итесь|ились)|готов\p{L}*\s+ли|рассматрива\p{L}*\s+ли|входит\p{L}*\s+ли|входит\p{L}*\s+в\s+ваш|вписыва|в\s+рамках|через\s+год|зарплатн\p{L}*\s+карт|подсистем|выплат\p{L}*\s+(?:зарплат|заработн)|вариант\p{L}*\s+оформлени/iu;
/** A year or an hour is not the month the answers are about */
const OTHER_PERIOD = /в\s+год|годов\p{L}*\s+(?:доход|оклад|компенсац|зарплат)|за\s+год|annual|per\s+year|в\s+час|почасов|за\s+час|hourly|per\s+hour/iu;
const PLACEHOLDER = /\{\{(salary_\w+?)(?:_usdt|_usd|_eur)?\}\}/g;
/** What a plain salary answer says besides its sums */
const PLAIN_WORDS = new Set(['от', 'в', 'месяц', 'ежемесячно', 'на', 'руки', 'до', 'вычета', 'ндфл', 'налогов', 'from', 'net', 'gross', 'per', 'month', 'salary', 'before', 'taxes', 'a']);

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
  const gross = template.includes('{{salary_gross}}');
  const net = template.includes('{{salary_net}}');
  return {
    shape: gross ? 'gross' : 'net',
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
    (shape && !NOT_EXPECTATION.test(question) ? salary : other).push({ question, shape, stems: stems(question) });
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
    const key = `${item.shape.shape}:${english(item.question) ? 'en' : 'ru'}`;
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
 * @returns {{shape: 'net'|'gross', language: 'ru'|'en'}|null} Null: not a question about the expected pay a month
 */
export function salaryQuestion(question, patterns = null) {
  const text = String(question ?? '');
  // A list of questions is not one salary question
  const numbered = text.match(/(?:^|\n)\s*\d+[.)]\s/g)?.length ?? 0;
  if (!text.trim() || text.length > 400 || numbered > 1 || NOT_EXPECTATION.test(text) || OTHER_PERIOD.test(text)) {
    return null;
  }
  const own = stems(text);
  const learned = (set) => [...own].filter((stem) => set?.has(stem)).length;
  if (!SALARY.test(text) && learned(patterns?.salaryStems) < 2) {
    return null;
  }
  return {
    shape: GROSS.test(text) || learned(patterns?.grossStems) > 0 ? 'gross' : 'net',
    language: english(text) ? 'en' : 'ru',
  };
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
  const { variants } = patterns;
  // A gross question in English without English gross answers takes the Russian ones, and so on
  const list = variants[`${asked.shape}:${asked.language}`] ?? variants[`${asked.shape}:ru`] ??
    (asked.shape === 'gross' ? null : variants['net:en']);
  return list?.length ? list[hash(question) % list.length] : null;
}
