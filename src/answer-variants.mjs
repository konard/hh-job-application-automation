/** Equivalent saved replies share a candidate; the original chat messages stay unchanged. */
import fs from 'node:fs';
import path from 'node:path';
import { preferredAnswer } from './answer-preferences.mjs';

export const ANSWER_SEPARATOR = ' | ';
const localStyles = new Map();

/** CLI settings are inherited by child workers; standalone tools also read the local .lenv. */
export function getAnswerFinalPeriod({ env = process.env, file = '.lenv' } = {}) {
  const resolved = path.resolve(file);
  if (env.ANSWER_FINAL_PERIOD === undefined && !localStyles.has(resolved)) {
    let text = '';
    try { text = fs.readFileSync(resolved, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const value = text.match(/^ANSWER_FINAL_PERIOD:[ \t]*([^\r\n]+)/m)?.[1].trim().replace(/^(['"`])(.*)\1$/, '$2');
    localStyles.set(resolved, value ?? 'with');
  }
  const style = env.ANSWER_FINAL_PERIOD ?? localStyles.get(resolved);
  if (!['with', 'without'].includes(style)) throw new Error('ANSWER_FINAL_PERIOD must be "with" or "without"');
  return style;
}

/** Merge identical replies and optional final periods, then rank by combined usage. */
export function mergeAnswerFrequencies(entries, { finalPeriod = getAnswerFinalPeriod(), question, preferredAnswers } = {}) {
  if (!['with', 'without'].includes(finalPeriod)) throw new Error('answer final period must be "with" or "without"');
  entries = entries.map((entry) => ({ ...entry, answer: preferredAnswer(question, entry.answer, preferredAnswers) }));
  const texts = new Set(entries.map(({ answer }) => answer.trim()));
  const conflicting = new Set([...texts].filter((text) => /[^.!?…]\.$/u.test(text) && texts.has(text.slice(0, -1)))
    .map((text) => text.slice(0, -1)));
  const counts = new Map();
  for (const { answer, count } of entries) {
    const text = answer.trim();
    const base = conflicting.has(text) ? text : conflicting.has(text.slice(0, -1)) && text.endsWith('.') ? text.slice(0, -1) : null;
    const preferred = base === null ? text : finalPeriod === 'with' ? `${base}.` : base;
    counts.set(preferred, (counts.get(preferred) ?? 0) + count);
  }
  return [...counts].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count);
}

/** Only alternatives are normalized: an individual answer and checkbox arrays keep their text. */
export function normalizeAnswerVariants(answer, options) {
  if (typeof answer !== 'string') return answer;
  if (!answer.includes(ANSWER_SEPARATOR)) return preferredAnswer(options?.question, answer, options?.preferredAnswers);
  return mergeAnswerFrequencies(answer.split(ANSWER_SEPARATOR).map((text) => ({ answer: text, count: 0 })), options)
    .map(({ answer: text }) => text).join(ANSWER_SEPARATOR);
}

/** Resolve an actual conflict with a previously saved answer; first saves stay as entered. */
export function resolveAnswerConflict(saved, incoming, options) {
  const answer = normalizeAnswerVariants(incoming, options);
  if (typeof saved !== 'string' || typeof incoming !== 'string' || saved === incoming) return answer;
  const candidates = mergeAnswerFrequencies([saved, incoming].map((text) => ({ answer: text, count: 0 })), options);
  return candidates.length === 1 ? candidates[0].answer : answer;
}
