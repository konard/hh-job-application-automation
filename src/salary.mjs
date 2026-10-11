/**
 * Salary answers from one baseline: the net pay a month in dollars (data/contacts.lino
 * «salary_net_usd», e.g. 6000). Answers use placeholders, filled in like contacts:
 *   {{salary_net}}       510 000 ₽     net a month in rubles, at the Central Bank's rate of the day
 *   {{salary_gross}}     610 000 ₽     gross a month: the pay before the progressive personal income tax
 *   {{salary_net_usd}}   $6 000
 *   {{salary_gross_usd}} $7 100
 *   {{salary_ndfl}}      13% / 15% / 18%   the tax rates that gross goes through
 * Rubles are rounded up to 10 000, dollars to 100 («от» pay is never below the baseline).
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
 * The placeholders' values
 * @param {{netUsd: number, usdRate: number}} options
 * @returns {Object<string, string>}
 */
export function salaryValues({ netUsd, usdRate }) {
  const netRub = netUsd * usdRate;
  const { gross, rates } = annualGrossFromNet(netRub * 12);
  const grossRub = gross / 12;
  return {
    salary_net: `${grouped(roundUp(netRub, 10000))} ₽`,
    salary_gross: `${grouped(roundUp(grossRub, 10000))} ₽`,
    salary_net_usd: `$${grouped(netUsd)}`,
    salary_gross_usd: `$${grouped(roundUp(grossRub / usdRate, 100))}`,
    salary_ndfl: rates.map((rate) => `${Math.round(rate * 100)}%`).join(' / '),
  };
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
