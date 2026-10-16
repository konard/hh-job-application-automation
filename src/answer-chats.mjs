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
import { openSlot, copySession } from './browser-slots.mjs';
import { askUser, enableConfirmations, withdrawPrompt } from './confirmations.mjs';
import { createQADatabase, findBestMatch } from './qa-database.mjs';
import { contractContacts, withContacts } from './contacts.mjs';
import { askClaude, plainText, relatedAnswers } from './form-prefill.mjs';
import { loadAnswerSources, prefillForms, waitForCaptcha } from './form-slots.mjs';
import { rememberFormVacancy } from './assignments.mjs';
import { answersInContexts, loadAnswerContexts } from './answer-contexts.mjs';
import { fetchVacancy } from './vacancy-context.mjs';
import {
  TEMPLATE_THRESHOLD, chatDraftPrompt, compareReusedAnswers, describeReuse, formLinks, isChatAnswered, isPattern, isRejection, isReuseOffer, chatContextTexts, knownReplyInContexts, reuseOption, learnedPairs, pendingMessages, readChat, readChatList, readUserActivity, scrollChatList, visibleRejections, templateCore, withLearnedPatterns,
} from './chat-answers.mjs';
import { perfectOption, readQuickReplies, sendChatAnswer } from './instant-chat.mjs';
import { blockHangingHosts } from './hanging-hosts.mjs';
import { createHumanInput } from './helpers/human-input.mjs';
import { createSkippedVacancies, isSkippedForGood, SKIP_REASONS } from './skipped-vacancies.mjs';
import { createVacancyFilters, describeFilterMatch } from './vacancy-filters.mjs';
import { extractVacancyId } from './hh-selectors.mjs';
import { recordEvent } from './stats.mjs';

const USAGE = `Usage: bun run answer-chats -- [<chat url or id> ...] [options]

  --watch                Go through the chats waiting for an answer, one at a time, and keep watching
  --auto                 Unread chats only, without prompts (apply --process-chats): the rejections are cleared
                         first, then chats that need nothing
                         sent are handled; at the first one that needs a message (a reply typed or drafted
                         for you to check, or none found) it stops with that chat open and waits until you
                         have answered it
  --clear-rejections     Only open the unread rejections («Отказ»), from the chat list, so they leave the unread
                         chats; nothing is typed in them (apply runs it by default every 2 hours). Between
                         those passes a rejection that shows in the chat window is read at once
  --no-live-rejections   Read the rejections only in those passes, not as they show in the chat window
  --auto-reuse           Answer a recruiter bot's offer to reuse earlier answers («Используем эти ответы?»): «Да»
                         when each is the saved answer, «Нет» when one differs; without it you choose
  --auto-send            Send an exact answer (the saved question word for word, or a bot's button that is the saved
                         answer); everything else is only typed in for you (apply passes --auto-send-exact-answers)
  --no-draft             Do not draft unknown answers with local Claude Code
  --no-forms             Do not prefill questionnaire links from chats
  --no-learn             Do not save the answers you send in those questionnaires to data/qa.lino
  --learn-all            Read every chat already read, slowly (scrolled to and clicked in the list), in a window
                         of its own (port 9341), and save
                         the answers you sent that are not saved yet (qa.lino, chat-templates.lino); unread
                         chats are left unread
  --poll <seconds>       How often the chat list is checked in --watch / --auto (default 300)`;

