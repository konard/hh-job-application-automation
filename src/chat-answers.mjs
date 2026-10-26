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

import { PATTERN_GAP as GAP, PATTERN_PREFIX, findBestMatch, isEnglish, isPattern, matchesPattern, normalizeQuestion, patternWords, stringSimilarity } from './qa-database.mjs';
import { answerText, hasAnswerVariants } from './qa.mjs';
import { answersInContexts, showsContext } from './answer-contexts.mjs';
import { APPLICATION_WORD, INVITE_NOTICE, REJECTION_WORD, TURNED_OFF_WORDS } from './hh-words.mjs';
import { salaryClarificationQuestion } from './salary-questions.mjs';

/** A template message is the same text in other words; its saved reply needs a close match */
export const TEMPLATE_THRESHOLD = 0.6;

/** Chat questions often ask two things at once; a saved answer to one of them needs a close match */
export const CHAT_QUESTION_THRESHOLD = 0.7;

/**
 * The first message of a chat: the user's own application with its cover letter («Отклик на
 * вакансию», "Vacancy application"). The user's own replies carry no title
 * @param {{mine: boolean, title?: string}} message
 * @returns {boolean}
 */
export const isApplication = (message) => APPLICATION_WORD.test(message.title ?? '');

/**
 * Runs in the page: the messages of the open chat, oldest first. The user's own messages carry a
 * delivery status icon; the others are the employer's or a bot's. Read with readChatIn
 * @param {string} turnedOffWords - TURNED_OFF_WORDS
 * @returns {{vacancy: string, messages: Array<{id: string, mine: boolean, title: string, heading: string, text: string}>, canReply: boolean, turnedOff: boolean}}
 *   heading: the bubble's own title («Отказ», "Rejection"); turnedOff: the employer turned the conversation off
 */
export function readChat(turnedOffWords) {
  const clean = (text) => String(text ?? '').trim();
  const messages = [...document.querySelectorAll('[data-qa^="chatik-chat-message-"]')]
    .filter((element) => /^chatik-chat-message-\d+$/.test(element.getAttribute('data-qa')))
    .map((element) => {
      const bubble = element.querySelector('[data-qa="chat-bubble-wrapper"]')?.getBoundingClientRect();
      const row = element.getBoundingClientRect();
      // The user's own bubble is on the right; hh.ru's notices in the middle are not the user's. The
      // employer's bubbles have an icon too (chat-bubble-icon-hidden, an eye), so icons decide only
      // when the page is not laid out
      // Long outgoing answers can fill the row, so their left margin is not a reliable sender
      // test. An outgoing delivery status takes precedence over the bubble's position.
      const outgoing = element.querySelector('[data-qa^="status-icon"], [data-qa^="chat-bubble-icon"]:not([data-qa="chat-bubble-icon-hidden"]), [class*="message_my"], [class*="chat-bubble_outgoing"]');
      const mine = Boolean(outgoing) || Boolean(bubble?.width > 0 &&
        bubble.left - row.left > 40 && row.right - bubble.right < 40);
      return {
        id: element.getAttribute('data-qa').replace('chatik-chat-message-', ''),
        mine,
        // The sender: «Отклик на вакансию», a person's name or «Робот-рекрутер»
        title: clean(element.querySelector('[data-qa="chat-bubble-title"], [data-qa="chat-bubble-author-name"]')?.innerText),
        text: clean(element.querySelector('[data-qa="chat-bubble-text"]')?.innerText),
        // hh.ru marks a rejection with an «Отказ» (Rejection) title in the bubble
        heading: clean(element.querySelector('[data-qa="chat-bubble-title"]')?.innerText),
      };
    })
    .filter((message) => message.text);
  // «Вакансия / <name> / Перейти» in any language: the line before the link, after the label
  const header = document.querySelector('[data-qa="chatik-header-sub-header"]');
  const link = clean(header?.querySelector('[data-qa="chatik-header-vacancy-link"]')?.innerText);
  const headerLines = clean(header?.innerText).split('\n').map((line) => line.trim()).filter((line) => line && line !== link);
  const buttons = [...document.querySelectorAll('[class*="buttons-wrapper"]')]
    .filter((element) => element.getClientRects().length > 0).at(-1);
  const chat = {
    id: window.location.pathname.match(/\/chat\/(\d+)/)?.[1] ?? '',
    vacancy: headerLines.at(-1) ?? '',
    company: clean(document.querySelector('[data-qa="participant-info-title"]')?.innerText),
    // «Перейти» leads to the vacancy
    vacancyUrl: document.querySelector('[data-qa="chatik-header-sub-header"] a[href*="/vacancy/"], a[href*="hh.ru/vacancy/"]')?.href.split('?')[0] ?? '',
    messages,
    // After a rejection hh.ru may close the chat: «Переписка будет доступна после приглашения работодателя»
    canReply: Boolean(document.querySelector('textarea[data-qa="text-input"]')),
    // «Работодатель отключил переписку по данной вакансии» under the messages, in place of the field
    turnedOff: [...document.querySelectorAll('span, div')].some((element) => element.childElementCount === 0 &&
      new RegExp(turnedOffWords, 'iu').test(element.textContent)),
    // Buttons can arrive after their question. Include them in the recorder's change signature
    // so the live watcher can select a choice even when the message text did not change.
    options: buttons ? [...buttons.querySelectorAll('button')].map((button) => button.innerText.trim()).filter(Boolean) : [],
  };
  // SPA navigation changes the address before replacing the conversation. Never attribute the
  // previous pane (or a mixture of two panes) to the new chat. Message IDs are globally unique.
  const view = window.__hhChatView ??= { owners: new Map(), headers: new Map(), accepted: null };
  const fingerprint = JSON.stringify([chat.vacancy, chat.company, chat.vacancyUrl]);
  const headerReady = Boolean(chat.vacancy && chat.company && chat.vacancyUrl);
  const conflictingMessage = messages.some(({ id }) => view.owners.has(id) && view.owners.get(id) !== chat.id);
  const conflictingHeader = headerReady && view.headers.has(chat.id) && view.headers.get(chat.id) !== fingerprint;
  if (view.accepted && (!messages.length || conflictingMessage || conflictingHeader)) {
    return { ...view.accepted, transitioning: true };
  }
  if (chat.id && messages.length) {
    messages.forEach(({ id }) => view.owners.set(id, chat.id));
    if (headerReady) view.headers.set(chat.id, fingerprint);
    view.accepted = chat;
  }
  return chat;
}

