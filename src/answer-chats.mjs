#!/usr/bin/env bun
/**
 * Answers in hh.ru chats, prefilled for review: `bun run answer-chats -- [<chat url or id> ...] [--watch]`
 *
 * The chats open in their own browser slot (port 9340, profile ~/.hh-automation/chat-slot), logged
 * in with the hh.ru session of the automation browser. For the employer's or bot's message waiting
 * for an answer, the reply is typed into the message field: a saved template reply, a saved answer
 * of a similar question, or a draft by local Claude Code. Nothing is sent: the user checks, changes
 * and sends it. Questionnaire links in messages are prefilled in form slots. What the user has
 * answered in a chat is learned (qa.lino, chat-templates.lino).
 *
 * --watch goes through the chats whose last message is not the user's (new chats right after an
 * application among them), one at a time, waiting until the user sends or skips (s) before the next.
 */

import fs from 'fs/promises';
import path from 'path';
import { openSlot } from './browser-slots.mjs';
import { seedHhSession } from './login.mjs';
import { askUser, enableConfirmations, withdrawPrompt } from './confirmations.mjs';
import { createQADatabase, findBestMatch } from './qa-database.mjs';
import { contractContacts, withContacts } from './contacts.mjs';
import { askClaude, plainText, relatedAnswers } from './form-prefill.mjs';
import { loadAnswerSources, prefillForms, waitForCaptcha } from './form-slots.mjs';
import { rememberFormVacancy } from './assignments.mjs';
import { answersInContexts, loadAnswerContexts } from './answer-contexts.mjs';
import { fetchVacancy } from './vacancy-context.mjs';
import {
  TEMPLATE_THRESHOLD, chatDraftPrompt, chatsShown, compareReusedAnswers, describeReuse, formLinks, isChatAnswered, isConversationFinished, isPattern, isQuestion, isSupportChat, isApplication, isRejection, isRejectionCell, knownReply, isReuseOffer, chatContextTexts, knownReplyInContexts, reuseOption, learnedPairs, pendingMessages, readChatIn, readChatList, readUserActivity, scrollChatList, templateCore, withLearnedPatterns,
  userIsActive,
} from './chat-answers.mjs';
import { readQuickReplies, sendChatAnswer } from './instant-chat.mjs';
import { answerWasRepeated, chooseChatOption, requiresChatOption } from './chat-options.mjs';
import { blockHangingHosts } from './hanging-hosts.mjs';
import { createHumanInput } from './helpers/human-input.mjs';
import { createSkippedVacancies, isSkippedForGood, SKIP_REASONS } from './skipped-vacancies.mjs';
import { createVacancyFilters, describeFilterMatch } from './vacancy-filters.mjs';
import { extractVacancyId } from './hh-selectors.mjs';
import { recordEvent } from './stats.mjs';
import { createChatHistory, replyVariants, varyReply } from './chat-history.mjs';
import { learnChatQuestions } from './chat-learning.mjs';
import { readFullChat, setUnreadFilter, waitForChat, watchChats } from './chat-recording.mjs';
import { createChatPrefillQueue } from './chat-prefill-queue.mjs';
import { createBackgroundRejectionSweep } from './background-rejections.mjs';
import { browserWindowActive } from './notify.mjs';
import { getAnswerFinalPeriod } from './answer-variants.mjs';

const USAGE = `Usage: bun run answer-chats -- [<chat url or id> ...] [options]

  --watch                Go through the chats waiting for an answer, one at a time, and keep watching
  --auto                 Unread chats only, without prompts (apply --process-chats): the rejections are cleared
                         first, then chats that need nothing
                         sent are handled; at the first one that needs a message (a reply typed or drafted
                         for you to check, or none found) it stops with that chat open and waits until you
                         have answered it
  --clear-rejections     In an inactive window, open unread rejections («Отказ») from the chat list, so they leave the unread
                         chats; nothing is typed in them (apply runs it by default every 2 hours). An unread
                         template message (a saved one word for word, «Спасибо за отклик! Мы рассмотрим Ваше
                         резюме…») is read too, and with --auto-send answered with its reply. Between
                         those passes the unread list is checked every 10 seconds in the background; the current
                         chat, draft, filter and list position are restored afterwards. Returning to the window stops the pass.
  --no-live-rejections   Read rejections only in the scheduled passes, without the background checks between them
  --auto-reuse           Answer a recruiter bot's offer to reuse earlier answers («Используем эти ответы?»): «Да»
                         when each is the saved answer, «Нет» when one differs; without it you choose
  --auto-send            Send an exact answer (the saved question word for word, or a bot's button that is the saved
                         answer); everything else is only typed in for you (apply passes --auto-send-exact-answers)
  --no-draft             Do not draft unknown answers with local Claude Code
  --no-forms             Do not prefill questionnaire links from chats
  --no-learn             Do not save the answers you send in those questionnaires to data/qa.lino
  --answer-final-period <with|without>
                         Resolve existing final-period answer conflicts in this style (default: with)
  --learn-all            Read every chat, including older message pages, slowly, in a window
                         of its own (port 9341), and save
                         the answers you sent (qa.lino, chat-templates.lino and all variants in
                         logs/chat-history.json). Opening an unread chat marks it read
  --relearn              Learn the answers again from logs/chat-history.json, without opening hh.ru
  --poll <seconds>       How often the chat list is checked in --watch / --auto (default 300)`;

