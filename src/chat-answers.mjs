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

import { PATTERN_GAP as GAP, PATTERN_PREFIX, findBestMatch, isPattern, matchesPattern, normalizeQuestion, patternWords, stringSimilarity } from './qa-database.mjs';
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
      const bubble = element.querySelector('[data-qa="chat-bubble-wrapper"]')?.getBoundingClientRect();
      const row = element.getBoundingClientRect();
      // The user's own bubble is on the right; hh.ru's notices in the middle are not the user's. The
      // employer's bubbles have an icon too (chat-bubble-icon-hidden, an eye), so icons decide only
      // when the page is not laid out
      const mine = bubble?.width > 0
        ? bubble.left - row.left > 40 && row.right - bubble.right < 40
        : Boolean(element.querySelector('[data-qa^="status-icon"], [data-qa^="chat-bubble-icon"]:not([data-qa="chat-bubble-icon-hidden"]), [class*="message_my"], [class*="chat-bubble_outgoing"]'));
      return {
        id: element.getAttribute('data-qa').replace('chatik-chat-message-', ''),
        mine,
        // The sender: «Отклик на вакансию», a person's name or «Робот-рекрутер»
        title: clean(element.querySelector('[data-qa="chat-bubble-title"], [data-qa="chat-bubble-author-name"]')?.innerText),
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
    // «Перейти» leads to the vacancy
    vacancyUrl: document.querySelector('[data-qa="chatik-header-sub-header"] a[href*="/vacancy/"], a[href*="hh.ru/vacancy/"]')?.href.split('?')[0] ?? '',
    messages,
    // After a rejection hh.ru may close the chat: «Переписка будет доступна после приглашения работодателя»
    canReply: Boolean(document.querySelector('textarea[data-qa="text-input"]')),
  };
}

/**
 * Runs in the page: where the chat list is scrolled (and on screen), or scrolled to a position. The
 * list is virtual: only the chats on screen are in the page, the others are put in as it is scrolled
 * @param {number|null} top - Pixels from the list's top; null leaves it where it is
 * @returns {{top: number, height: number, view: number, x: number, y: number, width: number}|null}
 *   Where it is now, null without a list
 */
export function scrollChatList(top) {
  const cell = document.querySelector('[data-qa^="chatik-open-chat-"]');
  let box = cell?.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 10 && /auto|scroll/.test(window.getComputedStyle(box).overflowY))) {
    box = box.parentElement;
  }
  if (!box) {
    return null;
  }
  if (top !== null) {
    box.scrollTop = top;
  }
  const rect = box.getBoundingClientRect();
  return { top: box.scrollTop, height: box.scrollHeight, view: box.clientHeight, x: rect.x, y: rect.y, width: rect.width };
}

/**
 * Runs in the page: the chats of the list, with whether the last message is the user's own
 * @returns {Array<{id: string, title: string, subtitle: string, lastIsMine: boolean, unread: boolean}>}
 */