/**
 * The open chat, read in the page or frame
 * @param {{evaluate: Function}} target - Playwright's page or frame
 * @returns {Promise<Object>} readChat's
 */
export const readChatIn = (target) => target.evaluate(readChat, TURNED_OFF_WORDS);

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
  while (box && !/auto|scroll/.test(window.getComputedStyle(box).overflowY)) {
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
    // The line under the company: the last message, or the status («Отказ», «Собеседование»),
    // colored: red for a rejection, green for an invitation
    const lines = cell.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
    const preview = cell.querySelector('[class*="last-message-color_"]');
    const last = preview?.innerText.trim() || lines[lines.indexOf(subtitle) + 1] || '';
    const rect = cell.getBoundingClientRect();
    return {
      id: cell.getAttribute('data-qa').replace('chatik-open-chat-', ''),
      title: cell.querySelector('[data-qa="chat-cell-title"]')?.innerText.trim() ?? '',
      subtitle,
      last: /^\d+$/.test(last) ? '' : last,
      status: /last-message-color_([a-z]+)/.exec(preview?.className ?? '')?.[1] ?? '',
      lastIsMine: Boolean(cell.querySelector('[data-qa^="status-icon"]')),
      unread: Boolean(cell.querySelector('[data-qa*="badge"], [data-qa*="counter"]')),
      top: offset ? Number(offset[1]) : index,
      height: row?.offsetHeight || cell.offsetHeight,
      // Where it is drawn: the rows start below the list's own header, so their offset alone does not tell
      screen: { top: rect.top, bottom: rect.bottom, window: window.innerHeight },
    };
  });
}

/**
 * The chats of the list drawn whole inside it and the window, from the top: a cell cut by its
 * edge is not clicked. Where a cell is drawn tells, not its offset in the list: the rows after the
 * first ones and an ad card are a virtual list of their own, whose offsets start at 0 again
 * @param {Array} rows - readChatList
 * @param {{y: number, view: number}|null} at - scrollChatList: where the list is drawn
 * @returns {Array}
 */
export function chatsShown(rows, at) {
  const shown = (chat) => !chat.screen || (chat.screen.top >= (at?.y ?? 0) - 2 &&
    chat.screen.bottom <= Math.min(at ? at.y + at.view : Infinity, chat.screen.window) + 2);
  return rows.filter(shown).sort((a, b) => (a.screen?.top ?? a.top) - (b.screen?.top ?? b.top));
}

/**
 * Runs in the page: the user's own activity in the chat window (keys, clicks, the pointer, the
 * wheel), and whether a reply is being typed. The tool's own clicks are left out while it sets
 * window.__chatAutomating
 * @returns {{at: number, typing: boolean}} at: when the user last did something (the first read: then)
 */
export function readUserActivity() {
  if (!window.__chatUserActivity) {
    // Counted from now: what the user did before is not known
    window.__chatUserActivity = { at: Date.now() };
    const mark = (event) => {
      if (event.isTrusted && !window.__chatAutomating) {
        window.__chatUserActivity.at = Date.now();
      }
    };
    for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'input']) {
      document.addEventListener(type, mark, { capture: true, passive: true });
    }
  }
  const field = document.querySelector('textarea[data-qa="text-input"]');
  return { at: window.__chatUserActivity.at, typing: Boolean(field?.value.trim()) };
}

