/**
 * Answers in hh.ru chats: questions of employers and recruiter bots, and template messages that
 * many companies send the same way («Рассмотрим ваше резюме… мы свяжемся с вами»). The answer is
 * typed into the message field for the user to check and send; nothing is sent here.
 *
 * - A question takes the saved answer of a similar question in qa.lino (same matching as forms)
 * - A template message takes the saved reply in data/chat-templates.lino, matched without the
 *   greeting with the user's name and the sender's signature, which differ between companies
 * - Anything else is drafted by local Claude Code from the resume and saved answers
 * - Answers the user has sent in chats are learned: question → qa.lino, template → chat-templates
 * - Template messages answered the same way are generalized into patterns («pattern: ваше резюме …
 *   свяж* с вами»): the words they share in order, `…` for what differs, `*` for a word's ending
 *
 * @module chat-answers
 */

import { findBestMatch, normalizeQuestion, stringSimilarity } from './qa-database.mjs';
import { answerText } from './qa.mjs';

/** A template message is the same text in other words; its saved reply needs a close match */
export const TEMPLATE_THRESHOLD = 0.6;

/** Chat questions often ask two things at once; a saved answer to one of them needs a close match */
export const CHAT_QUESTION_THRESHOLD = 0.7;

/** Title of the first message of a chat: the user's own application with its cover letter */
const APPLICATION_TITLE = 'Отклик на вакансию';

/**
 * Runs in the page: the messages of the open chat, oldest first. The user's own messages carry a
 * delivery status icon; the others are the employer's or a bot's
 * @returns {{vacancy: string, messages: Array<{id: string, mine: boolean, title: string, text: string}>}}
 */
export function readChat() {
  const clean = (text) => String(text ?? '').replace(/\n{3,}/g, '\n\n').trim();
  const messages = [...document.querySelectorAll('[data-qa^="chatik-chat-message-"]')]
    .filter((element) => /^chatik-chat-message-\d+$/.test(element.getAttribute('data-qa')))
    .map((element) => {
      const bubble = element.querySelector('[data-qa="chat-bubble-wrapper"]');
      const left = element.getBoundingClientRect().left;
      const mine = Boolean(element.querySelector('[data-qa^="status-icon"]')) ||
        (bubble ? bubble.getBoundingClientRect().left - left > 40 : false);
      return {
        id: element.getAttribute('data-qa').replace('chatik-chat-message-', ''),
        mine,
        title: clean(element.querySelector('[data-qa="chat-bubble-title"]')?.innerText),
        text: clean(element.querySelector('[data-qa="chat-bubble-text"]')?.innerText),
        // hh.ru marks a rejection with an «Отказ» line in the bubble
        rejection: !mine && /^\s*Отказ\s*$/m.test(element.innerText),
      };
    })
    .filter((message) => message.text);
  return {
    // «Вакансия / <name> / Перейти»: the middle line
    vacancy: clean(document.querySelector('[data-qa="chatik-header-sub-header"]')?.innerText)
      .split('\n').map((line) => line.trim()).filter((line) => line && !/^(вакансия|перейти)$/i.test(line))[0] ?? '',
    company: clean(document.querySelector('[data-qa="participant-info-title"]')?.innerText),
    messages,
    // After a rejection hh.ru may close the chat: «Переписка будет доступна после приглашения работодателя»
    canReply: Boolean(document.querySelector('textarea[data-qa="text-input"]')),
  };
}

/**
 * Runs in the page: the chats of the list, with whether the last message is the user's own
 * @returns {Array<{id: string, title: string, subtitle: string, lastIsMine: boolean, unread: boolean}>}
 */
export function readChatList() {
  return [...document.querySelectorAll('[data-qa^="chatik-open-chat-"]')].map((cell) => ({
    id: cell.getAttribute('data-qa').replace('chatik-open-chat-', ''),
    title: cell.querySelector('[data-qa="chat-cell-title"]')?.innerText.trim() ?? '',
    subtitle: cell.querySelector('[data-qa="chat-cell-subtitle"]')?.innerText.trim() ?? '',
    lastIsMine: Boolean(cell.querySelector('[data-qa^="status-icon"]')),
    unread: Boolean(cell.querySelector('[data-qa*="badge"], [data-qa*="counter"]')),
  }));
}

