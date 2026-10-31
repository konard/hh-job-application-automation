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
 * - a bot's offer to reuse the answers given before («Используем эти ответы?») is compared with
 *   the saved answers; the user chooses, or with autoReuse «Да» is clicked when all are the saved
 *   ones and «Нет» when one differs
 * - when the bot has nothing more to ask (hh.ru says the answers are passed to the employer), the
 *   panel is closed and the run goes on
 *
 * @module instant-chat
 */

import { chatContextTexts, compareReusedAnswers, describeReuse, isQuestion, isReuseOffer, isAnswersPassedNotice, knownReplyInContexts, pendingMessages, readChatIn, reuseOption } from './chat-answers.mjs';
import { normalizeQuestion } from './qa-database.mjs';
import { askUser, isInteractive, withdrawPrompt } from './confirmations.mjs';
import { extractVacancyId } from './hh-selectors.mjs';
import { answersInContexts, loadAnswerContexts } from './answer-contexts.mjs';
import { createChatHistory, replyVariants, varyReply } from './chat-history.mjs';
import { learnChatQuestions } from './chat-learning.mjs';
import { answerWasRepeated, chooseChatOption, requiresChatOption } from './chat-options.mjs';
import { readChatChoiceControls, readQuickReplies, clearAutomaticChatDraft, prefillSavedChatAnswer } from './chat-choice-controls.mjs';
export { perfectOption } from './chat-options.mjs';
export { readQuickReplies } from './chat-choice-controls.mjs';

/** The panel's chat is a frame of chatik.hh.ru */
const CHAT_FRAME = /^https:\/\/chatik\.hh\.ru\/chat\/(\d+)/;
const INPUT = 'textarea[data-qa="text-input"]';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * hh.ru's notice that the bot passed the answers to the employer: nothing more is asked
 * @param {{text: string}} message
 * @returns {boolean}
 */
export const answersPassed = (message) => isAnswersPassedNotice(message?.text ?? '');

/**
 * Runs in the chat frame: the reply buttons the bot offers under its last message
 * @returns {string[]}
 */
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

/** The user's own message after the given one appeared */
const answeredAfter = (chat, messageId) => {
  const index = chat?.messages.findIndex((message) => message.id === messageId) ?? -1;
  return index >= 0 && chat.messages.slice(index + 1).some((message) => message.mine);
};