export const USER_IDLE_MS = 15000;
/** A sent answer or a chat switch still gets the same short idle grace as typing. */
export const userIsActive = (activity, now = Date.now()) => !activity || activity.typing || now - activity.at < USER_IDLE_MS;

/**
 * A rejection badge, or an explicit rejection in the full last-message preview. Questions and
 * requests remain for the user even when the employer also mentions a rejection.
 * @param {{last?: string, status?: string}} chat - readChatList's
 * @returns {boolean}
 */
export function isRejectionCell(chat) {
  if (chat.lastIsMine) return false;
  const text = chat.last ?? '';
  if (REJECTION_WORD.test(text) || (chat.status === 'red' && /^\p{L}+(?:[\s-]\p{L}+)?$/u.test(text))) return true;
  const request = asksSomething(text) ||
    /(?:^|[.!,:;]\s*)(?:пришлите|отправьте|свяжитесь|позвоните|заполните|пройдите|перейдите|ответьте)(?!\p{L})/iu.test(text) ||
    /(?:^|[.!]\s+)(?:please\s+)?(?:reply|send|share|provide|confirm|tell us|let us know)\b/i.test(text);
  return !request && isRejection({ mine: false, text });
}

/**
 * The unread rejections shown in the chat list
 * @param {Array} chats - readChatList's, those on screen
 * @returns {Array}
 */
export const visibleRejections = (chats) => chats.filter((chat) => chat.unread && isRejectionCell(chat));

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
  // «С уважением, Егор / HR команды Нонтон»: the closing and all after it, a few lines at the end
  const closing = lines.findLastIndex((line, index) => index > 0 && index >= lines.length - 4 && CLOSING.test(line));
  return (closing > 0 ? lines.slice(0, closing) : lines).join('\n');
}

/** The closing of a message before the signature */
const CLOSING = /^(?:с уважением|с наилучшими пожеланиями|всего доброго|best regards|kind regards|regards)(?!\p{L})/iu;

/**
 * The words a company picks one of for the same thing: «для позиции», «для вакансии», «для
 * должности» are the same template
 * @param {string} text
 * @returns {string}
 */
const sameWords = (text) => String(text).replace(/(?<!\p{L})(?:ваканси|позици|должност)\p{L}*/giu, 'позиции');

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
  // «Вопрос?: Ответ» on every line; a question the bot asked without «?» is listed as «Вопрос: Ответ»
  const pairs = lines.map((line) => line.match(/^(.+?\??)\s*:\s+(.+)$/)).filter(Boolean).map(([, question, answer]) => [question.trim(), answer.trim()]);
  return pairs.length === lines.length && pairs.some(([question]) => question.endsWith('?')) ? pairs : [];
}

/** Whether a message is a bot's summary of the answers given: not a question to the user */
export const isSummary = (text) => ASSISTANT_SUMMARY.test(String(text).trim()) || summaryPairs(text).length > 0;

/**
 * A recruiter bot offering the answers given to it before (another vacancy of the employer):
 * «Похоже, вы отвечали на часть вопросов:», the list «Вопрос?: Ответ», then «Используем эти
 * ответы?» with the buttons «Да. Используем те же ответы» and «Нет. Отвечу заново»
 */
const REUSE_OFFER = /^(?:используем|использовать|использовать ли) (?:эти|те же|ваши) ответы\s*\??$/i;
export const isReuseOffer = (text) => REUSE_OFFER.test(String(text).trim());

const YES_NO = new Map([['да', 'yes'], ['yes', 'yes'], ['нет', 'no'], ['no', 'no']]);
/** The same answer, apart from case and punctuation, «No» and «Нет» alike */
const sameAnswer = (a, b) => {
  const [x, y] = [a, b].map((text) => normalizeQuestion(answerText(text)).replace(/[.!]+$/, ''));
  return x === y || (YES_NO.has(x) && YES_NO.get(x) === YES_NO.get(y));
};

/**
 * The earlier answers a bot offers to reuse, each compared with the saved answer of the very same
 * question
 * @param {Array<{mine: boolean, text: string}>} messages - readChat's, the offer among the last ones
 * @param {(question: string) => Promise<Map>} answersFor - The saved answers for a question, in the chat's contexts
 * @returns {Promise<{pairs: Array<{question: string, given: string, saved: string|null, matched: string|null, same: boolean|null}>,
 *   decision: 'yes'|'no'|null}>} same: null when the question is not saved word for word (matched: the
 *   closest one, for the user); decision: yes when every answer is the saved one, no when one differs,
 *   null when one is not saved (the user decides)
 */
