/** Numeric salary choices shared by chat, HH.ru questionnaires and external forms. */
import { ambiguousSalaryTax, salaryPeriod, salaryQuestion } from './salary-questions.mjs';

export const salaryCurrency = (text) => /₽|\brub\b|руб|russian rubles/iu.test(text) ? 'rub'
  : /\$|\busd\b|\busdt\b|dollars?|доллар/iu.test(text) ? 'usd'
    : /€|\beur\b|euros?|евро/iu.test(text) ? 'eur' : null;

export function salaryAmounts(text) {
  const matches = [...String(text).matchAll(/(\d(?:[\d\s\u00a0\u202f,.]*\d)?)\s*(тыс\.?|млн\.?|million|thousand|[kкmм])(?!\p{L})|(\d(?:[\d\s\u00a0\u202f,.]*\d)?)/giu)];
  const parsed = matches.map((match) => {
    const raw = (match[1] ?? match[3]).replace(/\s/g, '');
    const number = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'));
    const unit = match[2]?.toLowerCase();
    return { number, scale: unit ? (/^(?:млн|million|m|м)/u.test(unit) ? 1e6 : 1e3) : null };
  });
  const units = new Set(parsed.map((item) => item.scale).filter(Boolean));
  const inherited = units.size === 1 ? [...units][0] : 1;
  return parsed.map(({ number, scale }) => number * (scale ?? (number < 1000 ? inherited : 1)));
}

export function salaryRange(option) {
  const values = salaryAmounts(option);
  const code = salaryCurrency(option);
  if (values.length === 2 && /[-–—]|\bto\b|до/iu.test(option) && values[0] < values[1]) {
    return { min: values[0], max: values[1], currency: code };
  }
  if (values.length !== 1) return null;
  if (/up\s+to|under|less\s+than|до(?!\p{L})|менее/iu.test(option)) return { min: 0, max: values[0], currency: code,
    maxExclusive: /under|less\s+than|менее/iu.test(option) };
  if (/or\s+(?:more|above)|and\s+(?:more|above)|at\s+least|from|over|more\s+than|от(?!\p{L})|более|выше|свыше/iu.test(option)) {
    return { min: values[0], max: Infinity, currency: code,
      minExclusive: /(?<!\p{L})(?:over|more\s+than|более|выше|свыше)(?!\p{L})/iu.test(option) &&
        !/(?:or|and)\s+(?:more|above)|(?:и|или)\s+(?:более|выше)/iu.test(option) };
  }
  return null;
}

/** Closest is for user-reviewed prefills; chat can require a uniquely containing band. */
export function selectSalaryOption({ question, options, contacts = {}, answer = '', closest = false }) {
  const asked = salaryQuestion(question);
  if (!asked) return null;
  const ranges = options.map((option) => ({ option, range: salaryRange(option) })).filter(({ range }) => range);
  if (!ranges.length) return null;
  const codes = new Set(ranges.map(({ range }) => range.currency).filter(Boolean));
  const code = salaryCurrency(question) ?? (codes.size === 1 ? [...codes][0] : salaryCurrency(answer));
  if (!code || ranges.some(({ range }) => range.currency && range.currency !== code)) return null;
  const shapes = ambiguousSalaryTax(question) ? ['net', 'gross'] : [asked.shape];
  const values = shapes.map((shape) => {
    const suffix = code === 'rub' ? '' : `_${code}`;
    const hourly = asked.period === 'hour';
    const configured = contacts[`salary_${shape}${hourly ? '_hourly' : ''}${suffix}`] ??
      (!hourly && shape === 'net' && code === 'rub' ? contacts.salary_net_rub : undefined);
    const numbers = salaryAmounts(configured ?? '');
    if (numbers.length === 1 && numbers[0] > 0) return numbers[0];
    // Expanded saved salary wording can supply a baseline when this caller has no contacts.
    const amounts = salaryAmounts(answer);
    const basis = /gross|до\s+(?:вычета|налог)|брутто/iu.test(answer) ? 'gross' : 'net';
    return amounts.length === 1 && amounts[0] > 0 && salaryCurrency(answer) === code && basis === shape &&
      salaryPeriod(answer) === (hourly ? 'hour' : 'month') && !options.includes(answer)
      ? amounts[0] : null;
  });
  if (values.some((value) => value === null)) return null;
  const contains = (range, value) => (range.minExclusive ? value > range.min : value >= range.min) &&
    (range.maxExclusive ? value < range.max : value <= range.max);
  const picks = values.map((value) => {
    const inside = ranges.filter(({ range }) => contains(range, value));
    if (inside.length) return inside.length === 1 ? { ...inside[0], distance: 0 } : null;
    if (!closest) return null;
    const sorted = ranges.map((row) => ({ ...row, distance: value < row.range.min ? row.range.min - value : value - row.range.max }))
      .sort((a, b) => a.distance - b.distance);
    return sorted.length > 1 && sorted[0].distance === sorted[1].distance ? null : sorted[0];
  });
  if (picks.some((pick) => !pick) || new Set(picks.map((pick) => pick.option)).size !== 1) return null;
  return { option: picks[0].option, contained: picks.every((pick, i) => contains(pick.range, values[i])), values, currency: code, shapes };
}
