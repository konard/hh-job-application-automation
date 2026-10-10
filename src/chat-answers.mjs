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
 *
 * @module chat-answers
 */

import { findBestMatch, normalizeQuestion } from './qa-database.mjs';
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
  // A template inside a longer message (a company adds a paragraph of its own) is still that template
  const flat = normalizeQuestion(core);
  const contained = [...templates.keys()].find((key) => key !== REJECTION_KEY && normalizeQuestion(key).length > 20 &&
    flat.includes(normalizeQuestion(key)));
  const template = contained
    ? { question: contained, answer: templates.get(contained), score: 1 }
    : findBestMatch(core, templates, { threshold: TEMPLATE_THRESHOLD });
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
