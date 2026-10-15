/**
 * The chat hh.ru opens in a panel over the vacancy list right after an application: a recruiter
 * bot (or the employer) often asks its questions there at once. They are answered in that panel
 * before the next vacancy:
 * - each waiting question takes its saved answer (qa.lino, chat-templates.lino); a perfect match
 *   (the saved question is the question itself, and with the bot's buttons the saved answer is one
 *   of them) is sent, a button clicked as a person would
 * - anything else is prefilled when an answer is close, the chat is scrolled to its last message,
 *   and the run waits until the user has answered it (s/y moves on without it)
 * - what the user answers is learned (qa.lino), so the same question is perfect next time
 * - when the bot has nothing more to ask, the panel is closed and the run goes on
 *
 * @module instant-chat
 */

import { chatContextTexts, isQuestion, knownReplyInContexts, learnedPairs, pendingMessages, readChat } from './chat-answers.mjs';
import { normalizeQuestion } from './qa-database.mjs';
import { askUser, isInteractive, withdrawPrompt } from './confirmations.mjs';
import { extractVacancyId } from './hh-selectors.mjs';
import { loadAnswerContexts } from './answer-contexts.mjs';

/** The panel's chat is a frame of chatik.hh.ru */
const CHAT_FRAME = /^https:\/\/chatik\.hh\.ru\/chat\/(\d+)/;
const INPUT = 'textarea[data-qa="text-input"]';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs in the chat frame: the reply buttons the bot offers under its last message
 * @returns {string[]}
 */
export function readQuickReplies() {
  const wrappers = [...document.querySelectorAll('[class*="buttons-wrapper"]')].filter((wrapper) => wrapper.getClientRects().length > 0);
  const last = wrappers[wrappers.length - 1];
  return last ? [...last.querySelectorAll('button')].map((button) => button.innerText.trim()).filter(Boolean) : [];
}

/** Runs in the chat frame: scrolled down to the last message, so the user sees what is asked */
export function scrollToLastMessage() {
  const messages = document.querySelectorAll('[data-qa^="chatik-chat-message-"]');
  const last = messages[messages.length - 1];
  let box = last?.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 10 && /auto|scroll/.test(window.getComputedStyle(box).overflowY))) {
    box = box.parentElement;
  }
  if (box) {
    box.scrollTop = box.scrollHeight;
  } else {
    last?.scrollIntoView({ block: 'end' });
  }
}

/**
 * The bot's button that is the saved answer itself (case and punctuation aside), or null
 * @param {string} answer
 * @param {string[]} options
 * @returns {string|null}
 */
export function perfectOption(answer, options) {
  const wanted = normalizeQuestion(answer);
  return options.find((option) => normalizeQuestion(option) === wanted) ?? null;
}

/** The user's own message after the given one appeared */
const answeredAfter = (chat, messageId) => {
  const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
  return index >= 0 && chat.messages.slice(index + 1).some((message) => message.mine);
};

async function waitForAnswer(frame, messageId, ms) {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(500)) {
    if (answeredAfter(await frame.evaluate(readChat).catch(() => null), messageId)) {
      return true;
    }
  }
  return false;
}

/**
 * Send a perfect answer in a chat (the panel's frame, or the main frame of hh.ru/chat): the bot's
 * button, or the typed text
 * @param {Object} frame - Playwright frame showing the chat
 * @param {string} messageId - The message it answers
 * @param {{answer: string, option?: string|null}} reply
 * @returns {Promise<boolean>} True once it shows in the chat
 */
export async function sendChatAnswer(frame, messageId, { answer, option }) {
  if (option) {
    await frame.getByRole('button', { name: option, exact: true }).last().click({ timeout: 5000 });
  } else {
    const input = frame.locator(INPUT).first();
    await input.fill(answer);
    await sleep(500);
    const sendButton = frame.locator('button[data-qa*="send"]').first();
    if (await sendButton.isVisible().catch(() => false)) {
      await sendButton.click({ timeout: 5000 });
    } else {
      await input.press('Enter');
    }
  }
  return waitForAnswer(frame, messageId, 8000);
}

/**
 * @param {Object} options
 * @param {Object} options.page - Playwright page of the vacancy list
 * @param {Function} options.readQADatabase - qa.lino with contacts filled in
 * @param {Function} options.addOrUpdateQA
 * @param {Function} options.readTemplates - data/chat-templates.lino with contacts filled in
 * @param {boolean} options.autoSend - Send perfect matches (--auto-send-exact-answers)
 * @param {Function} options.closePanel - Closes the chat panel
 * @param {(vacancyId: string|null) => string[]} [options.vacancyContext] - The vacancy's card and
 *   description, for the answers' contexts (answer-contexts.mjs)
 * @param {number} [options.firstMessageMs] - How long the first message of a bot is waited for
 * @param {number} [options.nextMessageMs] - How long the next question is waited for after an answer
 * @returns {(vacancyId: string|null) => Promise<void>}
 */