export async function compareReusedAnswers(messages, answersFor) {
  const offer = messages.findLastIndex((message) => !message.mine && isReuseOffer(message.text));
  const lastMine = messages.slice(0, Math.max(offer, 0)).map((message) => message.mine).lastIndexOf(true);
  const list = messages.slice(lastMine + 1, Math.max(offer, 0)).reverse().find((message) => !message.mine && summaryPairs(message.text).length > 0);
  const pairs = await Promise.all(summaryPairs(list?.text ?? '').map(async ([question, given]) => {
    const match = findBestMatch(question, await answersFor(question), { threshold: CHAT_QUESTION_THRESHOLD });
    const exact = Boolean(match) && sameText(question, match.question);
    return { question, given, saved: match ? answerText(match.answer) : null, matched: match?.question ?? null, same: exact ? sameAnswer(given, match.answer) : null };
  }));
  const decision = pairs.length === 0 ? null
    : pairs.some(({ same }) => same === false) ? 'no'
      : pairs.every(({ same }) => same === true) ? 'yes' : null;
  return { pairs, decision };
}

/**
 * The bot's button for the decision: «Да. Используем те же ответы» or «Нет. Отвечу заново»
 * @param {'yes'|'no'|null} decision
 * @param {string[]} options
 * @returns {string|null}
 */
export const reuseOption = (decision, options) => (decision
  ? options.find((option) => (decision === 'yes' ? /^(да|yes)(?!\p{L})/iu : /^(нет|no)(?!\p{L})/iu).test(option.trim())) ?? null
  : null);

/**
 * @param {Awaited<ReturnType<typeof compareReusedAnswers>>} compared
 * @returns {string} The comparison for the log, one line a question
 */
export function describeReuse({ pairs, decision }) {
  const verdict = { yes: 'all are your saved answers: «Да» fits', no: 'some differ from your saved answers: «Нет» fits' }[decision] ??
    'not every question is saved: you decide';
  return [
    `🔁 The bot offers your earlier answers (${pairs.length}): ${verdict}`,
    ...pairs.map(({ question, given, saved, matched, same }) => {
      const mark = same === true ? '✓' : same === false ? '✗' : '?';
      const note = same === false ? ` (saved: ${saved})`
        : same === null && matched ? ` (closest saved: «${matched.slice(0, 80)}» → ${String(saved).slice(0, 80)})`
          : same === null ? ' (not saved)' : '';
      return `   ${mark} ${question.slice(0, 120)}: ${given}${note}`;
    }),
  ].join('\n');
}

const ACKNOWLEDGEMENT = /^(понял[аи]?|поняла|ясно|хорошо|отлично|супер|здорово|спасибо|благодарю|принято|ok|ок)(?!\p{L})[^.!?]*[.!]\s+/iu;
const LEAD_IN = /^(?:хорошо|отлично|понял[аи]?|поняла|ясно|спасибо|ок|ok)(?:\s*[,!.]\s*(?:а\s+)?|\s+а\s+)|^(?:а|теперь)\s+(?=\p{L})/iu;
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
 * Whether a message is a rejection: hh.ru's «Отказ» (Rejection) title, or the usual wording
 * @param {{heading?: string, text: string}} message
 * @returns {boolean}
 */
export function isRejection(message) {
  return (!message.mine && REJECTION_WORD.test(message.heading ?? '')) ||
    /не готовы пригласить|не можем пригласить|приняли решение (не продолжать|отказать)|выбрали другого кандидата|к сожалению,? (мы )?(не готовы|вынуждены отказать|не можем)/i.test(message.text) ||
    /\bwe (?:have )?(?:chosen|selected) (?:another|other)\b|\bwe (?:will not|cannot|can't|are unable to|won't) (?:proceed|move forward|invite)\b|\byour (?:application|candidacy) (?:was|has been) (?:rejected|declined)\b/i.test(message.text);
}

/** The same text, apart from case, spacing and punctuation */
const sameText = (a, b) => !isPattern(b) && normalizeQuestion(a) === normalizeQuestion(b);

export const isQuestion = (text) => /\?\s*$/.test(text.trim()) || /\?\s/.test(text);

/** A request for the user's facts without a question mark: «Расскажите о вашем опыте с Kafka.», «Проживаете в РФ» */
const REQUEST = /(?:^|[.!:,]\s*)(?:расскажите|опишите|поделитесь|уточните|приведите|перечислите|назовите|подскажите|напишите|укажите|сообщите)(?!\p{L})|^(?:проживаете|находитесь|работаете|готовы|есть ли|имеется|был ли|была ли|были ли)(?!\p{L})|(?:^|[.!:,]\s*)(?:please\s+)?(?:tell|describe|share|specify|provide|indicate|state|enter|select|choose|list|confirm|send|reply|give|let us know)\b/iu;

/** Words of a pattern itself, its gaps aside */
const patternOwnWords = (pattern) => pattern.replace(PATTERN_PREFIX, '').split(' ').filter((token) => token && token !== GAP).length;