export function readChatList() {
  return [...document.querySelectorAll('[data-qa^="chatik-open-chat-"]')].map((cell, index) => {
    // A row of the virtual list is placed by its offset («translateY(2560px)»): its place in the list
    const row = cell.closest('[class*="virtualized-row"]');
    const offset = /translateY\((\d+)/.exec(row?.style.transform ?? '');
    const subtitle = cell.querySelector('[data-qa="chat-cell-subtitle"]')?.innerText.trim() ?? '';
    // The line under the company: the last message, or the status («Отказ», «Собеседование»)
    const lines = cell.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
    const last = lines[lines.indexOf(subtitle) + 1] ?? '';
    return {
      id: cell.getAttribute('data-qa').replace('chatik-open-chat-', ''),
      title: cell.querySelector('[data-qa="chat-cell-title"]')?.innerText.trim() ?? '',
      subtitle,
      last: /^\d+$/.test(last) ? '' : last,
      lastIsMine: Boolean(cell.querySelector('[data-qa^="status-icon"]')),
      unread: Boolean(cell.querySelector('[data-qa*="badge"], [data-qa*="counter"]')),
      top: offset ? Number(offset[1]) : index,
      height: row?.offsetHeight || cell.offsetHeight,
    };
  });
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
 * Whether a chat no longer waits for the user: their own message is the last one, or it is closed
 * @param {{messages: Array<{mine: boolean}>, canReply: boolean}} chat - From readChat
 * @returns {boolean}
 */
export const isChatAnswered = (chat) => !chat.canReply || pendingMessages(chat.messages).length === 0;

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

/** The reply of a template that needs none (a bot's «Ваши ответы отправлены работодателю») */
export const NO_REPLY = '[без ответа]';

/** hh.ru's AI assistant's summary: «В разговоре с кандидатом я узнал:» */
const ASSISTANT_SUMMARY = /^в разговоре с кандидатом (я )?узнал/i;

/**
 * The questions and answers of a recruiter bot's summary: each line «Вопрос?: Ответ», or the AI
 * assistant's «- Вопрос? Ответ:» with the answer on the next line «- Да.»
 * @param {string} text
 * @returns {Array<[string, string]>} Empty when the message is not such a summary
 */
export function summaryPairs(text) {
  const lines = String(text).split('\n').map((line) => line.trim()).filter(Boolean);
  if (ASSISTANT_SUMMARY.test(lines[0] ?? '')) {
    return lines.flatMap((line, index) => {
      const [, question, answer] = line.match(/^[-–•]?\s*(.+\?)\s*Ответ:\s*(.*)$/i) ?? [];
      const given = (answer || (lines[index + 1] ?? '').match(/^[-–•]\s*(.+)$/)?.[1] || '').trim();
      return question && given ? [[question.trim(), given]] : [];
    });
  }
  const pairs = lines.map((line) => line.match(/^(.+\?)\s*:\s+(.+)$/)).filter(Boolean).map(([, question, answer]) => [question.trim(), answer.trim()]);
  return pairs.length > 0 && pairs.length === lines.length ? pairs : [];
}

/** Whether a message is a bot's summary of the answers given: not a question to the user */
export const isSummary = (text) => ASSISTANT_SUMMARY.test(String(text).trim()) || summaryPairs(text).length > 0;

const ACKNOWLEDGEMENT = /^(понял[аи]?|поняла|ясно|хорошо|отлично|супер|здорово|спасибо|благодарю|принято|ok|ок)(?!\p{L})[^.!?]*[.!]\s+/iu;
const LEAD_IN = /^(?:хорошо|отлично|понял[аи]?|поняла|ясно|спасибо|ок|ok)(?:\s*[,!.]\s*(?:а\s+)?|\s+а\s+)|^а\s+(?=\p{L})/iu;
// «Расскажите, пожалуйста,» before the question itself («был ли…», «в каких проектах…»)
const POLITE = /^(?:скажите|подскажите|расскажите|уточните)\s*,?\s*(?:пожалуйста\s*,?\s*)?(?=\p{L}+\s+ли(?!\p{L})|(?:в\s+)?(?:как|сколько|где|когда|почему|зачем|что|чем|кто))/iu;

/**
 * A bot's question without its acknowledgement of the last answer: «Понял, спасибо за подробности.
 * А есть ли у вас опыт работы с NestJS?» is «Есть ли у вас опыт работы с NestJS?», «Расскажите,
 * пожалуйста, был ли…» is «Был ли…»
 * @param {string} text
 * @returns {string}
 */
export function questionCore(text) {
  let core = String(text).trim();
  for (let previous = ''; previous !== core;) {
    previous = core;
    core = core.replace(ACKNOWLEDGEMENT, '').replace(LEAD_IN, '').replace(POLITE, '').trim();
  }
  return core && core !== String(text).trim() ? core[0].toUpperCase() + core.slice(1) : String(text).trim();
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

/** The same text, apart from case, spacing and punctuation */
const sameText = (a, b) => !isPattern(b) && normalizeQuestion(a) === normalizeQuestion(b);

export const isQuestion = (text) => /\?\s*$/.test(text.trim()) || /\?\s/.test(text);

/**
 * The reply to a waiting message, when it is known
 * @param {Object} message - {title, text}
 * @param {Object} sources
 * @param {Map} sources.templates - data/chat-templates.lino: template message -> reply
 * @param {Map} sources.qaMap - data/qa.lino with contacts filled in
 * @returns {{answer: string, noReply?: boolean, perfect: boolean, source: string, matched: string}|null}
 *   perfect: the saved question or template is the message itself (or a template is contained in it word for word)
 */
export function knownReply(message, { templates, qaMap }) {
  // A bot's summary of the answers given is not a question to the user
  if (isSummary(message.text)) {
    return { answer: '', noReply: true, perfect: true, source: 'summary of the answers given', matched: '' };
  }
  // A rejection gets the saved question about its reason, whatever its wording
  if (isRejection(message) && templates.has(REJECTION_KEY)) {
    return { answer: answerText(templates.get(REJECTION_KEY)), perfect: false, source: 'rejection: asking for the reason', matched: REJECTION_KEY };
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
    const answer = answerText(template.answer);
    return {
      answer: answer === NO_REPLY ? '' : answer,
      noReply: answer === NO_REPLY,
      perfect: Boolean(contained) || sameText(core, template.question),
      source: `chat-templates.lino ${template.score.toFixed(2)}`,
      matched: template.question,
    };
  }
  if (isQuestion(core)) {
    const asked = questionCore(core);
    const saved = findBestMatch(asked, qaMap, { threshold: CHAT_QUESTION_THRESHOLD });
    if (saved) {
      return { answer: answerText(saved.answer), perfect: sameText(asked, saved.question) || sameText(core, saved.question), source: `qa.lino ${saved.score.toFixed(2)}`, matched: saved.question };
    }
  }
  return null;
}

export { PATTERN_PREFIX, isPattern, matchesPattern };

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

/** hh.ru's own notices shown on the user's side of a chat: not the user's answers */
const HH_NOTICE = /^ответьте на приглашение, даже если оно вам не интересно/i;

/**
 * Pairs the user has answered in a chat, to learn: an employer's message followed by the user's
 * reply, and the lines of a recruiter bot's summary. Questions go to qa.lino, other messages are templates. The application itself,
 * hh.ru's notices and replies that are questions back («Можно без опыта?») are not answers
 * @param {Array<{mine: boolean, title: string, text: string}>} messages
 * @returns {{questions: Array<[string, string]>, templates: Array<[string, string]>}}
 */
export function learnedPairs(messages) {
  const questions = [];
  const templates = [];
  messages.forEach((message, index) => {
    // A recruiter bot repeats the questions with the answers given; answers that are questions back are not answers
    if (!message.mine) {
      questions.push(...summaryPairs(message.text).filter(([, answer]) => !isQuestion(answer)));
      return;
    }
    if (message.title === APPLICATION_TITLE || HH_NOTICE.test(message.text) || isQuestion(message.text)) {
      return;
    }
    const asked = messages[index - 1];
    if (!asked || asked.mine) {
      return;
    }
    if (isSummary(asked.text)) {
      return;
    }
    const core = templateCore(asked.text, { sender: asked.title });
    (isQuestion(core) ? questions : templates).push([isQuestion(core) ? questionCore(core) : core, message.text]);
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
Пиши обычным текстом без Markdown (без **, # и обратных кавычек).
Выведи только текст ответа.

=== Переписка (последние сообщения) ===
${recent}

=== Моё резюме ===
${resume}

=== Мои прошлые ответы на похожие вопросы ===
${related || '(нет)'}
`;
}