async function waitForAnswer(frame, messageId, ms) {
  for (const started = Date.now(); Date.now() - started < ms; await sleep(500)) {
    if (answeredAfter(await readChatIn(frame).catch(() => null), messageId)) {
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
export async function sendChatAnswer(frame, messageId, { answer, option, maySend = async () => true, preserveDraft = false }) {
  if (!await maySend()) return false;
  if ((await readChatIn(frame)).transitioning) return false;
  const controls = await frame.evaluate(readChatChoiceControls);
  if (controls.optionMessageId !== String(messageId)) return false;
  if (option) {
    const index = controls.options.indexOf(option);
    if (index < 0 || !await clearAutomaticChatDraft(frame, messageId) || !await maySend()) return false;
    await frame.locator(`[data-hh-chat-option="${messageId}:${index}"]`).click({ timeout: 5000 });
  } else {
    if (controls.strictOptions) return false;
    const input = frame.locator(INPUT).first();
    const before = await input.evaluate(e => ({ value: e.value, owned: e.dataset.hhAutomaticChatDraft,
      review: e.dataset.hhAnswerDraft, reviewMessageId: e.dataset.hhDraftMessageId }));
    let owned;
    try { owned = JSON.parse(before.owned); } catch { /* User drafts have no automation marker. */ }
    if (before.value.trim() && (preserveDraft ||
      (before.review && (!before.reviewMessageId || before.reviewMessageId === String(messageId))) ||
      owned?.messageId !== String(messageId) || owned?.value !== before.value)) return false;
    await input.fill(answer);
    await input.evaluate((e, owned) => { if (e.value === owned.value) e.dataset.hhAutomaticChatDraft = JSON.stringify(owned); },
      { messageId: String(messageId), value: answer });
    await sleep(500);
    const fresh = await frame.evaluate(readChatChoiceControls);
    if (fresh.strictOptions || fresh.optionMessageId !== String(messageId) || (await readChatIn(frame)).transitioning) {
      await clearAutomaticChatDraft(frame, messageId);
      return false;
    }
    if (!await maySend() || await input.inputValue() !== answer) return false;
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
 * @param {boolean} [options.autoReuse] - Answer a bot's offer to reuse earlier answers by comparing them (--auto-reuse-answers)
 * @param {Function} options.closePanel - Closes the chat panel
 * @param {(vacancyId: string|null) => string[]} [options.vacancyContext] - The vacancy's card and
 *   description, for the answers' contexts (answer-contexts.mjs)
 * @param {number} [options.firstMessageMs] - How long the first message of a bot is waited for
 * @param {number} [options.nextMessageMs] - How long the next question is waited for after an answer
 * @returns {(vacancyId: string|null) => Promise<void>}
 */
export function createInstantChat({
  page, readQADatabase, addOrUpdateQA, addQAIfMissing, readTemplates, autoSend, autoReuse = false, closePanel, contacts = {}, chatHistory = createChatHistory(), vacancyContext = () => [],
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
        const chatVacancy = extractVacancyId((await readChatIn(frame).catch(() => null))?.vacancyUrl ?? '');
        if (!vacancyId || chatVacancy === vacancyId) {
          return frame;
        }
      }
    }
    return null;
  }


  /** The bot's messages that came with reply buttons: questions, even without «?» */
  const buttonQuestions = new Set();

  /** Questions answered in the chat go to qa.lino: the user's answers, and the bot's summary of them */
  async function learn(chat) {
    await learnChatQuestions(chat, {
      history: chatHistory, qaDatabase: { readQADatabase, addOrUpdateQA, addQAIfMissing }, buttonQuestions, log,
    });
  }

  /** Wait until the user has answered the message in the panel, or typed y/s to move on */
  async function waitForUser(frame, messageId) {
    let done = false;
    const watcher = (async () => {
      while (!done) {
        await sleep(2000);
        const chat = await readChatIn(frame).catch(() => null);
        // Answered, or nothing can be answered any more
        if (answeredAfter(chat, messageId) || chat?.turnedOff) {
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

  /** @returns {Promise<boolean>} Whether the bot is done, so the panel can be closed */
  async function answerIn(frame, vacancyId) {
    let handled = null;
    let quietSince = Date.now();
    let waitMs = firstMessageMs;
    for (;;) {
      const chat = await readChatIn(frame).catch(() => null);
      // Closed by the user, or another chat opened in it
      const chatVacancy = extractVacancyId(chat?.vacancyUrl ?? '');
      if (!chat || frame.isDetached() || (vacancyId && chatVacancy && chatVacancy !== vacancyId)) {
        log('💬 The chat panel was closed or shows another chat: left as it is');
        return false;
      }
      if (chat.turnedOff) {
        log('💬 The employer turned the conversation off: the panel is closed and the run goes on');
        break;
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
      const options = await readQuickReplies(frame).catch(() => []);
      if (options.length > 0) {
        buttonQuestions.add(normalizeQuestion(last.text));
      }
      const contexts = await loadAnswerContexts();
      const known = [...await vacancyContext(vacancyId), ...chatContextTexts(chat)];
      if (isReuseOffer(last.text)) {
        const inContexts = answersInContexts(readQADatabase, contexts);
        const compared = await compareReusedAnswers(chat.messages, (question) => inContexts(question, known));
        log(describeReuse(compared));
        const option = reuseOption(compared.decision, options);
        if (autoReuse && option) {
          if (await sendChatAnswer(frame, last.id, { answer: option, option }).catch(() => false)) {
            log(`✅ Chose: ${option}`);
            quietSince = Date.now();
            waitMs = nextMessageMs;
            continue;
          }
          log('⚠️  The choice did not show in the chat: left for you');
        }
        if (!isInteractive()) {
          return false;
        }
        const choice = await waitForUser(frame, last.id);
        if (choice !== 'withdrawn') {
          return false;
        }
        quietSince = Date.now();
        waitMs = nextMessageMs;
        continue;
      }
      if (answersPassed(last)) {
        log(`💬 ${last.title || 'Chat'}: ${last.text.replace(/\s+/g, ' ').slice(0, 160)} (the bot is done)`);
        break;
      }
      // A salary in the vacancy's currency: its card and description (read before the application) tell
      // A template message: one of the replies the user has given to it
      const reply = varyReply(await knownReplyInContexts(last, { readTemplates, readQADatabase, contexts, known }),
        replyVariants(await chatHistory.read(), await readTemplates()));
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
      const selection = chooseChatOption({ question: last.text, reply, options, contacts, history: await chatHistory.read() });
      const option = selection?.option ?? null;
      const perfect = option ? selection.autoSend : Boolean(reply?.perfect) && options.length === 0;
      log(`💬 ${last.title || 'Chat'}: ${asked}${options.length > 0 ? ` [${options.join(' / ')}]` : ''}`);
      if (perfect && autoSend && !answerWasRepeated(chat, last, option ?? reply.answer)) {
        if (await sendChatAnswer(frame, last.id, { answer: option ?? reply.answer, option }).catch(() => false)) {
          log(`✅ Answered (${selection?.reason ?? reply.source}): ${option ?? reply.answer}`);
          quietSince = Date.now();
          waitMs = nextMessageMs;
          continue;
        }
        log('⚠️  The answer did not show in the chat: left for you');
      }
      if (!isInteractive()) {
        log('💬 Not a perfect match: the chat is left for the chat processor');
        return false;
      }
      if (reply && !option && !requiresChatOption(last.text, options, chat.strictOptions) && !answerWasRepeated(chat, last, reply.answer)) {
        const input = frame.locator(INPUT).first();
        if (!(await input.inputValue().catch(() => '')).trim()) {
          await prefillSavedChatAnswer(frame, last.id, reply.answer).catch(() => {});
        }
      }
      log(reply
        ? `✍️  Closest saved answer (${reply.source}: ${reply.matched.slice(0, 80)}): ${reply.answer}${options.length > 0 ? ' (typed: none of the buttons is this answer)' : ''}`
        : '❓ No saved answer');
      await frame.evaluate(scrollToLastMessage).catch(() => {});
      const choice = await waitForUser(frame, last.id);
      if (choice !== 'withdrawn') {
        return false;
      }
      await learn(await readChatIn(frame).catch(() => ({ messages: [] })));
      quietSince = Date.now();
      waitMs = nextMessageMs;
    }
    return true;
  }

  return async function answerInstantChat(vacancyId) {
    const frame = await waitForChat(vacancyId, 10000);
    if (!frame) {
      log('💬 hh.ru opened no chat panel for this application');
      return;
    }
    buttonQuestions.clear();
    let botDone = false;
    try {
      botDone = await answerIn(frame, vacancyId);
    } finally {
      // Whatever was answered is saved for the next time, however the chat ended
      const chat = await readChatIn(frame).catch(() => null);
      if (chat) {
        await learn(chat).catch((error) => log(`⚠️  Chat recording failed: ${error.message}`));
      }
    }
    if (botDone) {
      await closePanel();
    }
  };
}
