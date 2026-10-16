/**
 * Salary answers from three baselines, the net pay a month (data/contacts.lino): in rubles
 * «salary_net_rub» (e.g. 450000), in dollars «salary_net_usd» (e.g. 6000) and in euros
 * «salary_net_eur» (e.g. 5500), set apart, not converted. Answers use placeholders, filled in like
 * contacts:
 *   {{salary_net}}       450 000 ₽
 *   {{salary_gross}}     530 000 ₽     the pay before the progressive personal income tax
 *   {{salary_net_usd}}   $6 000
 *   {{salary_gross_usd}} $7 500        what a contract with the user's own company pays: its taxes
 *                                      included (data/company-taxes.lino), else the ruble tax's
 *                                      brackets at the Central Bank's rate of the day
 *   {{salary_net_usdt}}  6 000 USDT    the dollar sums paid in a stablecoin (blockchain vacancies)
 *   {{salary_gross_usdt}} 7 500 USDT
 *   {{salary_net_eur}}   5 500 €
 *   {{salary_gross_eur}} 6 900 €       the same in euros
 *   {{salary_ndfl}}      13% / 15% / 18%   the tax rates the ruble gross goes through
 *   {{salary_tax}}       НДФЛ           the tax a gross is before («налогов» in another currency, answer-contexts.lino)
 * Gross is rounded up: rubles to 10 000, dollars and euros to 100 («от» pay is never below the baseline).
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
/** The foreign baselines: their contacts.lino key, the Central Bank's code, how a sum is written */
/**
 * The taxes of the user's own company that a contract in dollars or euros pays (personal: the
 * file is not committed), e.g.
 *   profit
 *     15% up to 3000000000 VND      the profit tax by the company's revenue a year (the whole
 *     17% up to 50000000000 VND     profit at one rate), the band's sum in any currency the
 *     20%                           Central Bank has a rate of
 *   payout
 *     5%                            the tax on the profit paid out to the owner
 */
export const COMPANY_TAXES_FILE = path.join(process.cwd(), 'data', 'company-taxes.lino');

/**
 * @param {Map<string, string|string[]>} entries - data/company-taxes.lino as read
 * @returns {{profit: Array<{rate: number, upTo: number, code: string|null}>, payout: number}|null}
 */
export function parseCompanyTaxes(entries) {
  const percent = (text) => Number(String(text).match(/([\d.,]+)\s*%/)?.[1]?.replace(',', '.')) / 100;
  const profit = [entries.get('profit') ?? []].flat().map((line) => {
    const band = String(line).match(/up to\s+([\d\s]+)\s*([A-Z]{3})?/i);
    return { rate: percent(line), upTo: band ? Number(band[1].replace(/\s/g, '')) : Infinity, code: band?.[2]?.toUpperCase() ?? null };
  }).filter(({ rate }) => Number.isFinite(rate)).sort((a, b) => a.upTo - b.upTo);
  const payout = percent([entries.get('payout') ?? '0%'].flat()[0]);
  return profit.length ? { profit, payout: Number.isFinite(payout) ? payout : 0 } : null;
}

/**
 * The monthly sum a contract pays the company so that its owner gets the net after its taxes
 * @param {number} net - A month, in the contract's currency
 * @param {{profit: Array, payout: number}} taxes - parseCompanyTaxes
 * @param {number} rubPerUnit - The contract's currency in rubles
 * @param {Object<string, number>} rubPer - Rubles per unit of the bands' currencies
 * @returns {number|null} Null when a band's currency has no rate
 */
export function companyGross(net, taxes, rubPerUnit, rubPer = {}) {
  for (const { rate, upTo, code } of taxes.profit) {
    const gross = net / ((1 - rate) * (1 - taxes.payout));
    if (upTo === Infinity) {
      return gross;
    }
    const bandRate = code ? rubPer[code] : rubPerUnit;
    if (!(bandRate > 0)) {
      return null;
    }
    if (gross * 12 * rubPerUnit / bandRate <= upTo) {
      return gross;
    }
  }
  return null;
}

const FOREIGN = [
  { suffix: 'usd', code: 'USD', write: (sum) => `$${sum}` },
  { suffix: 'usdt', code: 'USD', write: (sum) => `${sum} USDT` },
  { suffix: 'eur', code: 'EUR', write: (sum) => `${sum} €` },
];

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
 * The placeholders' values; a foreign gross only with its rate
 * @param {{netRub?: number, netUsd?: number, netEur?: number, usdRate?: number|null, eurRate?: number|null,
 *   company?: ReturnType<typeof parseCompanyTaxes>, rubPer?: Object<string, number>}} options
 *   company: the user's company's taxes, what a foreign gross includes; rubPer: rubles per unit of other currencies
 * @returns {Object<string, string>}
 */
export function salaryValues({ netRub = 0, netUsd = 0, netEur = 0, usdRate = null, eurRate = null, company = null, rubPer = {} }) {
  const values = { salary_tax: 'НДФЛ' };
  if (netRub > 0) {
    const { gross, rates } = annualGrossFromNet(netRub * 12);
    values.salary_net = `${grouped(netRub)} ₽`;
    values.salary_gross = `${grouped(roundUp(gross / 12, 10000))} ₽`;
    values.salary_ndfl = rates.map((rate) => `${Math.round(rate * 100)}%`).join(' / ');
  }
  const foreign = { usd: [netUsd, usdRate], usdt: [netUsd, usdRate], eur: [netEur, eurRate] };
  for (const { suffix, write } of FOREIGN) {
    const [net, rate] = foreign[suffix];
    if (net > 0) {
      values[`salary_net_${suffix}`] = write(grouped(net));
      if (rate > 0) {
        const gross = (company && companyGross(net, company, rate, rubPer)) ?? annualGrossFromNet(net * rate * 12).gross / 12 / rate;
        values[`salary_gross_${suffix}`] = write(grouped(roundUp(gross, 100)));
      }
    }
  }
  return values;
}

/**
 * Rubles per dollar and per euro: the Central Bank's rates of the day, else the last ones read
 * @param {{fetchImpl?: Function, cacheFile?: string}} [options]
 * @returns {Promise<{usd: number|null, eur: number|null, rubPer: Object<string, number>}>} rubPer:
 *   rubles per unit of every currency the Central Bank has
 */
export async function exchangeRates({ fetchImpl = fetch, cacheFile = RATE_CACHE } = {}) {
  try {
    const response = await fetchImpl(RATE_URL, { signal: globalThis.AbortSignal.timeout(10000) });
    const valute = (await response.json())?.Valute ?? {};
    const [usd, eur] = [valute.USD?.Value, valute.EUR?.Value];
    const rubPer = Object.fromEntries(Object.values(valute).filter(({ Value, Nominal }) => Value > 0 && Nominal > 0)
      .map(({ CharCode, Value, Nominal }) => [CharCode, Value / Nominal]));
    if (usd > 0) {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify({ rate: usd, eur: eur ?? null, rubPer, date: new Date().toISOString() }));
      return { usd, eur: eur > 0 ? eur : null, rubPer };
    }
  } catch {
    // The cached rates below
  }
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    return { usd: cached.rate ?? null, eur: cached.eur ?? null, rubPer: cached.rubPer ?? {} };
  } catch {
    return { usd: null, eur: null, rubPer: {} };
  }
}
