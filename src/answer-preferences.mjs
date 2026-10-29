/** Explicitly approved answer replacements. Historical messages remain literal. */
import fs from 'node:fs';
import path from 'node:path';
import { Parser } from 'links-notation';

const cache = new Map();
const key = (text) => String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const textOf = (link) => link?.id ?? link?.values?.map(textOf).join(' ') ?? '';

/** Scope availability wording to joining/start-date questions, never project duration. */
export function isAvailabilityQuestion(question) {
  return /когда|как скоро|как быстро|срок|(?:сколько|какое).{0,30}врем|через|в течени[еи]|сразу|немедленно/iu.test(question) &&
    /(?:выйти.{0,40}(?:работ|мест)|приступ\p{L}*\s+(?:к\s+)?(?:работ|проект)|присоедин\p{L}*\s+(?:к\s+)?(?:команд|нам)|срок\p{L}*\s+выход|выход\p{L}*\s+на\s+(?:нов\p{L}*\s+)?(?:работ|мест|роль)|начать\s+работ|когда.{0,30}готов\p{L}*.{0,20}выйти)/iu.test(question);
}

/** canonical answer -> indented approved equivalent answers, in Links Notation. */
export function readAnswerPreferences(file = path.join(process.cwd(), 'data/answer-preferences.lino')) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
  const saved = cache.get(file);
  if (saved?.content === content) return saved.aliases;
  const aliases = new Map();
  for (const link of new Parser().parse(content)) {
    if (!link._isFromPathCombination || link.values?.length !== 2) continue;
    const canonical = textOf(link.values[0]);
    const alternative = textOf(link.values[1]);
    if (canonical && alternative) aliases.set(key(alternative), canonical);
  }
  cache.set(file, { content, aliases });
  return aliases;
}

export function preferredAnswer(question, answer, aliases) {
  if (!isAvailabilityQuestion(question ?? '')) return answer;
  return (aliases ?? readAnswerPreferences()).get(key(answer)) ?? answer;
}

/** A timing question cannot reuse an accidentally sent performance-metrics reply. */
export function fitsAvailabilityQuestion(question, answer) {
  if (!isAvailabilityQuestion(question ?? '')) return true;
  if (/^(?:да|нет|yes|no)[.!]?$/iu.test(answer.trim()) && !/когда|как скоро|как быстро|срок/iu.test(question)) return true;
  return /\d|недел|месяц|день|дня|дней|дате?|завтра|сегодня|немедленно|сразу|оф[ф]?ер|готов|после|через|обсуд|соглас|как только/iu.test(answer);
}
