/** Session-only salary ordering. Missing/ambiguous pay never becomes a hard exclusion. */
import { salaryAmounts, salaryCurrency, salaryRange } from './salary-options.mjs';

const amount = value => salaryAmounts(String(value ?? ''))[0] ?? 0;
const codeOf = code => ({ RUR: 'RUB', USDT: 'USD' }[String(code).toUpperCase()] ?? String(code).toUpperCase());

export function vacancySalary(text, { monthlyHours = 160, currencies = [] } = {}) {
  if (!text?.trim()) return null;
  const values = salaryAmounts(text);
  // Only accept the isolated salary field, never numbers from the description or questionnaire.
  if (!values.length || values.length > 2) return null;
  let range = salaryRange(text);
  if (!range && values.length === 1) range = { min: values[0], max: values[0] };
  if (!range) return null;
  const currency = salaryCurrency(text) ?? (/\bRUR\b/i.test(text) ? 'rub' : null);
  const foreign = text.match(/₸/) ? 'KZT' : /\bBr\b/.test(text) ? 'BYN' :
    text.match(/\b(AED|AMD|AZN|BYN|CHF|CNY|GBP|GEL|INR|JPY|KGS|KZT|THB|TRY|UZS|VND)\b/i)?.[1] ??
      text.match(/\b[A-Z]{3}\b/g)?.find(code => currencies.includes(code));
  if (!currency && !foreign) return null;
  let factor = 1;
  if (/per\s+hour|\/\s*h(?:our)?\b|в\s+час|за\s+час|\/\s*ч(?:ас)?\b/iu.test(text)) factor = monthlyHours;
  else if (/per\s+year|annual|в\s+год|за\s+год/iu.test(text)) factor = 1 / 12;
  else if (/per\s+(?:shift|day|rotation|service|project)|за\s+(?:смен|день|вахт|услуг|проект)/iu.test(text)) return null;
  return { min: range.min * factor, max: range.max * factor, currency: codeOf(currency ?? foreign) };
}

export function createSalaryLadder({ contacts = {}, rubPer = {}, enabled = true, stepRub = 50000,
  release = () => {}, hold = () => {}, log = console.log } = {}) {
  const targetRub = amount(contacts.salary_net_rub ?? contacts.salary_net);
  const targets = { RUB: targetRub, USD: amount(contacts.salary_net_usd), EUR: amount(contacts.salary_net_eur) };
  const rates = { ...rubPer, RUB: 1 };
  const includeUnspecified = url => {
    url.searchParams.delete('only_with_salary');
    const labels = url.searchParams.getAll('label');
    if (labels.some(label => ['with_salary', 'only_with_salary'].includes(label))) {
      url.searchParams.delete('label');
      for (const label of labels.filter(label => !['with_salary', 'only_with_salary'].includes(label))) url.searchParams.append('label', label);
    }
  };
  const active = enabled && targetRub > 0;
  if (!(stepRub > 0) || !Number.isFinite(stepRub)) throw new Error('Salary ladder step must be positive');
  const deferred = new Map();
  let floorRub = targetRub;
  let searchUrl = null;

  const assess = salary => {
    if (!active) return { action: 'apply', reason: 'disabled' };
    const range = vacancySalary(salary, { monthlyHours: amount(contacts.salary_hours_per_month) || 160, currencies: Object.keys(rates) });
    if (!range) return { action: 'apply', reason: 'unspecified_or_unranked' };
    const target = targets[range.currency] || (rates[range.currency] > 0 ? targetRub / rates[range.currency] : 0);
    if (!target) return { action: 'apply', reason: 'unknown_currency_target' };
    if (Number.isFinite(range.max) && range.max < target * 0.5) return { action: 'exclude', reason: 'upper_below_half_target', range, target };
    // A minimum-only offer enters at its advertised minimum; an unlimited ceiling is not target pay.
    const anchor = Number.isFinite(range.max) ? range.max : range.min;
    const equivalentRub = anchor / target * targetRub;
    return { action: equivalentRub + 1e-7 < floorRub ? 'defer' : 'apply', reason: 'salary_tier', range, target, equivalentRub };
  };

  return {
    get enabled() { return active; },
    get floorRub() { return floorRub; },
    get searchUrl() { return searchUrl; },
    assess,
    check(vacancyId, salary) {
      const result = assess(salary);
      if (result.action === 'defer') deferred.set(String(vacancyId), salary);
      else deferred.delete(String(vacancyId));
      if (result.action !== 'apply') hold(String(vacancyId));
      if (result.action !== 'apply') log(`💰 Vacancy ${vacancyId}: ${result.action} (${result.reason}); current salary floor ${floorRub} RUB`);
      return result;
    },
    prepare(rawUrl) {
      if (!active) return rawUrl;
      const url = new URL(rawUrl);
      if (url.pathname !== '/search/vacancy' || !url.searchParams.has('resume')) return rawUrl;
      // HH returns unspecified salaries unless this checkbox is enabled.
      includeUnspecified(url);
      const current = Number(url.searchParams.get('salary'));
      if (url.searchParams.get('salary')?.trim() && Number.isFinite(current) && current >= 0) {
        const currency = codeOf(url.searchParams.get('currency_code') || 'RUR');
        // Preserve an existing filter exactly. Unknown FX prevents unsafe progression.
        floorRub = currency === 'RUB' ? current : rates[currency] > 0 ? current * rates[currency] : null;
      } else {
        floorRub = targetRub;
        url.searchParams.set('salary', String(targetRub));
        url.searchParams.set('currency_code', 'RUR');
        url.searchParams.delete('page');
        url.searchParams.delete('search_session_id');
      }
      searchUrl = url.href;
      return searchUrl;
    },
    advance(rawUrl = searchUrl) {
      if (!active || floorRub === null || floorRub <= 0 || !rawUrl) return null;
      const url = new URL(rawUrl);
      if (url.pathname !== '/search/vacancy' || !url.searchParams.has('resume')) return null;
      const currency = codeOf(url.searchParams.get('currency_code') || 'RUR');
      const rate = rates[currency];
      if (!(rate > 0)) return null;
      floorRub = Math.max(0, floorRub - stepRub);
      url.searchParams.set('salary', String(Number((floorRub / rate).toFixed(6))));
      includeUnspecified(url);
      url.searchParams.delete('page');
      url.searchParams.delete('search_session_id');
      searchUrl = url.href;
      for (const [id, salary] of deferred) {
        if (assess(salary).action !== 'defer') { deferred.delete(id); release(id); }
      }
      log(`💰 Higher salary tier exhausted; continuing matching vacancies from ${floorRub} RUB equivalent, including unspecified salaries`);
      return searchUrl;
    },
  };
}