export function createInstantChat({
  page, readQADatabase, addOrUpdateQA, readTemplates, autoSend, closePanel, vacancyContext = () => [],
  firstMessageMs = 20000, nextMessageMs = 15000, log = console.log,
}) {
  /**
   * The open panel's chat of this vacancy. A closed panel keeps its frame, hidden, with the
   * chat of an earlier application: only a visible one of this vacancy counts
   */
  async function waitForChat(vacancyId, ms) {
    for (const started = Date.now(); Date.now() - started < ms; await sleep(500)) {
      for (const frame of page.frames().filter((candidate) => CHAT_FRAME.test(candidate.url()))) {
        if (!await frame.frameElement().then((element) => element.isVisible()).catch(() => false)) {
          continue;
        }
        const chatVacancy = extractVacancyId((await frame.evaluate(readChat).catch(() => null))?.vacancyUrl ?? '');
        if (!vacancyId || chatVacancy === vacancyId) {
          return frame;
        }
      }
    }
    return null;
  }


  /** Questions the user answered in the chat go to qa.lino */
  async function learn(chat) {
    const known = await readQADatabase();
    for (const [question, answer] of learnedPairs(chat.messages).questions) {
      if (!known.has(question)) {
        await addOrUpdateQA(question, answer);
        log(`💾 Learned from the chat (qa.lino): ${question}`);
      }
    }
  }

  /** Wait until the user has answered the message in the panel, or typed y/s to move on */
  async function waitForUser(frame, messageId) {
    let done = false;
    const watcher = (async () => {
      while (!done) {
        await sleep(2000);
        if (answeredAfter(await frame.evaluate(readChat).catch(() => null), messageId)) {
          done = true;
          withdrawPrompt();
        }
      }
    })();
    const choice = await askUser('Answer in the chat panel of the vacancy list (the run goes on after it)', { skip: 'leave the chat and go on' });
    done = true;
    await watcher.catch(() => {});
    return choice;
  }

  return async function answerInstantChat(vacancyId) {
    const frame = await waitForChat(vacancyId, 10000);
    if (!frame) {
      log('💬 hh.ru opened no chat panel for this application');
      return;
    }
    let handled = null;
    let quietSince = Date.now();
    let waitMs = firstMessageMs;
    for (;;) {
      const chat = await frame.evaluate(readChat).catch(() => null);
      // Closed by the user, or another chat opened in it
      const chatVacancy = extractVacancyId(chat?.vacancyUrl ?? '');
      if (!chat || frame.isDetached() || (vacancyId && chatVacancy && chatVacancy !== vacancyId)) {
        log('💬 The chat panel was closed or shows another chat: left as it is');
        return;
      }
      const last = pendingMessages(chat.messages).at(-1);
      if (!last || last.id === handled) {
        if (Date.now() - quietSince > waitMs) {
          break;
        }
        await sleep(1500);
        continue;
      }
      handled = last.id;
      await frame.evaluate(scrollToLastMessage).catch(() => {});
      const options = await frame.evaluate(readQuickReplies).catch(() => []);
      // A salary in the vacancy's currency: its card and description (read before the application) tell
      const reply = await knownReplyInContexts(last, {
        readTemplates, readQADatabase, contexts: await loadAnswerContexts(), known: [...vacancyContext(vacancyId), ...chatContextTexts(chat)],
      });
      const asked = last.text.replace(/\s+/g, ' ').slice(0, 160);
      if (reply?.noReply) {
        log(`💬 ${last.title || 'Chat'}: ${asked} (no reply needed)`);
        // «Ваши ответы отправлены работодателю»: the bot is done
        if (!isQuestion(last.text)) {
          break;
        }
        quietSince = Date.now();
        continue;
      }
      const option = reply && options.length > 0 ? perfectOption(reply.answer, options) : null;
      const perfect = Boolean(reply?.perfect) && (options.length === 0 || option !== null);
      log(`💬 ${last.title || 'Chat'}: ${asked}${options.length > 0 ? ` [${options.join(' / ')}]` : ''}`);
      if (perfect && autoSend) {
        if (await sendChatAnswer(frame, last.id, { answer: reply.answer, option }).catch(() => false)) {
          log(`✅ Answered (perfect match, ${reply.source}): ${option ?? reply.answer}`);
          quietSince = Date.now();
          waitMs = nextMessageMs;
          continue;
        }
        log('⚠️  The answer did not show in the chat: left for you');
      }
      if (!isInteractive()) {
        log('💬 Not a perfect match: the chat is left for the chat processor');
        return;
      }
      if (reply && !option) {
        const input = frame.locator(INPUT).first();
        if (!(await input.inputValue().catch(() => '')).trim()) {
          await input.fill(reply.answer).catch(() => {});
        }
      }
      log(reply
        ? `✍️  Closest saved answer (${reply.source}: ${reply.matched.slice(0, 80)}): ${reply.answer}${options.length > 0 ? ' (typed: none of the buttons is this answer)' : ''}`
        : '❓ No saved answer');
      await frame.evaluate(scrollToLastMessage).catch(() => {});
      const choice = await waitForUser(frame, last.id);
      if (choice !== 'withdrawn') {
        return;
      }
      await learn(await frame.evaluate(readChat).catch(() => ({ messages: [] })));
      quietSince = Date.now();
      waitMs = nextMessageMs;
    }
    await closePanel();
  };
}
