/** Equivalent saved replies share a candidate; the original chat messages stay unchanged. */
export const ANSWER_SEPARATOR = ' | ';

/** Merge identical replies and optional final periods, then rank by combined usage. */
export function mergeAnswerFrequencies(entries) {
  const texts = new Set(entries.map(({ answer }) => answer.trim()));
  const dotted = new Set([...texts].filter((text) => /[^.!?…]\.$/u.test(text))
    .map((text) => text.slice(0, -1)));
  const counts = new Map();
  for (const { answer, count } of entries) {
    const text = answer.trim();
    const preferred = dotted.has(text) ? `${text}.` : text;
    counts.set(preferred, (counts.get(preferred) ?? 0) + count);
  }
  return [...counts].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count);
}

/** Only alternatives are normalized: an individual answer and checkbox arrays keep their text. */
export function normalizeAnswerVariants(answer) {
  if (typeof answer !== 'string' || !answer.includes(ANSWER_SEPARATOR)) return answer;
  return mergeAnswerFrequencies(answer.split(ANSWER_SEPARATOR).map((text) => ({ answer: text, count: 0 })))
    .map(({ answer: text }) => text).join(ANSWER_SEPARATOR);
}