/** Something the employer asks the user to do: an invitation, a test, a form, a link, a call */
const ASKS_TO_DO = /пригла|собеседов|интервью|тестов|задани|анкет|заполн|пройд|напиши|напишите|позвон|созвон|свяжитесь|пришлите|отправьте|сообщите|укажите|ссылк|telegram|телеграм|https?:|t\.me|@\w/iu;

/**
 * What a message adds to a template inside it asks the user something: more question marks than the
 * template, a request («расскажите», «уточните»), an invitation, a form, a link
 * @param {string} core - templateCore of the message
 * @param {string} template - The saved template inside it
 * @returns {boolean}
 */
const addsAsking = (core, template) => {
  const marks = (text) => String(text).match(/\?/g)?.length ?? 0;
  const rest = normalizeQuestion(sameWords(core)).replace(normalizeQuestion(sameWords(template)), ' ');
  return marks(core) > marks(template) || ASKS_TO_DO.test(rest) || ASKS_FOR.test(rest);
};

/** A request for the user's facts anywhere in a text */
const ASKS_FOR = /(?<!\p{L})(?:расскажите|опишите|поделитесь|уточните|приведите|перечислите|назовите|подскажите|напомните)(?!\p{L})/iu;

/** The words of a message a pattern may say all of, whatever its own length */
const PATTERN_MESSAGE_WORDS = 40;

/**
 * A pattern says all of a message: the message asks the user nothing (no question, no request for
 * facts, nothing to do) and is a short note (up to 40 words, or 3 times the pattern's own): what
 * else it says (thanks, a company's and a vacancy's names) needs no other answer
 * @param {string} pattern
 * @param {string} core - templateCore of the message
 * @returns {boolean}
 */
export const patternSays = (pattern, core) => !ASKS_TO_DO.test(core) && !ASKS_FOR.test(core) && !/\?/.test(core) &&
  patternWords(core).length <= Math.max(PATTERN_MESSAGE_WORDS, 3 * patternOwnWords(pattern));

/** Acknowledgements can state an active review without promising a separate follow-up. */
const REVIEWS = /рассмотр|рассматр|анализ|изуч|ознаком|в работу|приня(?:ли|то)|получили|подходит|подойд|review|consider/iu;
const COMES_BACK = /свяж|сообщ|верн[её]м|верн[её]тся|обратн\p{L}* связ|позвон|напиш(?:ем|ет)|результат|contact|get back|reach out/iu;
const ABOUT_APPLICATION = /резюме|отклик|кандидат|опыт|resume|cv|application/iu;
const UNDER_REVIEW = /(?:резюме|кандидатура|отклик)\s+(?:(?:сейчас|пока)\s+)?(?:(?:находится|находятся)\s+)?(?:на\s+(?:этапе\s+)?рассмотрени[ия]|в\s+процессе\s+рассмотрения|рассматривается)|(?:resume|cv|application|candidacy)\s+(?:is\s+)?(?:currently\s+)?(?:under\s+review|being\s+(?:reviewed|considered))/iu;
/**
 * Asks the user to do something: an imperative, an invitation, an interview (not the results of
 * interviews held), a test or a form, a link
 */
const ASKS_USER = /(?<!\p{L})(?:напишите|позвоните|свяжитесь|пришлите|отправьте|сообщите|укажите|заполните|пройдите|ответьте|подтвердите|перейдите|почитайте|посмотрите|выберите|запишитесь|please)(?!\p{L})|пригла|(?<!результат\p{L}*\s+)(?:собеседов|интервью)|тестов|задани|анкет|ссылк|telegram|телеграм|https?:|t\.me|www\.|@\w/iu;
/** The words an acknowledgement may have: «Благодарим за интерес… продолжаем рассматривать кандидатов… свяжемся с вами» */
const ACKNOWLEDGEMENT_WORDS = 80;
/** Not good news: a rejection in other words */
const BAD_NEWS = /к сожалению|отказ|не готовы|не можем|не подходит|unfortunately|regret/iu;

/**
 * Whether a message only acknowledges the application, in any company's words («Спасибо за
 * отклик! Мы рассмотрим ваше резюме и свяжемся с вами»): it tells the resume is reviewed and the
 * employer comes back, or states an active review. It asks nothing and brings no bad news.
 * @param {string} core - templateCore of the message
 * @returns {boolean}
 */
export function isAcknowledgement(core) {
  // Optional company information is not a task for the applicant. Strip only this explicit
  // informational sentence and an hh.ru employer page; survey/test/contact links still block it.
  const text = String(core ?? '').replace(/(?:вы также можете|также вы можете)\s+(?:узнать больше о нас и\s+)?ознакомиться с (?:другими|нашими) вакансиями по ссылке\s*:\s*https:\/\/hh\.ru\/employer\/\d+\/?(?=\s|[.!]|$)\s*[.!]?/giu, '');
  return (UNDER_REVIEW.test(text) || (REVIEWS.test(text) && COMES_BACK.test(text) && ABOUT_APPLICATION.test(text))) && !/\?/.test(text) &&
    !ASKS_FOR.test(text) && !ASKS_USER.test(text) && !BAD_NEWS.test(text) && !isRejection({ text }) &&
    patternWords(text).length <= ACKNOWLEDGEMENT_WORDS;
}

