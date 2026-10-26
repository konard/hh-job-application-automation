/** Resolve saved button answers and salary ranges without sending arbitrary free text to a bot. */
import { normalizeQuestion } from './qa-database.mjs';
import { ambiguousSalaryTax, salaryQuestion } from './salary-questions.mjs';

export function perfectOption(answer, options) {
  const wanted = normalizeQuestion(answer);
  return options.find((option) => normalizeQuestion(option) === wanted) ?? null;
}

export const requiresChatOption = (question, options) => options.length > 0 &&
  /\b(?:select|choose|pick)\b|выбер(?:и|ите)|один\s+из\s+вариант/iu.test(question) ||
  /\b(?:select|choose|pick)\s+(?:one|an?\s+option|from)\b|выбер(?:и|ите)\s+(?:один|одну|вариант|из)/iu.test(question);

const currency = (text) => /₽|\brub\b|руб|russian rubles/iu.test(text) ? 'rub'
  : /\$|\busd\b|\busdt\b|dollars?|доллар/iu.test(text) ? 'usd'
    : /€|\beur\b|euros?|евро/iu.test(text) ? 'eur' : null;
const amounts = (text) => [...String(text).matchAll(/\d(?:[\d\s\u00a0\u202f,.]*\d)?/g)].map(([number]) => {
  const stripped = number.replace(/[\s\u00a0\u202f]/g, '');
  return Number(/^\d{1,3}(?:[.,]\d{3})+$/.test(stripped) ? stripped.replace(/[.,]/g, '') : stripped.replace(/,/g, ''));
});

function salaryRange(option) {
  if (/\d\s*(?:k|к|тыс|млн|million)(?!\p{L})/iu.test(option)) return null;
  const values = amounts(option);
  if (values.length === 2 && /[-–—]|\bto\b|до/iu.test(option) && values[0] < values[1]) {
    return { min: values[0], max: values[1], currency: currency(option) };
  }
  if (values.length !== 1) return null;
  if (/up\s+to|under|less\s+than|до(?!\p{L})|менее/iu.test(option)) return { min: 0, max: values[0], currency: currency(option) };
  if (/or\s+(?:more|above)|and\s+(?:more|above)|at\s+least|from|over|more\s+than|от(?!\p{L})|более|выше/iu.test(option)) {
    return { min: values[0], max: Infinity, currency: currency(option) };
  }
  return null;
}

/**
 * Auto-send only an exact saved option, or a unique salary range. Contradictory net/gross
 * questions require both configured sums to fit the same range. Overlaps, gaps, unknown
 * currencies and missing baselines are left for review.
 */
export function chooseChatOption({ question, reply, options, contacts = {} }) {
  const exact = reply?.answer && perfectOption(reply.answer, options);
  if (exact) return { option: exact, autoSend: Boolean(reply.perfect), reason: 'saved answer' };
  const asked = salaryQuestion(question);
  if (!asked || !options.length) return null;
  const ranges = options.map((option) => ({ option, range: salaryRange(option) })).filter(({ range }) => range);
  const currencies = new Set(ranges.map(({ range }) => range.currency).filter(Boolean));
  const wantedCurrency = currency(question) ?? (currencies.size === 1 ? [...currencies][0] : null);
  if (!wantedCurrency || ranges.some(({ range }) => range.currency && range.currency !== wantedCurrency)) return null;
  const baseline = (shape) => {
    const key = wantedCurrency === 'rub' ? `salary_${shape}` : `salary_${shape}_${wantedCurrency}`;
    const numbers = amounts(contacts[key] ?? (shape === 'net' && wantedCurrency === 'rub' ? contacts.salary_net_rub : ''));
    return numbers.length === 1 && numbers[0] > 0 ? numbers[0] : null;
  };
  const shapes = ambiguousSalaryTax(question) ? ['net', 'gross'] : [asked.shape];
  const values = shapes.map(baseline);
  if (values.some((value) => value === null)) return null;
  // A different exact saved amount is an explicit answer, not permission to replace it with
  // the default baseline. It needs review unless it selects an option word for word above.
  if (reply?.perfect) {
    const savedAmounts = amounts(reply.answer);
    if (savedAmounts.length && !savedAmounts.some((value) => values.includes(value))) return null;
  }
  const picks = values.map((value) => ranges.filter(({ range }) => value >= range.min && value <= range.max));
  if (picks.some((pick) => pick.length !== 1)) return null;
  const picked = new Set(picks.map(([pick]) => pick.option));
  if (picked.size !== 1) return null;
  return { option: [...picked][0], autoSend: true, reason: `salary range (${shapes.map((shape, i) => `${shape} ${values[i]} ${wantedCurrency}`).join(', ')})` };
}

/** The same question immediately after a sent answer means that wording was not accepted. */
export function answerWasRepeated(chat, last, answer) {
  const index = chat.messages.findIndex((message) => message.id === last.id);
  const replies = [];
  for (let at = index - 1; at >= 0; at -= 1) {
    const message = chat.messages[at];
    if (message.mine) { replies.push(message.text); continue; }
    return normalizeQuestion(message.text) === normalizeQuestion(last.text) &&
      replies.some((text) => normalizeQuestion(text) === normalizeQuestion(answer));
  }
  return false;
}