function parseArgs(args) {
  const parsed = { chats: [], watch: false, learnAll: false, relearn: false, auto: false, clearRejections: false, liveRejections: true, autoSend: false, autoReuse: false, draft: true, forms: true, learn: true, poll: 300 };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=');
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (flag === '--watch') {
      parsed.watch = true;
    } else if (flag === '--learn-all') {
      parsed.learnAll = true;
    } else if (flag === '--relearn') {
      parsed.relearn = true;
    } else if (flag === '--auto-send') {
      parsed.autoSend = true;
    } else if (flag === '--auto-reuse') {
      parsed.autoReuse = true;
    } else if (flag === '--clear-rejections') {
      parsed.clearRejections = true;
      parsed.watch = true;
    } else if (flag === '--auto') {
      parsed.auto = true;
      parsed.watch = true; // --auto implies watch mode
    } else if (flag === '--no-live-rejections') {
      parsed.liveRejections = false;
    } else if (flag === '--no-draft') {
      parsed.draft = false;
    } else if (flag === '--no-forms') {
      parsed.forms = false;
    } else if (flag === '--no-learn') {
      parsed.learn = false;
    } else if (flag === '--poll') {
      parsed.poll = Number(inline ?? args[++i]);
    } else if (flag === '--answer-final-period') {
      const style = inline ?? args[++i];
      process.env.ANSWER_FINAL_PERIOD = getAnswerFinalPeriod({ env: { ANSWER_FINAL_PERIOD: style ?? '' } });
    } else {
      parsed.chats.push(args[i].match(/(\d{6,})/)?.[1] ?? args[i]);
    }
  }
  if (parsed.chats.length === 0 && !parsed.watch && !parsed.learnAll && !parsed.relearn) {
    console.log(USAGE);
    process.exit(1);
  }
  return parsed;
}

const argv = parseArgs(process.argv.slice(2));
const CHAT_SLOT_PORT = 9340;
// --learn-all reads the chat history in a window of its own, apart from the chat window the user answers in
const CHAT_HISTORY_PORT = 9341;
const AUTOMATION_PORT = 9322;
const MESSAGE_INPUT = 'textarea[data-qa="text-input"]';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chatUrl = (id) => `https://hh.ru/chat/${id}`;
/** A person's pause between chats: a few seconds, never the same */
const humanPause = (fromMs = 3000, toMs = 7000) => sleep(fromMs + Math.random() * (toMs - fromMs));

/** Where the chat list is scrolled, and its place on screen; null without a list */
const listPosition = () => page.evaluate(scrollChatList, null).catch(() => null);

/** The mouse wheel turned over the chat list, as a person scrolls it (the pointer glides over it first) */
async function wheelChatList(by) {
  const at = await listPosition();
  if (!at) {
    return null;
  }
  const pointer = human.position();
  if (pointer.x < at.x || pointer.x > at.x + at.width || pointer.y < at.y || pointer.y > at.y + at.view) {
    await human.moveTo(at.x + at.width * (0.3 + Math.random() * 0.4), at.y + at.view * (0.3 + Math.random() * 0.4));
  }
  await human.scroll(by);
  await sleep(250 + Math.random() * 250);
  return listPosition();
}

/** The list wheeled back up to its top */
async function wheelToTop(canContinue = async () => true) {
  for (let at = await listPosition(); at && at.top > 0; ) {
    if (!await canContinue()) return;
    const before = at.top;
    at = await wheelChatList(-Math.round(at.view * (0.6 + Math.random() * 0.3)));
    if (!at || at.top >= before) {
      break;
    }
  }
}

/** At the list's end hh.ru loads the next older chats (about 20, in a few seconds): whether it did */
async function moreChatsLoaded(height) {
  const before = new Set((await page.evaluate(readChatList)).map(({ id }) => id));
  for (const started = Date.now(); Date.now() - started < 15000; await sleep(500)) {
    if ((await listPosition())?.height > height ||
      (await page.evaluate(readChatList)).some(({ id }) => !before.has(id))) {
      return true;
    }
  }
  return false;
}

/** The chats wholly on screen in the list, from the top (chatsShown) */
async function chatsOnScreen() {
  const at = await listPosition();
  return chatsShown(await page.evaluate(readChatList).catch(() => []), at);
}

/**
 * Go down the chat list as a person does: from its top, the chats on screen one by one, then the
 * list wheeled on a little; at its end hh.ru loads the older chats. The page is not reloaded and
 * the list does not jump
 * @param {(chat: Object) => Promise<boolean>} visit - Each chat once; true stops the walk
 * @returns {Promise<boolean>} Whether a visit stopped it
 */
async function walkChatList(visit, { canContinue = async () => true } = {}) {
  if (!await canContinue()) return true;
  await wheelToTop(canContinue);
  const done = new Set();
  for (;;) {
    if (!await canContinue()) return true;
    const next = (await chatsOnScreen()).find((chat) => !done.has(chat.id));
    if (next) {
      done.add(next.id);
      if (await visit(next)) {
        return true;
      }
      continue;
    }
    const at = await listPosition();
    if (!at || (at.top + at.view >= at.height - 5 && !await moreChatsLoaded(at.height))) {
      return false;
    }
    await wheelChatList(Math.round(at.view * (0.5 + Math.random() * 0.25)));
    await humanPause(500, 1200);
  }
}

/**
 * The list's «Только непрочитанные» filter. The page holds two copies of it, one label in the
 * other: the outer one (without a data-qa) is the filter the list follows. A click on the checkbox
 * sets the inner copy first, the outer one from then on (a click on the label's text sets neither)
 */
const unreadOnlyBox = () => page.locator('input[data-qa="chatik-checkbox-only-unread"]').first();
const UNREAD_ONLY_INPUTS = 'label:has(input[data-qa="chatik-checkbox-only-unread"]) input[type="checkbox"]';