/** The thanks to a message in English when none in English is saved */
const ENGLISH_THANKS = 'Hello, thank you.';

/**
 * The thanks saved most often for templates in the message's language: the reply to an
 * acknowledgement; null without one
 */
function savedThanks(templates, english = false) {
  const counts = new Map();
  for (const answer of templates.values()) {
    const text = answerText(answer);
    if (isThanks(text) && !/[а-яё]/iu.test(text) === english) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (english ? ENGLISH_THANKS : null);
}

/** Whether a message asks the user something: a question, or a request for facts about them */
export const asksSomething = (text) => isQuestion(text) || REQUEST.test(String(text).trim());

/**
 * The reply to a waiting message, when it is known
 * @param {Object} message - {title, text}
 * @param {Object} sources
 * @param {Map} sources.templates - data/chat-templates.lino: template message -> reply
 * @param {Map} sources.qaMap - data/qa.lino with contacts filled in
 * @param {string|null} [sources.byPattern] - The answer of a salary question by pattern (salary-questions.mjs)
 * @returns {{answer: string, noReply?: boolean, perfect: boolean, source: string, matched: string}|null}
 *   perfect: the saved question or template is the message itself (or a template is contained in it word for
 *   word, or a learned pattern says all of it: patternSays)
 */
export function knownReply(message, { templates, qaMap, byPattern = null }) {
  // The offer to reuse earlier answers is decided by comparing them (compareReusedAnswers)
  if (isReuseOffer(message.text)) {
    return null;
  }
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
  const flat = normalizeQuestion(sameWords(core));
  const contained = [...examples.keys()].find((key) => key !== REJECTION_KEY && normalizeQuestion(key).length > 20 &&
    flat.includes(normalizeQuestion(sameWords(key))));
  // A learned pattern matches other wordings of the same template; a question is not a template.
  // The pattern with the most words of its own, the closest one
  const pattern = !contained && !isQuestion(core) && [...templates.keys()]
    .filter((key) => isPattern(key) && matchesPattern(sameWords(key), sameWords(core)))
    .sort((a, b) => patternOwnWords(b) - patternOwnWords(a))[0];
  const template = contained || pattern
    ? { question: contained || pattern, answer: templates.get(contained || pattern), score: 1 }
    : findBestMatch(core, examples, { threshold: TEMPLATE_THRESHOLD });
  const answer = template && answerText(template.answer);
  const reply = template && {
    answer: answer === NO_REPLY ? '' : answer,
    noReply: answer === NO_REPLY,
    // A template inside a longer message: what the company adds asks nothing of the user
    perfect: (Boolean(contained) && !addsAsking(core, contained)) ||
      (Boolean(pattern) && patternSays(pattern, core)) || sameText(core, template.question),
    source: `chat-templates.lino ${template.score.toFixed(2)}`,
    matched: template.question,
  };
  // Any company's acknowledgement of the application is thanked for, as the saved ones are
  const thanks = !reply?.perfect && isAcknowledgement(core) && savedThanks(templates, isEnglish(core));
  if (thanks) {
    return { answer: thanks, noReply: false, perfect: true, source: 'chat-templates.lino: an acknowledgement of the application', matched: core };
  }
  if (reply) {
    return reply;
  }
  if (asksSomething(core) || asksSomething(questionCore(core))) {
    // A salary question not saved word for word: its answer by pattern (salary-questions.mjs), to prefill
    if (byPattern) {
      return { answer: answerText(byPattern), perfect: false, source: 'salary question by pattern', matched: message.text };
    }
    const asked = questionCore(core);
    const saved = findBestMatch(asked, qaMap, { threshold: CHAT_QUESTION_THRESHOLD });
    if (saved) {
      return { answer: answerText(saved.answer), perfect: !hasAnswerVariants(saved.answer) && (sameText(asked, saved.question) || sameText(core, saved.question)), source: `qa.lino ${saved.score.toFixed(2)}`, matched: saved.question };
    }
  }
  return null;
}

/**
 * knownReply with the saved answers in the contexts of the chat (answer-contexts.mjs): a salary in
 * the currency of the vacancy. The vacancy's own page is read only when the chat does not tell and
 * the reply would differ between contexts
 * @param {Object} message - {title, text}
 * @param {Object} sources
 * @param {Function} sources.readTemplates - withContacts' readQADatabase of chat-templates.lino
 * @param {Function} sources.readQADatabase - withContacts' readQADatabase of qa.lino
 * @param {Array} sources.contexts - parseAnswerContexts
 * @param {string[]} [sources.known] - What the chat tells, most telling first: the vacancy's card,
 *   the employer's messages
 * @param {() => Promise<string[]>} [sources.vacancyTexts] - The vacancy page: its pay, title, description
 * @returns {Promise<Object|null>} As knownReply
 */
export async function knownReplyInContexts(message, { readTemplates, readQADatabase, contexts, known = [], vacancyTexts }) {
  const templates = answersInContexts(readTemplates, contexts);
  const qaMaps = answersInContexts(readQADatabase, contexts);
  // A message not saved word for word that has an answer under itself: a salary question answered by pattern
  const savedAsIs = (await readQADatabase()).has(message.text);
  const clarification = salaryClarificationQuestion(message.text, known);
  const question = clarification ?? message.text;
  const replyIn = async (texts) => {
    const qaMap = await qaMaps(question, texts);
    if (clarification) {
      return qaMap.has(question)
        ? { answer: answerText(qaMap.get(question)), perfect: false, source: 'salary clarification by pattern', matched: message.text }
        : null;
    }
    const byPattern = !savedAsIs && qaMap.has(message.text) ? qaMap.get(message.text) : null;
    return knownReply(message, { templates: await templates(message.text, texts), qaMap, byPattern });
  };
  const reply = await replyIn(known);
  if (!reply || reply.noReply || !vacancyTexts || showsContext(contexts, [message.text, ...known])) {
    return reply;
  }
  const others = await Promise.all(contexts.filter(({ words }) => words.length > 0).map(({ words }) => replyIn([words[0]])));
  if (others.every((other) => other?.answer === reply.answer)) {
    return reply;
  }
  const vacancy = await vacancyTexts().catch(() => []);
  return vacancy.length > 0 ? replyIn([...vacancy, ...known]) : reply;
}

/**
 * What a chat tells about its vacancy, most telling first: the employer's messages, newest first,
 * then the vacancy's name (the user's own messages may hold an answer in another context)
 * @param {{vacancy?: string, messages: Array<{mine: boolean, text: string}>}} chat
 * @returns {string[]}
 */
export const chatContextTexts = (chat) => [...chat.messages.filter((message) => !message.mine).map((message) => message.text).reverse(), chat.vacancy ?? ''];

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


/**
 * Replies that say the same: equal, or nearly so («Благодарю, ожидаю» and «Благодарю, ожидаю!»), or
 * both only thanks in the same language (one of them fits any template thanked for)
 */
const sameReply = (a, b) => (isThanks(answerText(a)) && isThanks(answerText(b)) &&
  /[а-яё]/iu.test(answerText(a)) === /[а-яё]/iu.test(answerText(b))) || stringSimilarity(normalizeQuestion(answerText(a)), normalizeQuestion(answerText(b))) >= 0.85;

/** Words of a reply that only thanks and says the user waits */
const THANKS_WORDS = new Set(['здравствуйте', 'добрый', 'день', 'вечер', 'утро', 'привет', 'благодарю', 'спасибо', 'большое',
  'ожидаю', 'жду', 'буду', 'ждать', 'решения', 'ответа', 'обратной', 'связи', 'за', 'ответ', 'я', 'и', 'хорошо', 'понял', 'принял', 'отлично',
  'hello', 'hi', 'good', 'morning', 'afternoon', 'evening', 'thank', 'thanks', 'you', 'very', 'much', 'for', 'the', 'update', 'i',
  'look', 'looking', 'forward', 'to', 'hearing', 'from', 'your', 'reply', 'response', 'and', 'will', 'wait', 'await', 'great', 'noted']);

/**
 * Whether a reply only thanks (and says the user waits): one of them fits any template thanked for
 * @param {string} reply
 * @returns {boolean}
 */
export function isThanks(reply) {
  const words = String(reply ?? '').toLowerCase().replace(/ё/g, 'е').match(/\p{L}+/gu) ?? [];
  return words.length > 0 && words.length <= 10 && words.some((word) => ['благодарю', 'спасибо', 'thank', 'thanks'].includes(word)) &&
    words.every((word) => THANKS_WORDS.has(word));
}

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

/** An employer's reminder of a question not answered yet */
const REMINDER = /не дождал(?:ась|ся|ись) (?:вашего )?ответа|можем продолжить (?:наше )?общение|^вы (?:ещё |еще )?здесь\?/i;
export const isReminder = (text) => REMINDER.test(String(text));

/** A message that only greets */
const GREETING_ONLY = /^(?:здравствуйте|добрый\s+(?:день|вечер|утро)|доброе\s+утро|привет|hello|hi)[\s!.,)]*$/iu;

