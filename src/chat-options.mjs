/** Resolve saved button answers and salary ranges without sending arbitrary free text to a bot. */
import { normalizeQuestion } from './qa-database.mjs';
import { salaryQuestion } from './salary-questions.mjs';
import { salaryAmounts, selectSalaryOption } from './salary-options.mjs';
import { summaryPairs } from './chat-answers.mjs';

export function perfectOption(answer, options) {
  const wanted = normalizeQuestion(answer);
  return options.find((option) => normalizeQuestion(option) === wanted) ?? null;
}

export const requiresChatOption = (question, options, strict = false) => strict ||
  (options.length === 2 && options.every(option => /^(?:да|нет|yes|no)[.!\s]*$/iu.test(option))) || options.length > 0 &&
  /\b(?:select|choose|pick)\b|выбер(?:и|ите)|один\s+из\s+вариант/iu.test(question) ||
  /\b(?:select|choose|pick)\s+(?:one|an?\s+option|from)\b|выбер(?:и|ите)\s+(?:один|одну|вариант|из)/iu.test(question);

/**
 * Auto-send only an exact saved option, or a unique salary range. Contradictory net/gross
 * questions require both configured sums to fit the same range. Overlaps, gaps, unknown
 * currencies and missing baselines are left for review.
 */
export function chooseChatOption({ question, reply, options, contacts = {}, history = {} }) {
  const exact = reply?.answer && perfectOption(reply.answer, options);
  const asked = salaryQuestion(question);
  if (exact && !asked && reply.perfect) return { option: exact, autoSend: true, reason: 'saved answer' };
  if (!asked) {
    // A bot's accepted summary is stronger evidence than a rejected free-text attempt kept in
    // the raw history. Only the very same question and a unique offered answer qualify.
    const accepted = Object.values(history).flatMap(chat => (chat.messages ?? []).filter(message => !message.mine)
      .flatMap(message => summaryPairs(message.text))).filter(([q]) => normalizeQuestion(q) === normalizeQuestion(question)).map(([, answer]) => answer);
    const matches = options.filter(option => accepted.some(answer => perfectOption(answer, [option])));
    if (matches.length === 1) return { option: matches[0], autoSend: true, reason: 'accepted answer in bot summary' };
  }
  if (exact && !asked) return { option: exact, autoSend: false, reason: 'saved answer' };
  if (!asked || !options.length) return null;
  const selection = selectSalaryOption({ question, options, contacts });
  if (!selection) return null;
  const { values, currency: wantedCurrency, shapes } = selection;
  // A different exact saved amount is an explicit answer, not permission to replace it with
  // the default baseline. It needs review unless it selects an option word for word above.
  if (reply?.perfect && !exact) {
    const savedAmounts = salaryAmounts(reply.answer);
    if (savedAmounts.length && !savedAmounts.some((value) => values.includes(value))) return null;
  }
  return { option: selection.option, autoSend: true, reason: `salary range (${shapes.map((shape, i) => `${shape} ${values[i]} ${wantedCurrency}`).join(', ')})` };
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