/** @returns {Promise<boolean|null>} Whether the filter is set; null without it on the page */
async function unreadOnlyIsSet(timeout) {
  if (!await unreadOnlyBox().waitFor({ state: 'attached', timeout }).then(() => true, () => false)) {
    return null;
  }
  return page.locator(UNREAD_ONLY_INPUTS).evaluateAll((inputs) => (inputs.find((input) => !input.dataset.qa) ?? inputs[0])?.checked ?? null)
    .catch(() => null);
}

/**
 * The list's «Только непрочитанные» filter set as wanted, its checkbox clicked as a person does
 * @returns {Promise<{was: boolean|null, is: boolean|null}>} How it was, and how it is now
 */
async function showUnreadOnly(want) {
  const was = await unreadOnlyIsSet(10000);
  let is = was;
  for (let clicks = 0; is !== null && is !== want && clicks < 3; clicks += 1) {
    await humanPause(800, 1500);
    await page.evaluate(setUnreadFilter, want);
    await humanPause(1500, 2500);
    is = await unreadOnlyIsSet(5000);
  }
  return { was, is };
}

/**
 * The chat page opened (once a pass, as a person opens it), its list shown; false behind a captcha.
 * hh.ru sometimes stops sending the page halfway: one that shows neither chats nor the list's
 * filter is opened again, up to 3 times
 */
async function openChatPage() {
  if (page.isClosed()) {
    console.log('🪟 The chat window was closed: opening it again');
    await openChatTab();
  }
  for (let attempt = 1; ; attempt += 1) {
    await page.goto('https://hh.ru/chat', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const shown = await page.waitForSelector('[data-qa^="chatik-open-chat-"], input[data-qa="chatik-checkbox-only-unread"]', { state: 'attached', timeout: 20000 })
      .then(() => true, () => false);
    if (shown || attempt >= 3 || !await waitForCaptcha(page, console.log, 'chat', CHAT_SLOT_PORT)) {
      break;
    }
    console.log(`🔄 The chat page did not load (attempt ${attempt} of 3): opening it again`);
    await humanPause(5000, 10000);
  }
  return waitForCaptcha(page, console.log, 'chat', CHAT_SLOT_PORT);
}

const sources = await loadAnswerSources();
// Template replies may hold contact placeholders too
const templatesFile = createQADatabase(path.join(process.cwd(), 'data', 'chat-templates.lino'));
const templatesDb = withContacts(templatesFile, sources.contacts);
const handledForms = new Set();
// Every chat read, kept: the answers can be learned again from it, and a template gets one of the user's replies
const chatHistory = createChatHistory();
const vacancyPages = new Map();
/** The vacancy page's pay, title and description, read once a run */
async function vacancyTexts(url) {
  if (!url) {
    return [];
  }
  if (!vacancyPages.has(url)) {
    vacancyPages.set(url, fetchVacancy(url).then((vacancy) => (vacancy ? [vacancy.salary, vacancy.title, vacancy.description] : [])));
  }
  return vacancyPages.get(url);
}
const skippedVacancies = createSkippedVacancies(path.join(process.cwd(), 'data', 'skipped-vacancies.lino'));
const vacancyFilters = createVacancyFilters({
  rulesPath: path.join(process.cwd(), 'data', 'vacancy-filters.lino'),
  filteredPath: path.join(process.cwd(), 'data', 'filtered-vacancies.lino'),
});

/**
 * Why the chat's vacancy gets no reply: on the skip list, filtered out before, or its name matches a
 * vacancy filter (data/vacancy-filters.lino); null when it is answered
 * @param {{vacancy: string, vacancyUrl: string}} chat - From readChat
 * @returns {Promise<string|null>}
 */
async function leftAloneBecause(chat) {
  const vacancyId = extractVacancyId(chat.vacancyUrl ?? '');
  const skipped = vacancyId ? (await skippedVacancies.read()).get(vacancyId) : null;
  if (skipped && isSkippedForGood(skipped)) {
    return `on the skip list (${SKIP_REASONS[skipped.reason]?.text ?? skipped.reason})`;
  }
  if (vacancyId && (await vacancyFilters.filteredVacancyIds()).has(vacancyId)) {
    return 'filtered out before (data/filtered-vacancies.lino)';
  }
  const match = await vacancyFilters.match({ vacancy: chat.vacancy ?? '' });
  return match ? `filtered out: ${describeFilterMatch(match)}` : null;
}

const THIRD_PARTY_CONTACT = /\+?\d[\d\s()-]{8,}\d|t\.me\/|@[A-Za-z]\w{3,}/;

// The answers learned again from the chats kept, without a browser
if (argv.relearn) {
  await chatHistory.recount();
  const history = await chatHistory.read();
  const before = (await sources.qaDatabase.readSavedQADatabase()).size;
  for (const chat of Object.values(history)) {
    await learn(chat);
  }
  const after = (await sources.qaDatabase.readSavedQADatabase()).size;
  console.log(`📚 Learned again from ${Object.keys(history).length} chat(s) kept in logs/chat-history.json: ${after - before} new answer(s) in qa.lino`);
  process.exit(0);
}

let session;
let page;
let human;
let chatRecording;
let passRunning = false;
let backgroundRejections;
let stuckChat = null;
const prefilledMessages = new Set();
const handledChoices = new Set();
const livePrefill = createChatPrefillQueue({
  busy: async (frame) => passRunning || backgroundRejections?.running || (!frame.isDetached() &&
    await frame.evaluate(() => Boolean(window.__chatAutomating)).catch(() => false)),
  write: writeSavedChat,
  onError: (error) => console.log(`⚠️  Saved answer prefill failed: ${error.message}`),
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    livePrefill.stop();
    await backgroundRejections?.stop();
    await chatRecording?.flush();
    await session?.release();
    process.exit(0);
  });
}
/** The chat slot's tab, opened again when its window was closed between checks */
async function openChatTab() {
  session = await openSlot(argv.learnAll
    ? { name: 'chat-history-slot', port: CHAT_HISTORY_PORT }
    : { name: 'chat-slot', port: CHAT_SLOT_PORT });
  ({ page } = session);
  // The pointer and the wheel move as a person's do, smooth on a screen recording
  human = createHumanInput(page);
  // Ad and tracker requests that hang kept the chat page loading for a minute
  await blockHangingHosts(page).catch(() => {});
  if (argv.learn) {
    chatRecording = await watchChats(page, {
      onChat: async (chat, frame) => {
        if (argv.learnAll) {
          await chatHistory.record(chat);
          return;
        }
        await learn(chat);
        await prefillSavedChat(chat, frame).catch((error) => {
          if (!/Execution context was destroyed|closed|detached/i.test(error.message)) {
            console.log(`⚠️  Saved answer prefill failed: ${error.message}`);
          }
        });
      },
      onError: (error) => console.log(`⚠️  Chat recording failed: ${error.message}`),
    });
    // watchChats already captures the open pane. A second startup prefill races its binding.
    await chatRecording.flush();
  }
}
await openChatTab();
await seedHhSession({ page, fromPort: AUTOMATION_PORT });
enableConfirmations({ steps: [], onStop: () => process.exit(0), input: process.stdin });