function parseArgs(args) {
  const parsed = { chats: [], watch: false, learnAll: false, auto: false, clearRejections: false, liveRejections: true, autoSend: false, autoReuse: false, draft: true, forms: true, learn: true, poll: 300 };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=');
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (flag === '--watch') {
      parsed.watch = true;
    } else if (flag === '--learn-all') {
      parsed.learnAll = true;
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
    } else {
      parsed.chats.push(args[i].match(/(\d{6,})/)?.[1] ?? args[i]);
    }
  }
  if (parsed.chats.length === 0 && !parsed.watch && !parsed.learnAll) {
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
/** A chat whose list cell says «Отказ»: the employer's rejection */
const isRejectionCell = (chat) => /^отказ$/i.test(chat.last ?? '');

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
async function wheelToTop() {
  for (let at = await listPosition(); at && at.top > 0; ) {
    const before = at.top;
    at = await wheelChatList(-Math.round(at.view * (0.6 + Math.random() * 0.3)));
    if (!at || at.top >= before) {
      break;
    }
  }
}

/** At the list's end hh.ru loads the next older chats (about 20, in a few seconds): whether it did */
async function moreChatsLoaded(height) {
  for (const started = Date.now(); Date.now() - started < 5000; await sleep(500)) {
    if ((await listPosition())?.height > height) {
      return true;
    }
  }
  return false;
}

/** The chats wholly on screen in the list, from the top */
async function chatsOnScreen() {
  const at = await listPosition();
  const rows = await page.evaluate(readChatList).catch(() => []);
  return rows.filter((chat) => !at || (chat.top >= at.top - 2 && chat.top + chat.height <= at.top + at.view + 2))
    .sort((a, b) => a.top - b.top);
}

/**
 * Go down the chat list as a person does: from its top, the chats on screen one by one, then the
 * list wheeled on a little; at its end hh.ru loads the older chats. The page is not reloaded and
 * the list does not jump
 * @param {(chat: Object) => Promise<boolean>} visit - Each chat once; true stops the walk
 * @returns {Promise<boolean>} Whether a visit stopped it
 */
async function walkChatList(visit) {
  await wheelToTop();
  const done = new Set();
  for (;;) {
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
const UNREAD_ONLY_INPUTS = 'label:has-text("Только непрочитанные") input[type="checkbox"]';

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
    await human.click(unreadOnlyBox());
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
    if (shown || attempt >= 3 || !await waitForCaptcha(page, console.log)) {
      break;
    }
    console.log(`🔄 The chat page did not load (attempt ${attempt} of 3): opening it again`);
    await humanPause(5000, 10000);
  }
  return waitForCaptcha(page, console.log);
}

const sources = await loadAnswerSources();
// Template replies may hold contact placeholders too
const templatesFile = createQADatabase(path.join(process.cwd(), 'data', 'chat-templates.lino'));
const templatesDb = withContacts(templatesFile, sources.contacts);
const handledForms = new Set();
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

let session;
let page;
let human;
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
}
await openChatTab();
const copied = await copySession({ fromPort: AUTOMATION_PORT, page, domain: /(^|\.)hh\.ru$/ });
console.log(copied > 0
  ? `🔑 Logged in with the hh.ru session of the automation browser (${copied} cookies, values not shown)`
  : '⚠️  The automation browser is not running: log in to hh.ru in the chat slot if needed');
enableConfirmations({ steps: [], onStop: () => process.exit(0), input: process.stdin });

const THIRD_PARTY_CONTACT = /\+?\d[\d\s()-]{8,}\d|t\.me\/|@[A-Za-z]\w{3,}/;

/** Save what the user has answered in the chat: questions to qa.lino, template messages to chat-templates.lino */
async function learn(messages) {
  const { questions, templates } = learnedPairs(messages);
  for (const [question, answer] of questions) {
    if (!sources.qaMap.has(question)) {
      await sources.qaDatabase.addOrUpdateQA(question, answer);
      sources.qaMap.set(question, answer);
      console.log(`💾 Learned from the chat (qa.lino): ${question}`);
    }
  }
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
      stored.set(message, contractContacts(reply, sources.contacts));
      learned = true;
      console.log(`💾 Learned a template reply (chat-templates.lino): ${message.split('\n')[0]}`);
    }
  }
  if (learned) {
    // Template messages answered the same way are generalized into patterns
    const updated = withLearnedPatterns(stored);
    [...updated.keys()].filter((key) => isPattern(key) && !stored.has(key))
      .forEach((key) => console.log(`🧩 Learned a template pattern: ${key}`));
    await templatesFile.writeQADatabase(updated);
  }
}

/**
 * Open a chat as a person does: its cell in the chat list on the left (on screen) is clicked. A chat
 * not in the list (a link given on the command line) is opened by its address
 */