/** The hh.ru support chat: no vacancy, its replies are to the support, not to employers */
export const isSupportChat = (chat) => !chat.vacancy && /поддержк|support|помощник|assistant/i.test(`${chat.company ?? ''} ${chat.title ?? ''}`);

/**
 * Pairs the user has answered in a chat, to learn: an employer's message followed by the user's
 * reply, and the lines of a recruiter bot's summary. Questions go to qa.lino, other messages are templates. The application itself,
 * hh.ru's notices, replies that are questions back («Можно без опыта?») and a greeting alone are not answers
 * @param {Array<{mine: boolean, title: string, text: string}>} messages
 * @returns {{questions: Array<[string, string]>, templates: Array<[string, string]>}}
 */
export function learnedPairs(messages) {
  const questions = [];
  const templates = [];
  const answerEvents = [];
  messages.forEach((message, index) => {
    // A recruiter bot repeats the questions with the answers given; answers that are questions back are not answers
    if (!message.mine) {
      questions.push(...summaryPairs(message.text).filter(([, answer]) => !isQuestion(answer)));
      return;
    }
    // A greeting alone answers nothing: the answer follows in the next message
    // hh.ru's own notices shown on the user's side («Ответьте на приглашение…») are not the user's answers
    if (isApplication(message) || INVITE_NOTICE.test(message.text) ||
      (/\?\s*$/.test(message.text) && !/[.!]\s+\S/.test(message.text)) || GREETING_ONLY.test(message.text.trim())) {
      return;
    }
    // An answer can be sent in several bubbles. Keep the whole reply, once, rather than losing
    // every bubble after the first (including answers whose sender name is shown).
    if (messages[index - 1]?.mine && !isApplication(messages[index - 1]) &&
      !INVITE_NOTICE.test(messages[index - 1].text) && !GREETING_ONLY.test(messages[index - 1].text.trim()) &&
      !isQuestion(messages[index - 1].text)) return;
    const parts = [message.text];
    const messageIds = [message.id ?? `index:${index}`];
    for (let next = index + 1; messages[next]?.mine; next += 1) {
      if (!isApplication(messages[next]) && !INVITE_NOTICE.test(messages[next].text)) {
        parts.push(messages[next].text);
        messageIds.push(messages[next].id ?? `index:${next}`);
      }
    }
    // A reminder («не дождалась вашего ответа») is not what the user answers: the question before it is
    let before = index - 1;
    // Nor is the user's own greeting sent before the answer
    while (before > 0 && (messages[before].mine ? GREETING_ONLY.test(messages[before].text.trim()) : isReminder(messages[before].text))) {
      before -= 1;
    }
    const asked = messages[before];
    if (!asked || asked.mine || isReminder(asked.text)) {
      return;
    }
    // The choice whether to reuse earlier answers depends on them: not a saved answer
    if (isSummary(asked.text) || isReuseOffer(asked.text)) {
      return;
    }
    const core = templateCore(asked.text, { sender: asked.title });
    const question = questionCore(core);
    const isAsked = asksSomething(core) || asksSomething(question);
    const answer = parts.join('\n\n');
    (isAsked ? questions : templates).push([isAsked ? question : core, answer]);
    if (isAsked) answerEvents.push({ question, answer, messageIds });
  });
  return { questions, templates, answerEvents };
}

