/**
 * Salary answers from two baselines, the net pay a month (data/contacts.lino): in rubles
 * «salary_net_rub» (e.g. 450000) and in dollars «salary_net_usd» (e.g. 6000), set apart, not
 * converted. Answers use placeholders, filled in like contacts:
 *   {{salary_net}}       450 000 ₽
 *   {{salary_gross}}     530 000 ₽     the pay before the progressive personal income tax
 *   {{salary_net_usd}}   $6 000
 *   {{salary_gross_usd}} $7 100        the same tax, its brackets at the Central Bank's rate of the day
 *   {{salary_ndfl}}      13% / 15% / 18%   the tax rates the ruble gross goes through
 * Gross is rounded up: rubles to 10 000, dollars to 100 («от» pay is never below the baseline).
 *
 * @module salary
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Russian personal income tax (НДФЛ) since 2025: rate by the part of the year's income */
export const NDFL_SCALE = [
  { upTo: 2_400_000, rate: 0.13 },
  { upTo: 5_000_000, rate: 0.15 },
  { upTo: 20_000_000, rate: 0.18 },
  { upTo: 50_000_000, rate: 0.20 },
  { upTo: Infinity, rate: 0.22 },
];

const RATE_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
/** The last rate fetched, for a day the Central Bank's rate cannot be read (logs/ is not committed) */
const RATE_CACHE = path.join(process.cwd(), 'logs', 'usd-rate.json');

/**
 * The year's gross pay whose net after the progressive tax is the given net
 * @param {number} annualNet
 * @returns {{gross: number, rates: number[]}} rates: the tax rates the gross goes through
 */
export function annualGrossFromNet(annualNet) {
  let gross = 0;
  let net = 0;
  const rates = [];
  let from = 0;
  for (const { upTo, rate } of NDFL_SCALE) {
    rates.push(rate);
    const bracketNet = (upTo - from) * (1 - rate);
    if (net + bracketNet >= annualNet) {
      return { gross: gross + (annualNet - net) / (1 - rate), rates };
    }
    gross = upTo;
    net += bracketNet;
    from = upTo;
  }
  return { gross, rates };
}

const roundUp = (value, step) => Math.ceil(value / step) * step;
const grouped = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * The placeholders' values; the dollar gross only with a rate
 * @param {{netRub?: number, netUsd?: number, usdRate?: number|null}} options
 * @returns {Object<string, string>}
 */
export function salaryValues({ netRub = 0, netUsd = 0, usdRate = null }) {
  const values = {};
  if (netRub > 0) {
    const { gross, rates } = annualGrossFromNet(netRub * 12);
    values.salary_net = `${grouped(netRub)} ₽`;
    values.salary_gross = `${grouped(roundUp(gross / 12, 10000))} ₽`;
    values.salary_ndfl = rates.map((rate) => `${Math.round(rate * 100)}%`).join(' / ');
  }
  if (netUsd > 0) {
    values.salary_net_usd = `$${grouped(netUsd)}`;
    if (usdRate > 0) {
      values.salary_gross_usd = `$${grouped(roundUp(annualGrossFromNet(netUsd * usdRate * 12).gross / 12 / usdRate, 100))}`;
    }
  }
  return values;
}

/** Pay in dollars: «$», «USD», «доллар», «выплаты в валюте» */
const USD = /\$|(?<!\p{L})usd(?!\p{L})|доллар|dollar|в\s+валюте/iu;
/** Pay in rubles: «₽», «RUB», «в рублях», «руб.» */
const RUB = /₽|(?<!\p{L})rub(?!\p{L})|(?<!\p{L})руб(?:л|\.|(?!\p{L}))/iu;

/**
 * The currency a salary answer is given in: the one the question itself names, else dollars when
 * anything about the vacancy (its card, description, the form's other questions) speaks of
 * dollars, else rubles
 * @param {string} question
 * @param {string} [context] - The vacancy's card, description and form text
 * @returns {'usd'|'rub'}
 */
export function salaryCurrency(question, context = '') {
  const [usd, rub] = [USD.test(question), RUB.test(question)];
  if (usd !== rub) {
    return usd ? 'usd' : 'rub';
  }
  return USD.test(context) ? 'usd' : 'rub';
}

/** The ruble placeholders and their dollar counterparts */
const CURRENCY_PAIRS = [['salary_net', 'salary_net_usd'], ['salary_gross', 'salary_gross_usd']];

/**
 * The salary values in one currency: in dollars {{salary_net}} is the dollar sum too, in rubles
 * {{salary_net_usd}} the ruble sum; a sum missing in that currency keeps the saved one
 * @param {Object} values - Contacts with the salary values (salaryValues)
 * @param {'usd'|'rub'} currency
 * @returns {Object}
 */
export function inCurrency(values, currency) {
  const result = { ...values };
  for (const [rub, usd] of CURRENCY_PAIRS) {
    const [to, from] = currency === 'usd' ? [rub, usd] : [usd, rub];
    if (values[from] !== undefined) {
      result[to] = values[from];
    }
  }
  return result;
}

/**
 * Rubles per dollar: the Central Bank's rate of the day, else the last one read
 * @param {{fetchImpl?: Function, cacheFile?: string}} [options]
 * @returns {Promise<number|null>}
 */
export async function usdRate({ fetchImpl = fetch, cacheFile = RATE_CACHE } = {}) {
  try {
    const response = await fetchImpl(RATE_URL, { signal: globalThis.AbortSignal.timeout(10000) });
    const rate = (await response.json())?.Valute?.USD?.Value;
    if (rate > 0) {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify({ rate, date: new Date().toISOString() }));
      return rate;
    }
  } catch {
    // The cached rate below
  }
  try {
    return JSON.parse(await fs.readFile(cacheFile, 'utf8')).rate ?? null;
  } catch {
    return null;
  }
}