/** Save what the user has answered in the chat: questions to qa.lino, template messages to chat-templates.lino */
async function learn(chat) {
  await learnChatQuestions(chat, { history: chatHistory, qaDatabase: sources.qaDatabase });
  // The support chat is kept, its replies are not answers to employers
  if (isSupportChat(chat)) {
    return;
  }
  const kept = (await chatHistory.read())[chat.id] ?? chat;
  const { templates } = learnedPairs(kept.messages);
  sources.qaMap = await sources.qaDatabase.readQADatabase();
  const known = await templatesDb.readQADatabase();
  const examples = new Map([...known].filter(([key]) => !isPattern(key)));
  // Written to the file as it is stored: its placeholders kept, a new reply's contacts made placeholders
  const stored = await templatesFile.readQADatabase();
  let learned = false;
  for (const [message, reply] of templates) {
    // A message with someone's phone or Telegram link is theirs, not a template (and stays out of git)
    if (THIRD_PARTY_CONTACT.test(message)) {
      continue;
    }
    if (!findBestMatch(message, examples, { threshold: TEMPLATE_THRESHOLD })) {
      examples.set(message, reply);
      const answer = contractContacts(reply, sources.contacts);
      if (await templatesFile.addQAIfMissing(message, answer)) {
        stored.set(message, answer);
        learned = true;
        console.log(`💾 Learned a template reply (chat-templates.lino): ${message.split('\n')[0]}`);
      }
    }
  }
  if (learned) {
    // Template messages answered the same way are generalized into patterns
    const updated = withLearnedPatterns(stored);
    [...updated.keys()].filter((key) => isPattern(key) && !stored.has(key))
      .forEach((key) => console.log(`🧩 Learned a template pattern: ${key}`));
    for (const [key, answer] of updated) {
      if (!stored.has(key)) await templatesFile.addQAIfMissing(key, answer);
    }
  }
}

/**
 * Open a chat as a person does: its cell in the chat list on the left (on screen) is clicked. A chat
 * not in the list (a link given on the command line) is opened by its address
 */
