/**
 * The vacancy a form belongs to, as context for its answers: when the pay the form or the vacancy
 * states is less than the user's target, a pay question is answered with that pay as the minimum
 * (the top of a range), plus the user's comfortable rate, so a lower-paid application still goes
 * through every stage. The answer is short: the two sums, no calculation.
 *
 * The vacancy is read once from its public page (a plain request, no browser).
 *
 * @module vacancy-context
 */

/** A question about pay: salary, rate, income */
const PAY_QUESTION = /зарплат|оплат|ставк|доход|вознагражд|\bз\s?\/\s?п\b|salary|compensation|\brate\b|\bpay\b/i;
export const isPayQuestion = (title) => PAY_QUESTION.test(String(title ?? ''));

const decode = (html) => String(html)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;| | /g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/**
 * Title, salary and description of an hh.ru vacancy page
 * @param {string} html
 * @returns {{title: string, salary: string, description: string}}
 */
export function parseVacancyPage(html) {
  const part = (qa) => html.match(new RegExp(`data-qa="${qa}"[^>]*>([\\s\\S]*?)</(?:div|h1|span)>`))?.[1] ?? '';
  const description = html.match(/data-qa="vacancy-description"[^>]*>([\s\S]*?)<\/div><\/div>/)?.[1] ?? '';
  return { title: decode(part('vacancy-title')), salary: decode(part('vacancy-salary')), description: decode(description) };
}

/**
 * The vacancy page, or null when it cannot be read
 * @param {string} url - https://hh.ru/vacancy/<id>
 * @returns {Promise<{url: string, title: string, salary: string, description: string}|null>}
 */
export async function fetchVacancy(url) {
  if (!url) {
    return null;
  }
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ru' }, signal: globalThis.AbortSignal.timeout(20000) });
    if (!response.ok) {
      return null;
    }
    const vacancy = parseVacancyPage(await response.text());
    return vacancy.title || vacancy.salary ? { url, ...vacancy } : null;
  } catch {
    return null;
  }
}

/** A sum of money in a text: «3000р.», «80 000 ₽», «2 000 руб» */
const SUM = /\d[\d\s]*\s?(?:₽|руб|р\.|rub)/i;
export const statesPay = (text) => SUM.test(String(text ?? ''));

/**
 * What the draft is told about pay: the user's target and comfortable rate (data/profile.lino
 * «salary» and «rate») against the pay the form's own description or the vacancy states
 * @param {Object} options
 * @param {{salary?: string}|null} options.vacancy
 * @param {{salary?: string, rate?: string}} options.profile
 * @param {string} [options.intro] - The form's own description
 * @returns {string}
 */
export function payGuidance({ vacancy, profile, intro = '' }) {
  return `Это вопрос об оплате. Моя целевая оплата: ${profile.salary || '[нет в профиле]'}; моя комфортная ставка в час: ${profile.rate || '[нет в профиле]'}.
Оплата в вакансии: ${vacancy?.salary || 'не указана'}.${statesPay(intro) ? '\nОписание анкеты (выше) называет свою оплату: она точнее вакансии, бери её.' : ''}
Если названная оплата ниже моей целевой: она и есть минимум, на который я согласен (у вилки — верхняя граница, у «от» — эта сумма), в тех единицах, о которых спрашивают: за занятие 1,5 часа → раздели на 1,5; за месяц, а спрашивают за час → раздели на 168 часов. Отдельно добавь мою комфортную ставку.
Если названная оплата не ниже моей целевой или не указана: назови мою целевую оплату (в тех единицах, о которых спрашивают) и комфортную ставку.
Ответ короткий, одна-две фразы, как: «Минимум — 2 000 ₽ в час на руки (3 000 ₽ за занятие 1,5 часа, как в описании). Комфортная ставка — 2 700 ₽ в час.» Ход расчёта не объясняй.
Без пометок [уточнить] для сумм: все суммы есть выше.`;
}