/**
 * Frequencies of actual sent replies, keyed by message IDs, not by how often a snapshot is read.
 * Bot summaries retain their answers with count 0: they are not another reply sent by the user.
 * Earlier versions of edited sent messages each count once, without counting other replies again.
 */
export function countChatAnswers(messages) {
  const counts = new Map();
  const events = new Set();
  const add = (question, answer, event) => {
    const key = JSON.stringify([normalizeQuestion(question), answer]);
    if (!counts.has(key)) counts.set(key, { question, answer, count: 0 });
    if (event && !events.has(event)) {
      events.add(event);
      counts.get(key).count += 1;
    }
  };
  const collect = (items, changedId) => {
    const { questions, answerEvents } = learnedPairs(items);
    questions.forEach(([question, answer]) => add(question, answer));
    for (const { question, answer, messageIds } of answerEvents) {
      if (changedId !== undefined && !messageIds.includes(changedId)) continue;
      add(question, answer, JSON.stringify([normalizeQuestion(question), answer, messageIds]));
    }
  };
  messages.forEach((message, index) => {
    for (const text of message.previousTexts ?? []) {
      collect(messages.map((item, at) => at === index ? { ...item, text } : item), message.id ?? `index:${index}`);
    }
  });
  collect(messages);
  return [...counts.values()];
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
Напиши мой ответ на последнее сообщение работодателя: коротко, вежливо, по делу, от первого лица, на языке работодателя.
Используй ТОЛЬКО факты из моего резюме и моих прошлых ответов ниже. Ничего не выдумывай: где нужного факта нет,
поставь пометку «[уточнить: что именно]», я заполню сам. Если работодатель прислал ссылку на анкету, ответь, что заполню её.
Пиши обычным текстом без Markdown (без **, # и обратных кавычек) и без длинного тире (—): вместо него дефис, двоеточие или запятая.
Выведи только текст ответа.

=== Переписка (последние сообщения) ===
${recent}

=== Моё резюме ===
${resume}

=== Мои прошлые ответы на похожие вопросы ===
${related || '(нет)'}
`;
}