async function openChat(id) {
  if (page.url().startsWith(chatUrl(id))) {
    return;
  }
  const cell = page.locator(`[data-qa="chatik-open-chat-${id}"]`).first();
  if (await cell.count().catch(() => 0) > 0 && await human.click(cell)) {
    if (await page.waitForURL((url) => url.href.startsWith(chatUrl(id)), { timeout: 15000 }).then(() => true, () => false)) {
      // The chat on the right is replaced after the address
      await sleep(2000);
      return;
    }
  }
  console.log(`🔗 Chat ${id} is not in the chat list: opened by its address`);
  await page.goto(chatUrl(id), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
}

/** Prefill the reply to the waiting message; returns the id of the message it answers, or null */
async function prefillChat(id, depth = 0) {
  await openChat(id);
  if (!await waitForCaptcha(page, console.log)) {
    return null;
  }
  await page.waitForSelector('[data-qa^="chatik-chat-message-"]', { timeout: 20000 }).catch(() => {});
  const chat = await page.evaluate(readChat);
  await learn(chat.messages);
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
  if (!reply && argv.draft) {
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
  if (!reply) {
    console.log('❓ No saved or drafted reply: answer it yourself');
    return { id: last.id, replied: false, title: chat.vacancy };
  }
  // An exact answer is sent (a bot's button when it offers one), and the bot's next question taken
  const options = await page.evaluate(readQuickReplies).catch(() => []);
  const option = options.length > 0 ? perfectOption(reply.answer, options) : null;
  if (argv.autoSend && reply.perfect && (options.length === 0 || option) && depth < 20) {
    if (await sendChatAnswer(page.mainFrame(), last.id, { answer: reply.answer, option }).catch(() => false)) {
      console.log(`✅ Answered (exact match, ${reply.source}): ${option ?? reply.answer}`);
      await page.waitForFunction((id) => {
        const messages = [...document.querySelectorAll('[data-qa^="chatik-chat-message-"]')];
        return messages.length > 0 && !messages[messages.length - 1].getAttribute('data-qa').endsWith(id);
      }, last.id, { timeout: 15000 }).catch(() => {});
      await sleep(3000);
      return prefillChat(id, depth + 1);
    }
    console.log('⚠️  The answer did not show in the chat: typed in for you instead');
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
      const chat = await page.evaluate(readChat).catch(() => null);
      const index = chat?.messages.findIndex((message) => message.id === answeredId) ?? -1;
      if (index >= 0 && chat.messages.slice(index + 1).some((message) => message.mine)) {
        sent = true;
        await learn(chat.messages);
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
  const { was: unreadOnly } = await showUnreadOnly(false);
  const savedBefore = sources.qaMap.size;
  // Chats read before and unchanged since (the same last line) are not opened again
  const readFile = path.join(process.cwd(), 'logs', 'chats-learned.json');
  const readBefore = await fs.readFile(readFile, 'utf8').then(JSON.parse, () => ({}));
  let opened = 0;
  console.log('📚 Going down the chat list for answers not saved yet (unread chats are left unread; ' +
    'chats with only the application, «Отклик на вакансию», are not opened)');
  await walkChatList(async (chat) => {
    if (chat.unread || /^отклик\s+на\s+вакансию$/i.test(chat.last.trim()) || readBefore[chat.id] === chat.last) {
      return false;
    }
    await openChat(chat.id);
    if (!await waitForCaptcha(page, console.log)) {
      return true;
    }
    await page.waitForSelector('[data-qa^="chatik-chat-message-"]', { timeout: 20000 }).catch(() => {});
    const read = await page.evaluate(readChat).catch(() => null);
    if (read) {
      await learn(read.messages);
      readBefore[chat.id] = chat.last;
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
  console.log(`📚 Done: ${opened} chats read, ${sources.qaMap.size - savedBefore} new answer(s) saved to qa.lino`);
}

/**
 * The unread rejections opened one by one, going down the list: opening one reads it, so it leaves
 * the unread chats. Nothing is typed in a rejection
 * @returns {Promise<number|null>} How many were read; null behind a captcha
 */
async function clearRejections() {
  let rejections = 0;
  const stopped = await walkChatList(async (chat) => {
    if (!chat.unread || !isRejectionCell(chat)) {
      return false;
    }
    await openChat(chat.id);
    if (!await waitForCaptcha(page, console.log)) {
      return true;
    }
    rejections += 1;
    console.log(`📭 Chat ${chat.id} (${chat.title}): rejection read`);
    recordEvent('rejection_read', { chatId: chat.id, live: false });
    await humanPause();
    return false;
  });
  return stopped ? null : rejections;
}

if (argv.learnAll) {
  await learnFromAllChats();
  await session.release();
  process.exit(0);
}

for (const id of argv.chats) {
  const answered = await prefillChat(id);
  if (answered && !argv.auto && (argv.watch || argv.chats.length > 1)) {
    await waitForSend(answered.id);
  }
}

/**
 * What the user answers in the chat window is learned as they send it: the open chat is read from
 * the page every few seconds (no request to hh.ru) and learned when its last message changes
 */
function learnAsTheUserAnswers() {
  let last = '';
  const timer = setInterval(async () => {
    if (page.isClosed() || !/\/chat\/\d+/.test(page.url())) {
      return;
    }
    const chat = await page.evaluate(readChat).catch(() => null);
    const key = `${chat?.id}\n${chat?.messages?.at(-1)?.id}`;
    if (chat?.messages?.length && key !== last) {
      last = key;
      await learn(chat.messages).catch((error) => console.log(`⚠️  Not learned from the chat: ${error.message}`));
    }
  }, 5000);
  timer.unref();
}

/** Where the chat window was at the last check: the user moving in it since, or typing, delays the next pass */
let seenUrl = null;
async function userIsInTheWindow() {
  const typing = await page.locator('textarea[data-qa="text-input"]').first().inputValue({ timeout: 1000 })
    .then((value) => value.trim().length > 0, () => false);
  const moved = seenUrl !== null && !page.isClosed() && page.url() !== seenUrl;
  seenUrl = page.isClosed() ? null : page.url();
  return typing || moved;
}

/** How long the user has not touched the chat window before a shown rejection is read */
const USER_IDLE_MS = 15000;

/**
 * The unread rejections read as they show in the chat window: hh.ru adds them to the list as they
 * come (the page is only read, no request). Each is opened by a click on its cell, then the window
 * goes back (browser history, no reload) to the chat the user had open. It waits while a reply is
 * typed or the user has done something in the window in the last 15 s
 * @param {{leaveAlone: () => boolean}} options - leaveAlone: the chat pass has the window now
 */
function readRejectionsAsTheyShow({ leaveAlone }) {
  let busy = false;
  const tried = new Set();
  const timer = setInterval(async () => {
    if (busy || leaveAlone() || page.isClosed() || !/^https:\/\/hh\.ru\/chat(\/|$|\?)/.test(page.url())) {
      return;
    }
    busy = true;
    const userUrl = page.url();
    let moves = 0;
    try {
      for (;;) {
        const rejection = visibleRejections(await chatsOnScreen()).find((chat) => !tried.has(chat.id));
        const user = await page.evaluate(readUserActivity).catch(() => null);
        if (!rejection || !user || user.typing || Date.now() - user.at < USER_IDLE_MS || leaveAlone()) {
          break;
        }
        tried.add(rejection.id);
        await page.evaluate(() => { window.__chatAutomating = true; });
        const cell = page.locator(`[data-qa="chatik-open-chat-${rejection.id}"]`).first();
        if (!await human.click(cell) ||
          !await page.waitForURL((url) => url.href.startsWith(chatUrl(rejection.id)), { timeout: 15000 }).then(() => true, () => false)) {
          break;
        }
        moves += 1;
        console.log(`📭 Chat ${rejection.id} (${rejection.title}): rejection read (it showed in the chat window)`);
        recordEvent('rejection_read', { chatId: rejection.id, live: true });
        await humanPause(2000, 4000);
      }
    } catch (error) {
      console.log(`⚠️  A shown rejection was not read: ${error.message.split('\n')[0]}`);
    } finally {
      if (moves > 0 && !page.isClosed()) {
        // Back to where the user was
        await page.evaluate((steps) => window.history.go(-steps), moves).catch(() => {});
        await page.waitForURL(userUrl, { timeout: 10000 }).catch(() => {});
      }
      await page.evaluate(() => { window.__chatAutomating = false; }).catch(() => {});
      // The window moved by the tool, not by the user
      seenUrl = page.isClosed() ? null : page.url();
      busy = false;
    }
  }, 10000);
  timer.unref();
}

if (argv.watch) {
  if (argv.learn) {
    learnAsTheUserAnswers();
  }
  // A chat is seen again when its last message changes (the employer wrote again)
  const seen = new Set();
  const seenKey = (chat) => `${chat.id}\n${chat.last}`;
  // --auto: the chat left open for the user; nothing else is processed until it is answered
  let stuckChat = null;
  // The pass over the chat list is going: the window is left to it
  let passRunning = false;
  if (argv.liveRejections && (argv.auto || argv.clearRejections)) {
    readRejectionsAsTheyShow({ leaveAlone: () => passRunning || stuckChat !== null });
  }
  console.log(argv.auto
    ? `💬 Processing unread chats every ${argv.poll} s (rejections first)`
    : argv.clearRejections ? `📭 Clearing unread rejections every ${argv.poll} s` : `👀 Watching the chat list every ${argv.poll} s for messages waiting for an answer`);
  for (;;) {
    if (stuckChat) {
      // Read where it was left (the typed reply stays), without the chat list
      if (!page.url().startsWith(chatUrl(stuckChat.id))) {
        await page.goto(chatUrl(stuckChat.id), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      const chat = await page.evaluate(readChat).catch(() => null);
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
    } else if (argv.clearRejections && !argv.auto) {
      const rejections = await clearRejections();
      if (rejections !== null) {
        console.log(`📭 Rejections cleared: ${rejections} read; next check in ${Math.round(argv.poll / 60)} min`);
      }
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