async function openChat(id) {
  if (page.url().startsWith(chatUrl(id))) {
    await waitForChat(page, id);
    return;
  }
  const cell = page.locator(`[data-qa="chatik-open-chat-${id}"]`).first();
  if (await cell.count().catch(() => 0) > 0 && await human.click(cell)) {
    if (await page.waitForURL((url) => url.href.startsWith(chatUrl(id)), { timeout: 15000 }).then(() => true, () => false)) {
      await waitForChat(page, id);
      return;
    }
  }
  console.log(`🔗 Chat ${id} is not in the chat list: opened by its address`);
  await page.goto(chatUrl(id), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await waitForChat(page, id);
}

/** Prefill the reply to the waiting message; returns the id of the message it answers, or null */
async function prefillChat(id, depth = 0) {
  await openChat(id);
  if (!await waitForCaptcha(page, console.log, 'chat', CHAT_SLOT_PORT)) {
    return null;
  }
  await page.waitForSelector('[data-qa^="chatik-chat-message-"]', { timeout: 20000 }).catch(() => {});
  const chat = await readChatIn(page);
  await learn(chat);
  const pending = pendingMessages(chat.messages);
  if (pending.length === 0) {
    console.log(`💬 Chat ${id} (${chat.vacancy}): nothing waits for an answer`);
    return null;
  }
  const last = pending[pending.length - 1];
  const leftAlone = await leftAloneBecause(chat);
  if (leftAlone) {
    console.log(`⏭️  Chat ${id} (${chat.vacancy}): the vacancy is ${leftAlone}; read, no reply`);
    return null;
  }
  // Opening the chat has read it; a closed chat cannot be answered
  if (!chat.canReply) {
    console.log(`📭 Chat ${id} (${chat.vacancy}): ${isRejection(last) ? 'rejection' : 'message'} read; the chat is closed for replies`);
    return null;
  }
  console.log(`💬 Chat ${id} (${chat.vacancy}), ${last.title || 'employer'}: ${templateCore(last.text, { sender: last.title }).replace(/\s+/g, ' ').slice(0, 160)}`);

  const links = argv.forms ? formLinks(pending).filter((link) => !handledForms.has(link)) : [];
  if (links.length > 0) {
    links.forEach((link) => handledForms.add(link));
    console.log(`📝 Prefilling the questionnaire(s) from the chat in form slots: ${links.join(', ')}`);
    prefillForms(links, { draft: argv.draft, learn: argv.learn, sources, company: chat.company, vacancyUrl: chat.vacancyUrl })
      .then(async ({ reportFile, results }) => {
        console.log(`📄 Questionnaire report: ${reportFile}`);
        // A test assignment in the form takes the language and stack of this vacancy
        if (chat.vacancyUrl) {
          await rememberFormVacancy([...links, ...results.map((result) => result.pageUrl)], chat.vacancyUrl);
        }
      })
      .catch((error) => console.log(`⚠️  Questionnaire prefill failed: ${error.message}`));
  }

  // A bot offers the answers given before: compared with the saved ones, the user chooses
  if (isReuseOffer(last.text)) {
    const inContexts = answersInContexts(sources.qaDatabase.readQADatabase, await loadAnswerContexts());
    const compared = await compareReusedAnswers(chat.messages, (question) => inContexts(question, chatContextTexts(chat)));
    console.log(describeReuse(compared));
    const option = reuseOption(compared.decision, await page.evaluate(readQuickReplies).catch(() => []));
    if (argv.autoReuse && option && depth < 20) {
      if (await sendChatAnswer(page.mainFrame(), last.id, { answer: option, option }).catch(() => false)) {
        console.log(`✅ Chose: ${option}`);
        await sleep(3000);
        return prefillChat(id, depth + 1);
      }
      console.log('⚠️  The choice did not show in the chat: left for you');
    }
    console.log('👉 Choose in the chat yourself');
    return { id: last.id, replied: false, title: chat.vacancy };
  }
  // A salary in the vacancy's currency: the chat tells, else the vacancy page (read only when it matters)
  let reply = await knownReplyInContexts(last, {
    readTemplates: templatesDb.readQADatabase, readQADatabase: sources.qaDatabase.readQADatabase,
    contexts: await loadAnswerContexts(), known: chatContextTexts(chat), vacancyTexts: () => vacancyTexts(chat.vacancyUrl),
  });
  // A template message: one of the replies the user has given to it
  reply = varyReply(reply, replyVariants(await chatHistory.read(), await templatesDb.readQADatabase()));
  const options = await page.evaluate(readQuickReplies).catch(() => []);
  const choice = chooseChatOption({ question: last.text, reply, options, contacts: sources.contacts });
  if (!reply && !choice && !requiresChatOption(last.text, options) && argv.draft) {
    console.log('🤖 Drafting the reply with local Claude Code from the resume and qa.lino...');
    const drafted = await askClaude(chatDraftPrompt({
      vacancy: chat.vacancy, messages: chat.messages, resume: sources.resume, related: relatedAnswers(templateCore(last.text), sources.qaMap),
    }));
    reply = drafted && { answer: plainText(drafted), source: 'draft, check it' };
  }
  if (reply?.noReply) {
    console.log(`📭 No reply needed (${reply.source}${reply.matched ? `: ${reply.matched.slice(0, 80)}` : ''}): read`);
    return null;
  }
  if (!reply && !choice) {
    console.log('❓ No saved or drafted reply: answer it yourself');
    return { id: last.id, replied: false, title: chat.vacancy };
  }
  // An exact answer is sent (a bot's button when it offers one), and the bot's next question taken
  const option = choice?.option ?? null;
  const canSend = option ? choice.autoSend : reply?.perfect && options.length === 0;
  if (argv.autoSend && canSend && depth < 20 && !answerWasRepeated(chat, last, option ?? reply.answer)) {
    if (await sendChatAnswer(page.mainFrame(), last.id, { answer: option ?? reply.answer, option }).catch(() => false)) {
      console.log(`✅ Answered (${choice?.reason ?? reply.source}): ${option ?? reply.answer}`);
      await page.waitForFunction((id) => {
        const messages = [...document.querySelectorAll('[data-qa^="chatik-chat-message-"]')];
        return messages.length > 0 && !messages[messages.length - 1].getAttribute('data-qa').endsWith(id);
      }, last.id, { timeout: 15000 }).catch(() => {});
      await sleep(3000);
      return prefillChat(id, depth + 1);
    }
    console.log('⚠️  The answer did not show in the chat: typed in for you instead');
  }
  if (choice || requiresChatOption(last.text, options) || (reply && answerWasRepeated(chat, last, reply.answer))) {
    console.log('👉 Choose a button in the chat; free text is not prefilled for an option-only or repeated question');
    return { id: last.id, replied: false, title: chat.vacancy };
  }
  const input = page.locator(MESSAGE_INPUT).first();
  if ((await input.inputValue().catch(() => '')).trim()) {
    console.log('✋ The message field already has text: left as it is');
    return { id: last.id, replied: true, title: chat.vacancy };
  }
  await input.fill(reply.answer);
  console.log(`✍️  Typed the reply (${reply.source}${reply.matched ? `: ${reply.matched.slice(0, 80)}` : ''}): check it and send it yourself\n   ${reply.answer.replace(/\n/g, '\n   ')}`);
  return { id: last.id, replied: true, title: chat.vacancy };
}

/** Wait until the user has sent a message after the one answered, or chose to skip (s) */
async function waitForSend(answeredId) {
  let sent = false;
  const watcher = (async () => {
    while (!sent) {
      await sleep(3000);
      const chat = await readChatIn(page).catch(() => null);
      const index = chat?.messages.findIndex((message) => message.id === answeredId) ?? -1;
      if (index >= 0 && chat.messages.slice(index + 1).some((message) => message.mine)) {
        sent = true;
        await learn(chat);
        withdrawPrompt();
      }
    }
  })();
  const choice = await askUser('Send the reply in the chat slot (or type s to skip this chat)', { skip: 'skip this chat' });
  sent = true;
  await watcher.catch(() => {});
  return choice;
}

/**
 * Every chat already read, opened one by one as a person does, and what the user answered in it
 * saved: answers sent before learning was there, or while it did not run, are not lost
 */
async function learnFromAllChats() {
  if (!await openChatPage()) {
    return;
  }
  // Every chat, not only the unread ones; the filter is put back afterwards
  const { was: unreadOnly, is: filtered } = await showUnreadOnly(false);
  if (filtered !== false) throw new Error('The history list is still filtered; a full scan cannot start');
  const savedBefore = (await sources.qaDatabase.readSavedQADatabase()).size;
  // A preview is not a message ID: another answer can have the same last line. Read every
  // conversation again; the checkpoint describes coverage, rather than skipping on previews.
  const readFile = path.join(process.cwd(), 'logs', 'chats-learned.json');
  const readBefore = await fs.readFile(readFile, 'utf8').then(JSON.parse, () => ({}));
  let opened = 0;
  console.log('📚 Going down every chat and its older message pages for answers (unread chats are read too; ' +
    'chats with only the application, «Отклик на вакансию», are not opened)');
  await walkChatList(async (chat) => {
    if (await unreadOnlyIsSet(1000) !== false) {
      throw new Error('The unread-only filter changed during history learning; the scan is incomplete');
    }
    if (isApplication({ title: chat.last.trim() })) {
      return false;
    }
    await openChat(chat.id);
    if (!await waitForCaptcha(page, console.log, 'chat', CHAT_HISTORY_PORT)) {
      return true;
    }
    await page.waitForSelector('[data-qa^="chatik-chat-message-"]', { timeout: 20000 }).catch(() => {});
    const read = await readFullChat(page, { onRead: (snapshot) => chatHistory.record(snapshot) });
    if (read) {
      await learn({ ...read, id: read.id || chat.id });
      readBefore[chat.id] = { lastMessageId: read.messages.at(-1)?.id, historyComplete: read.historyComplete, recordingVersion: 2 };
      if (!read.historyComplete) console.log(`⚠️  Chat ${chat.id}: the start of the conversation was not reached; its history will be retried`);
      await fs.mkdir(path.dirname(readFile), { recursive: true });
      await fs.writeFile(readFile, JSON.stringify(readBefore));
    }
    if (++opened % 10 === 0) {
      console.log(`📚 ${opened} chats read`);
    }
    await humanPause();
    return false;
  });
  if (unreadOnly) {
    await showUnreadOnly(true);
  }
  const savedAfter = (await sources.qaDatabase.readSavedQADatabase()).size;
  console.log(`📚 Done: ${opened} chats read, ${savedAfter - savedBefore} new answer(s) saved to qa.lino`);
}

/**
 * The unread rejections opened one by one, going down the list: opening one reads it, so it leaves
 * the unread chats. Nothing is typed in a rejection
 * @returns {Promise<number|null>} How many were read; null behind a captcha
 */
async function clearRejections({
  onlyRejections = false, canContinue = async () => true, onNavigate = () => {},
  mayVisit = () => true, onAttempt = () => {}, live = false,
} = {}) {
  let rejections = 0;
  // The list line holds the whole last message: a saved template is known before the chat is opened
  const templates = onlyRejections ? new Map() : await templatesDb.readQADatabase();
  const stopped = await walkChatList(async (chat) => {
    const template = chat.unread && !isRejectionCell(chat) ? templateCell(chat, templates) : null;
    // A template to reply to is opened only when its reply is sent (--auto-send); otherwise it stays unread for you
    if (!chat.unread || !mayVisit(chat) || (!isRejectionCell(chat) && !(template && (template.noReply || argv.autoSend)))) {
      return false;
    }
    if (!await canContinue()) return true;
    onAttempt(chat);
    onNavigate(chatUrl(chat.id));
    await openChat(chat.id);
    if (!await waitForCaptcha(page, console.log, 'chat', CHAT_SLOT_PORT)) {
      return true;
    }
    if (template) {
      await answerTemplate(chat);
    } else {
      rejections += 1;
      console.log(`📭 Chat ${chat.id} (${chat.title}): rejection read`);
      recordEvent('rejection_read', { chatId: chat.id, live });
    }
    await humanPause();
    return false;
  }, { canContinue });
  return stopped ? null : rejections;
}

/**
 * An unread chat whose last message, as its list line shows it, is a saved template word for word
 * (greeting and signature aside), not a question
 * @returns {Object|null} knownReply
 */
function templateCell(chat, templates) {
  if (chat.lastIsMine || !chat.last || isQuestion(chat.last)) {
    return null;
  }
  const reply = knownReply({ title: '', text: chat.last }, { templates, qaMap: new Map() });
  return reply?.perfect && reply.source.startsWith('chat-templates') ? reply : null;
}

/**
 * The open chat's template message answered with its reply (one of those the user gave to it), or
 * only read when it needs none. A chat with more waiting than the template is left for the user
 */
async function answerTemplate(chat) {
  const read = await waitForChat(page, chat.id).catch(() => null);
  if (!read) {
    return;
  }
  await learn({ ...read, id: read.id || chat.id });
  const pending = pendingMessages(read.messages);
  const last = pending.at(-1);
  if (!last) {
    return;
  }
  const reply = varyReply(await knownReplyInContexts(last, {
    readTemplates: templatesDb.readQADatabase, readQADatabase: sources.qaDatabase.readQADatabase,
    contexts: await loadAnswerContexts(), known: chatContextTexts(read),
  }), replyVariants(await chatHistory.read(), await templatesDb.readQADatabase()));
  const about = templateCore(last.text, { sender: last.title }).replace(/\s+/g, ' ').slice(0, 100);
  if (reply?.noReply) {
    console.log(`📭 Chat ${chat.id} (${chat.title}): «${about}» read, no reply needed`);
    return;
  }
  if (!reply?.perfect || !reply.source.startsWith('chat-templates') || pending.length > 1 || !read.canReply || !argv.autoSend) {
    console.log(`👉 Chat ${chat.id} (${chat.title}): more than a template waits in it, left for you`);
    return;
  }
  if (await sendChatAnswer(page.mainFrame(), last.id, { answer: reply.answer, option: null }).catch(() => false)) {
    console.log(`✅ Chat ${chat.id} (${chat.title}): «${about}» answered: ${reply.answer}`);
    recordEvent('template_answered', { chatId: chat.id });
  } else {
    console.log(`⚠️  Chat ${chat.id} (${chat.title}): the reply did not show in the chat, left for you`);
  }
}

if (argv.learnAll) {
  await learnFromAllChats();
  await session.release();
  process.exit(0);
}

passRunning = true;
for (const id of argv.chats) {
  const answered = await prefillChat(id);
  if (answered && !argv.auto && (argv.watch || argv.chats.length > 1)) {
    await waitForSend(answered.id);
  }
}
passRunning = false;

/**
 * A new question shown in the user's chat gets its saved answers, without navigating, sending
 * anything, or replacing a draft already typed by the user.
 */
function prefillSavedChat(chat, frame) {
  return livePrefill.enqueue(chat, frame);
}

async function writeSavedChat(chat, frame) {
  if (frame.isDetached()) return;
  const last = pendingMessages(chat.messages).at(-1);
  const key = `${chat.id}/${last?.id}`;
  if (!last || chat.transitioning || !chat.canReply || isSupportChat(chat) || isConversationFinished(chat) ||
    isReuseOffer(last.text) || isRejection(last) || await leftAloneBecause(chat)) return;
  const reply = await knownReplyInContexts(last, {
    readTemplates: templatesDb.readQADatabase, readQADatabase: sources.qaDatabase.readQADatabase,
    contexts: await loadAnswerContexts(), known: chatContextTexts(chat),
  });
  const options = chat.options ?? await frame.evaluate(readQuickReplies).catch(() => []);
  const choice = chooseChatOption({ question: last.text, reply, options, contacts: sources.contacts });
  if ((!reply?.answer && !choice) || reply?.noReply || frame.isDetached()) return;
  // Recheck after looking up the answer: the user may already have moved to another chat.
  const current = await readChatIn(frame);
  if (current.transitioning || current.id !== chat.id || pendingMessages(current.messages).at(-1)?.id !== last.id) return;
  if (passRunning || backgroundRejections?.running || await frame.evaluate(() => Boolean(window.__chatAutomating))) return false;
  const input = frame.locator(MESSAGE_INPUT).first();
  const draft = (await input.inputValue({ timeout: 1000 }).catch(() => '')).trim();
  if (choice?.autoSend && argv.autoSend && !handledChoices.has(key) &&
    !answerWasRepeated(chat, last, choice.option) && (!draft || draft === reply?.answer?.trim())) {
    handledChoices.add(key);
    if (await sendChatAnswer(frame, last.id, { answer: choice.option, option: choice.option }).catch(() => false)) {
      console.log(`✅ Selected in chat ${chat.id}: ${choice.option} (${choice.reason})`);
    } else console.log(`⚠️  The selected option did not show in chat ${chat.id}; left for review`);
    return;
  }
  if (prefilledMessages.has(key) || draft || requiresChatOption(last.text, options) || !reply?.answer) return;
  if (answerWasRepeated(chat, last, reply.answer)) {
    prefilledMessages.add(key);
    console.log(`👉 Chat ${chat.id}: the bot repeated this question after that answer; the same text is not prefilled again`);
    return;
  }
  await input.fill(reply.answer, { timeout: 1000 });
  prefilledMessages.add(key);
  console.log(`✍️  Saved answer prefilled in chat ${chat.id}: check it and send it yourself\n   ${reply.answer}`);
}

/** Where the chat window was at the last check: the user moving in it since, or typing, delays the next pass */
let seenUrl = null;
async function userIsInTheWindow() {
  if (backgroundRejections?.running) return true;
  if (await browserWindowActive(page, { port: CHAT_SLOT_PORT }) !== false) return true;
  const user = await page.evaluate(readUserActivity).catch(() => null);
  const moved = seenUrl !== null && !page.isClosed() && page.url() !== seenUrl;
  seenUrl = page.isClosed() ? null : page.url();
  return userIsActive(user) || moved;
}

// A chat whose click did not open it is tried again after this
const LIVE_RETRY_MS = 5 * 60 * 1000;

/** Background passes cover the entire unread list and always return to the user's chat. */
function makeBackgroundRejections() {
  const tried = new Map();
  const triedKey = (chat) => `${chat.id}\n${chat.last}`;
  return createBackgroundRejectionSweep({
    getPage: () => page,
    onFinished: (id) => { if (stuckChat?.id === id) stuckChat = null; },
    isActive: () => browserWindowActive(page, { port: CHAT_SLOT_PORT }),
    blocked: () => passRunning || !/^https:\/\/hh\.ru\/(?:chat(?:\/|$|\?)|applicant\/profile\/me(?:$|\?))/.test(page.url()),
    scan: async ({ canContinue, onNavigate, includeTemplates = false }) => {
      if (!await canContinue()) return null;
      if (!/^https:\/\/hh\.ru\/chat(?:\/|$|\?)/.test(page.url())) {
        onNavigate('https://hh.ru/chat');
        if (!await openChatPage() || !await canContinue()) return null;
      }
      if ((await showUnreadOnly(true)).is !== true || !await canContinue()) return null;
      return clearRejections({
        onlyRejections: !includeTemplates, canContinue, onNavigate, live: true,
        mayVisit: (chat) => Date.now() - (tried.get(triedKey(chat)) ?? 0) >= LIVE_RETRY_MS,
        onAttempt: (chat) => tried.set(triedKey(chat), Date.now()),
      });
    },
  });
}

function readRejectionsAsTheyShow() {
  const timer = setInterval(async () => {
    try { await backgroundRejections.run({ includeTemplates: true }); }
    catch (error) { console.log(`⚠️  Background rejections: ${error.message.split('\n')[0]}`); }
    finally {
      seenUrl = page.isClosed() ? null : page.url();
    }
  }, 10000);
  timer.unref();
}

if (argv.watch) {
  // A chat is seen again when its last message changes (the employer wrote again)
  const seen = new Set();
  const seenKey = (chat) => `${chat.id}\n${chat.last}`;
  // --auto: the chat left open for the user; nothing else is processed until it is answered
  // The pass over the chat list is going: the window is left to it
  backgroundRejections = makeBackgroundRejections();
  if (argv.liveRejections && (argv.auto || argv.clearRejections)) readRejectionsAsTheyShow();
  console.log(argv.auto
    ? `💬 Processing unread chats every ${argv.poll} s (rejections first)`
    : argv.clearRejections ? `📭 Clearing unread rejections every ${argv.poll} s` : `👀 Watching the chat list every ${argv.poll} s for messages waiting for an answer`);
  for (;;) {
    if (argv.clearRejections && !argv.auto) {
      try { await backgroundRejections.run({ includeTemplates: true }); }
      catch (error) { console.log(`⚠️  Background chat check: ${error.message.split('\n')[0]}`); }
      seenUrl = page.isClosed() ? null : page.url();
      await sleep(argv.poll * 1000);
      continue;
    }
    if (stuckChat) {
      // Read where it was left (the typed reply stays), without the chat list
      if (!page.url().startsWith(chatUrl(stuckChat.id))) {
        await page.goto(chatUrl(stuckChat.id), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      const chat = await readChatIn(page).catch(() => null);
      if (!chat || !isChatAnswered(chat)) {
        await sleep(argv.poll * 1000);
        continue;
      }
      console.log(`💬 Chat answered, processing unread chats again: ${stuckChat.title}`);
      stuckChat = null;
    }
    // The window is the user's while they use it: the pass waits for them
    if (await userIsInTheWindow()) {
      console.log('⏸️  The chat window is in use: the chat check waits 5 min');
      await sleep(300 * 1000);
      continue;
    }
    passRunning = true;
    if (!await openChatPage()) {
      passRunning = false;
      await sleep(argv.poll * 1000);
      continue;
    }
    // Only the unread chats are gone through: without the filter the whole list would be scrolled
    if ((argv.auto || argv.clearRejections) && (await showUnreadOnly(true)).is !== true) {
      console.log('⚠️  The «Только непрочитанные» filter could not be set: the chats are left for the next check');
    } else if (argv.auto) {
      let opened = 0;
      // Rejections first, always before any chat is answered
      const rejections = await clearRejections();
      if (rejections === null) {
        passRunning = false;
        await sleep(argv.poll * 1000);
        continue;
      }
      // Then the unread chats from the top; the first that needs the user stops the pass, with that chat open
      const stopped = await walkChatList(async (chat) => {
        if (!chat.unread || chat.lastIsMine || isRejectionCell(chat) || seen.has(seenKey(chat))) {
          return false;
        }
        seen.add(seenKey(chat));
        opened += 1;
        await humanPause();
        const answered = await prefillChat(chat.id);
        if (!answered) {
          return false;
        }
        // Nothing is sent by the tool: the chat stays open until the user has answered it
        console.log(`💬 ${answered.replied ? 'Check the typed reply and send it' : 'Chat needs your reply'}: ${chat.title} ${chatUrl(chat.id)}`);
        stuckChat = { id: chat.id, title: chat.title };
        return true;
      });
      if (!stopped) {
        console.log(`💬 Chats done: ${rejections} rejection(s) read, ${opened} unread chat(s) opened`);
      }
    } else {
      const waiting = (await page.evaluate(readChatList)).filter((chat) => !chat.lastIsMine && !seen.has(seenKey(chat)) &&
        !argv.chats.includes(chat.id));
      argv.chats.length = 0;
      for (const chat of waiting) {
        await humanPause();
        seen.add(seenKey(chat));
        const answered = await prefillChat(chat.id);
        if (answered) {
          await waitForSend(answered.id);
        }
      }
    }
    seenUrl = page.isClosed() ? null : page.url();
    passRunning = false;
    await sleep(argv.poll * 1000);
  }
}

await session.release();
process.exit(0);