/**
 * The messages after the user's last own message: what is waiting for an answer
 * @param {Array<{mine: boolean}>} messages
 * @returns {Array<Object>}
 */
export function pendingMessages(messages) {
  const lastMine = messages.map((message) => message.mine).lastIndexOf(true);
  return messages.slice(lastMine + 1).filter((message) => !message.mine);
}

/**
 * A template message without what differs between companies: the greeting line with the
 * user's name, and a signature (a name line, or the sender's name from the bubble title)
 * @param {string} text
 * @param {Object} [options]
 * @param {string} [options.sender] - Bubble title (the sender's name)
 * @returns {string}
 */
export function templateCore(text, { sender = '' } = {}) {
  const lines = String(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const isGreeting = (line) => /здравствуй|добрый (день|вечер)|привет|приветству/i.test(line) && line.length < 80;
  const isSignature = (line) => /^[А-ЯЁA-Z][а-яёa-z-]+( [А-ЯЁA-Z][а-яёa-z.-]+){1,2}$/.test(line) ||
    (sender && line.includes(sender)) || /^с уважением|^best regards/i.test(line);
  while (lines.length > 1 && isGreeting(lines[0])) {
    lines.shift();
  }
  while (lines.length > 1 && isSignature(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join('\n');
}

/** Key of the reply to a rejection in data/chat-templates.lino (asking for the reason) */
export const REJECTION_KEY = 'Отказ';

/**
 * Whether a message is a rejection: hh.ru's «Отказ» mark, or the usual wording
 * @param {{rejection?: boolean, text: string}} message
 * @returns {boolean}
 */
export function isRejection(message) {
  return Boolean(message.rejection) ||
    /не готовы пригласить|не можем пригласить|приняли решение (не продолжать|отказать)|выбрали другого кандидата|к сожалению,? (мы )?(не готовы|вынуждены отказать|не можем)/i.test(message.text);
}

const isQuestion = (text) => /\?\s*$/.test(text.trim()) || /\?\s/.test(text);

/**
 * The reply to a waiting message, when it is known
 * @param {Object} message - {title, text}
 * @param {Object} sources
 * @param {Map} sources.templates - data/chat-templates.lino: template message -> reply
 * @param {Map} sources.qaMap - data/qa.lino with contacts filled in
 * @returns {{answer: string, source: string, matched: string}|null}
 */
export function knownReply(message, { templates, qaMap }) {
  // A rejection gets the saved question about its reason, whatever its wording
  if (isRejection(message) && templates.has(REJECTION_KEY)) {
    return { answer: answerText(templates.get(REJECTION_KEY)), source: 'rejection: asking for the reason', matched: REJECTION_KEY };
  }
  const core = templateCore(message.text, { sender: message.title });
  const examples = new Map([...templates].filter(([key]) => !isPattern(key)));
  // A template inside a longer message (a company adds a paragraph of its own) is still that template
  const flat = normalizeQuestion(core);
  const contained = [...examples.keys()].find((key) => key !== REJECTION_KEY && normalizeQuestion(key).length > 20 &&
    flat.includes(normalizeQuestion(key)));
  // A learned pattern matches other wordings of the same template; a question is not a template
  const pattern = !contained && !isQuestion(core) && [...templates.keys()].find((key) => isPattern(key) && matchesPattern(key, core));
  const template = contained || pattern
    ? { question: contained || pattern, answer: templates.get(contained || pattern), score: 1 }
    : findBestMatch(core, examples, { threshold: TEMPLATE_THRESHOLD });
  if (template) {
    return { answer: answerText(template.answer), source: `chat-templates.lino ${template.score.toFixed(2)}`, matched: template.question };
  }
  if (isQuestion(core)) {
    const saved = findBestMatch(core, qaMap, { threshold: CHAT_QUESTION_THRESHOLD });
    if (saved) {
      return { answer: answerText(saved.answer), source: `qa.lino ${saved.score.toFixed(2)}`, matched: saved.question };
    }
  }
  return null;
}

/** Prefix of a learned pattern in data/chat-templates.lino */
export const PATTERN_PREFIX = 'pattern: ';
const GAP = '…';

/** @param {string} key @returns {boolean} */
export const isPattern = (key) => key.startsWith(PATTERN_PREFIX);

/** Words of a message for patterns: lowercase, without punctuation, ё as е */
const patternWords = (text) => normalizeQuestion(String(text).replace(/[«»"()—–]/g, ' ')).replace(/ё/g, 'е').split(' ').filter(Boolean);

/** Words that carry meaning: prepositions and conjunctions do not count when patterns are compared */
const meaningful = (tokens) => tokens.filter((token) => token !== GAP && token.replace(/\*$/, '').length >= 3).length;

/**
 * The same word in another form («свяжемся», «свяжется» → «свяж*»), or null
 * @param {string} a - A word, or a stem ending with *
 * @param {string} b
 * @returns {string|null}
 */
function sameWord(a, b) {
  if (a === GAP || b === GAP) {
    return null;
  }
  if (a === b) {
    return a;
  }
  const [bareA, bareB] = [a.replace(/\*$/, ''), b.replace(/\*$/, '')];
  let common = 0;
  while (common < Math.min(bareA.length, bareB.length) && bareA[common] === bareB[common]) {
    common++;
  }
  // A stem keeps at least 4 letters and loses at most an ending of 3
  return common >= 4 && common >= Math.min(bareA.length, bareB.length) - 3 ? `${bareA.slice(0, common)}*` : null;
}

/**
 * Two templates (or a pattern and a template) as one pattern: the words they share in order, with
 * a gap (…) where either has words of its own
 * @param {string[]} a - Tokens
 * @param {string[]} b
 * @returns {string[]}
 */
function mergeTokens(a, b) {
  const lengths = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = sameWord(a[i], b[j]) ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const merged = [];
  let [i, j, last] = [0, 0, null];
  while (i < a.length && j < b.length) {
    const word = sameWord(a[i], b[j]);
    if (word && lengths[i][j] === lengths[i + 1][j + 1] + 1) {
      if (last && (i > last[0] + 1 || j > last[1] + 1)) {
        merged.push(GAP);
      }
      merged.push(word);
      last = [i, j];
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  // A short word alone between gaps («… и …») only makes the pattern miss other wordings
  return merged
    .filter((token, index) => token === GAP || meaningful([token]) > 0 ||
      (merged[index - 1] && merged[index - 1] !== GAP) || (merged[index + 1] && merged[index + 1] !== GAP))
    .filter((token, index, kept) => !(token === GAP && (index === 0 || kept[index - 1] === GAP)));
}

/**
 * Whether a message is another wording of a pattern: its words in order, anything in the gaps,
 * any ending after a stem
 * @param {string} pattern - With or without the «pattern: » prefix
 * @param {string} text
 * @returns {boolean}
 */
export function matchesPattern(pattern, text) {
  const tokens = pattern.replace(PATTERN_PREFIX, '').split(' ').filter(Boolean);
  const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let source = '(?:^| )';
  tokens.forEach((token, index) => {
    if (token === GAP) {
      source += '(?:\\S+ )*?';
      return;
    }
    source += token.endsWith('*') ? `${escape(token.slice(0, -1))}\\S*` : escape(token);
    if (index < tokens.length - 1) {
      source += ' ';
    }
  });
  return new RegExp(`${source}(?: |$)`, 'u').test(patternWords(text).join(' '));
}

/** Replies that say the same: equal, or nearly so («Благодарю, ожидаю» and «Благодарю, ожидаю!») */
const sameReply = (a, b) => stringSimilarity(normalizeQuestion(answerText(a)), normalizeQuestion(answerText(b))) >= 0.85;

/**
 * Patterns learned from template messages the user answered the same way: the messages of a reply
 * are merged while their shared words still make a pattern of at least `minWords` meaningful words
 * and at least `minShare` of the shorter message, so different templates stay apart
 * @param {Map<string, string>} templates - data/chat-templates.lino: template message -> reply
 * @param {Object} [options]
 * @param {number} [options.minWords=5]
 * @param {number} [options.minShare=0.4]
 * @returns {Map<string, string>} «pattern: …» -> reply
 */
export function learnPatterns(templates, { minWords = 5, minShare = 0.4 } = {}) {
  const groups = [];
  for (const [message, reply] of templates) {
    if (message === REJECTION_KEY || isPattern(message)) {
      continue;
    }
    const group = groups.find((candidate) => sameReply(candidate.reply, reply));
    const example = { tokens: patternWords(message), size: meaningful(patternWords(message)), members: 1 };
    group ? group.clusters.push(example) : groups.push({ reply, clusters: [example] });
  }
  const patterns = new Map();
  for (const { reply, clusters } of groups) {
    for (;;) {
      let best = null;
      clusters.forEach((a, i) => clusters.slice(i + 1).forEach((b, offset) => {
        const tokens = mergeTokens(a.tokens, b.tokens);
        const words = meaningful(tokens);
        if (words >= minWords && words >= minShare * Math.min(a.size, b.size) && (!best || words > best.words)) {
          best = { i, j: i + 1 + offset, tokens, words };
        }
      }));
      if (!best) {
        break;
      }
      const [a, b] = [clusters[best.i], clusters[best.j]];
      clusters.splice(best.j, 1);
      clusters[best.i] = { tokens: best.tokens, size: Math.min(a.size, b.size), members: a.members + b.members };
    }
    clusters.filter((cluster) => cluster.members > 1)
      .forEach((cluster) => patterns.set(`${PATTERN_PREFIX}${cluster.tokens.join(' ')}`, reply));
  }
  return patterns;
}

/**
 * Templates with their patterns learned anew: the examples as they are, then the patterns (old
 * patterns are replaced, as each new example can widen or split them)
 * @param {Map<string, string>} templates
 * @returns {Map<string, string>}
 */
export function withLearnedPatterns(templates) {
  const examples = [...templates].filter(([key]) => !isPattern(key));
  return new Map([...examples, ...learnPatterns(new Map(examples))]);
}

/**
 * Pairs the user has answered in a chat, to learn: an employer's message followed by the user's
 * reply. Questions go to qa.lino, other messages are templates. The application itself and
 * replies that are questions back («Можно без опыта?») are not answers
 * @param {Array<{mine: boolean, title: string, text: string}>} messages
 * @returns {{questions: Array<[string, string]>, templates: Array<[string, string]>}}
 */
export function learnedPairs(messages) {
  const questions = [];
  const templates = [];
  messages.forEach((message, index) => {
    if (!message.mine || message.title === APPLICATION_TITLE || isQuestion(message.text)) {
      return;
    }
    const asked = messages[index - 1];
    if (!asked || asked.mine) {
      return;
    }
    const core = templateCore(asked.text, { sender: asked.title });
    (isQuestion(core) ? questions : templates).push([core, message.text]);
  });
  return { questions, templates };
}

/** Links of questionnaires employers send in chats */
const FORM_LINK = /https?:\/\/(?:forms\.gle|docs\.google\.com\/forms|forms\.yandex\.ru|forms\.office\.com|[\w.-]*typeform\.com|rating\.hh\.ru)\/[^\s)»"]+/gi;

/**
 * Questionnaire links in messages
 * @param {Array<{text: string}>} messages
 * @returns {string[]}
 */
export function formLinks(messages) {
  // A link at the end of a sentence does not take the full stop
  return [...new Set(messages.flatMap((message) => message.text.match(FORM_LINK) ?? []).map((link) => link.replace(/[.,;:!?]+$/, '')))];
}

/**
 * The prompt for a drafted chat reply: only facts from the resume and saved answers
 * @returns {string}
 */
export function chatDraftPrompt({ vacancy, messages, resume, related }) {
  const recent = messages.slice(-8)
    .map((message) => `${message.mine ? 'Я' : (message.title || 'Работодатель')}: ${message.text}`)
    .join('\n\n');
  return `Я кандидат и переписываюсь с работодателем в чате hh.ru${vacancy ? ` по вакансии «${vacancy}»` : ''}.
Напиши мой ответ на последнее сообщение работодателя: коротко, вежливо, по делу, от первого лица, на русском.
Используй ТОЛЬКО факты из моего резюме и моих прошлых ответов ниже. Ничего не выдумывай: где нужного факта нет,
поставь пометку «[уточнить: что именно]», я заполню сам. Если работодатель прислал ссылку на анкету, ответь, что заполню её.
Выведи только текст ответа.

=== Переписка (последние сообщения) ===
${recent}

=== Моё резюме ===
${resume}

=== Мои прошлые ответы на похожие вопросы ===
${related || '(нет)'}
`;
}
