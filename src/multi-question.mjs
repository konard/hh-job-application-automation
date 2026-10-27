/** Shared, conservative parsing of questionnaires. Original messages are always retained. */
import { ANSWER_SEPARATOR } from './answer-variants.mjs';

const instruction = /^(?:отвечайте|ответы учитываются|если текст будет|пожалуйста,?\s+отнеситесь|answer (?:each|in detail))(?=\s|$|[.,])/iu;
const contactRequest = /(?:укажите|напишите|provide|share).*(?:telegram|телеграм|e-?mail|почт|способ связи|contact)/iu;
const asking = /\?|^(?:расскажите|опишите|укажите|поделитесь|describe|explain|provide|tell us)(?=\s|$|:)/iu;
const followup = /^(?:если\s+(?:да|нет)|if\s+(?:so|yes|not)|почему|why\b|(?:поделитесь|приведите)\s+пример|расскажите\s+подробнее|give\s+(?:an?\s+)?examples?|explain\s+in\s+detail)/iu;
const key = (text) => text.toLowerCase().replace(/\s+/gu, ' ').trim();

/** Numbered sections outside fenced code. Nested lists and nonsequential numbers are ambiguous. */
function numbered(text) {
  const lines = String(text).split('\n');
  const found = [];
  let fence = null;
  let offset = 0;
  for (const line of lines) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (delimiter) fence = fence ? (delimiter[0] === fence ? null : fence) : delimiter[0];
    const match = !fence && line.match(/^ {0,3}(\d{1,2})[.)]\s+(.+)$/u);
    if (match) found.push({ number: Number(match[1]), start: offset, content: offset + match[0].length - match[2].length });
    offset += line.length + 1;
  }
  if (found.length < 2 || found.some((item, index) => item.number !== index + 1)) return [];
  return found.map((item, index) => ({
    number: item.number,
    text: String(text).slice(item.content, found[index + 1]?.start).trim(),
  }));
}

/** One item includes its conditional follow-ups. Instructions are not additional questions. */
export function splitQuestions(text) {
  if (typeof text !== 'string') return [];
  const sections = numbered(text);
  if (sections.length) {
    const last = sections.at(-1);
    const paragraphs = last.text.split(/\n\s*\n/u);
    const tail = [];
    const kept = [];
    let instructions = false;
    for (const paragraph of paragraphs) {
      if (instruction.test(paragraph.trim()) || (kept.length > 0 && contactRequest.test(paragraph.trim()))) instructions = true;
      (instructions ? tail : kept).push(paragraph);
    }
    last.text = kept.join('\n\n').trim();
    for (const paragraph of tail) {
      if (contactRequest.test(paragraph.trim())) sections.push({ number: sections.length + 1, text: paragraph.trim() });
    }
    return sections.every((part) => asking.test(part.text) || contactRequest.test(part.text)) ? sections : [];
  }
  // Bullet/paragraph questions and independent questions on one line. Never split code snippets.
  if (/^\s*(?:```|~~~)/mu.test(text)) return [];
  const candidates = text.split(/\n+|(?<=\?)\s+(?=[\p{Lu}])/u)
    .map((part) => part.trim().replace(/^[-•–]\s+/u, '')).filter(Boolean);
  const parts = [];
  for (const candidate of candidates) {
    if (followup.test(candidate) && parts.length) parts.at(-1).text += ` ${candidate}`;
    else if (asking.test(candidate) || contactRequest.test(candidate)) parts.push({ number: parts.length + 1, text: candidate });
    else if (parts.length) return []; // Unclear boundaries: retain only the complete block.
  }
  return parts.length >= 2 ? parts : [];
}

/** Only explicit numbered answers (or repeated question headings) establish a reliable mapping. */
export function separateQuestionAnswers(question, answer) {
  if (typeof answer !== 'string') return [];
  const questions = splitQuestions(question);
  if (questions.length < 2) return [];
  const answers = numbered(answer);
  if (answers.length !== questions.length) return [];
  return questions.map((part, index) => {
    let value = answers[index].text;
    // A user can repeat the question as the heading of the numbered answer.
    if (key(value.split('\n')[0]) === key(part.text)) value = value.includes('\n') ? value.slice(value.indexOf('\n') + 1).trim() : '';
    return value ? [part.text, value] : null;
  }).filter(Boolean);
}

/** Add derived records without losing the full block, standalone wording, or earlier variants. */
export function expandQuestionAnswers(entries) {
  const expanded = new Map(entries);
  for (const [question, answer] of entries) {
    if (typeof answer !== 'string') continue;
    for (const variant of answer.split(ANSWER_SEPARATOR)) {
      for (const [part, value] of separateQuestionAnswers(question, variant)) {
        const saved = expanded.get(part);
        if (Array.isArray(saved)) continue;
        expanded.set(part, [...new Set([...(saved ? saved.split(ANSWER_SEPARATOR) : []), value])].join(ANSWER_SEPARATOR));
      }
    }
  }
  return expanded;
}

/** A complete draft from individual answers; partial or ambiguous blocks are left for review. */
export function composeQuestionAnswer(question, lookup) {
  const parts = splitQuestions(question);
  if (parts.length < 2) return null;
  const matches = parts.map((part) => lookup(part.text));
  if (matches.some((match) => !match || typeof match.answer !== 'string' || !match.answer.trim())) return null;
  return {
    question,
    answer: parts.map((part, index) => `${part.number}. ${matches[index].answer}`).join('\n\n'),
    score: Math.min(...matches.map((match) => match.score)),
    composed: true,
    parts: matches,
  };
}
