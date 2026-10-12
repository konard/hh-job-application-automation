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

import path from 'path';
import { openSlot, copySession } from './browser-slots.mjs';
import { askUser, enableConfirmations, withdrawPrompt } from './confirmations.mjs';
import { createQADatabase, findBestMatch } from './qa-database.mjs';
import { withContacts } from './contacts.mjs';
import { askClaude, plainText, relatedAnswers } from './form-prefill.mjs';
import { loadAnswerSources, prefillForms, waitForCaptcha } from './form-slots.mjs';
import { rememberFormVacancy } from './assignments.mjs';
import {
  TEMPLATE_THRESHOLD, chatDraftPrompt, formLinks, isChatAnswered, isPattern, isRejection, knownReply, learnedPairs, pendingMessages, readChat, readChatList, scrollChatList, templateCore, withLearnedPatterns,
} from './chat-answers.mjs';
import { perfectOption, readQuickReplies, sendChatAnswer } from './instant-chat.mjs';
import { blockHangingHosts } from './hanging-hosts.mjs';
import { createSkippedVacancies, isSkippedForGood, SKIP_REASONS } from './skipped-vacancies.mjs';
import { createVacancyFilters, describeFilterMatch } from './vacancy-filters.mjs';
import { extractVacancyId } from './hh-selectors.mjs';

const USAGE = `Usage: bun run answer-chats -- [<chat url or id> ...] [options]

  --watch                Go through the chats waiting for an answer, one at a time, and keep watching
  --auto                 Unread chats only, without prompts (apply --process-chats): chats that need nothing
                         sent are handled; at the first one that needs a message (a reply typed or drafted
                         for you to check, or none found) it stops with that chat open and waits until you
                         have answered it
  --auto-send            Send an exact answer (the saved question word for word, or a bot's button that is the saved
                         answer); everything else is only typed in for you (apply passes --auto-send-exact-answers)
  --no-draft             Do not draft unknown answers with local Claude Code
  --no-forms             Do not prefill questionnaire links from chats
  --no-learn             Do not save the answers you send in those questionnaires to data/qa.lino
  --learn-all            Read every chat already read, slowly (scrolled to and clicked in the list), and save
                         the answers you sent that are not saved yet (qa.lino, chat-templates.lino); unread
                         chats are left unread
  --poll <seconds>       How often the chat list is checked in --watch / --auto (default 300)`;

function parseArgs(args) {
  const parsed = { chats: [], watch: false, learnAll: false, auto: false, autoSend: false, draft: true, forms: true, learn: true, poll: 300 };
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
    } else if (flag === '--auto') {
      parsed.auto = true;
      parsed.watch = true; // --auto implies watch mode
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
const AUTOMATION_PORT = 9322;
const MESSAGE_INPUT = 'textarea[data-qa="text-input"]';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chatUrl = (id) => `https://hh.ru/chat/${id}`;
/** A chat whose list cell says «Отказ»: the employer's rejection */
const isRejectionCell = (chat) => /^отказ$/i.test(chat.last ?? '');

/** At the list's end hh.ru loads the next older chats (about 20, in a few seconds): whether it did */
async function moreChatsLoaded(height) {
  for (const started = Date.now(); Date.now() - started < 5000; await sleep(500)) {
    if ((await page.evaluate(scrollChatList, null).catch(() => null))?.height > height) {
      return true;
    }
  }
  return false;
}

/**
 * The whole chat list, read as it is scrolled down screen by screen (a virtual list: only the
 * chats on screen are in the page), then scrolled back to its top
 */
async function loadChatList() {
  const chats = new Map();
  for (let top = 0; ; ) {
    const at = await page.evaluate(scrollChatList, top).catch(() => null);
    await sleep(700);
    for (const chat of await page.evaluate(readChatList).catch(() => [])) {
      chats.set(chat.id, chat);
    }
    if (!at) {
      break;
    }
    if (at.top + at.view >= at.height - 5 && !await moreChatsLoaded(at.height)) {
      break;
    }
    top = at.top + Math.round(at.view * 0.8);
  }
  await page.evaluate(scrollChatList, 0).catch(() => {});
  return [...chats.values()].sort((a, b) => a.top - b.top);
}

/** The chat's cell scrolled into the list's view: from where it was, else screen by screen from the top */
async function scrollToChat(id, top) {
  const cell = page.locator(`[data-qa="chatik-open-chat-${id}"]`).first();
  const shown = () => cell.count().then((count) => count > 0, () => false);
  if (await shown()) {
    return cell;
  }
  if (top !== undefined) {
    await page.evaluate(scrollChatList, Math.max(0, top - 160)).catch(() => {});
    await sleep(700);
    if (await shown()) {
      return cell;
    }
  }
  for (let at = await page.evaluate(scrollChatList, 0).catch(() => null); at; ) {
    await sleep(700);
    if (await shown()) {
      return cell;
    }
    if (at.top + at.view >= at.height - 5) {
      break;
    }
    at = await page.evaluate(scrollChatList, at.top + Math.round(at.view * 0.8)).catch(() => null);
  }
  return null;
}

const sources = await loadAnswerSources();
// Template replies may hold contact placeholders too
const templatesDb = withContacts(createQADatabase(path.join(process.cwd(), 'data', 'chat-templates.lino')), sources.contacts);
const handledForms = new Set();
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

const session = await openSlot({ name: 'chat-slot', port: CHAT_SLOT_PORT });
const { page } = session;
// Ad and tracker requests that hang kept the chat page loading for a minute
await blockHangingHosts(page).catch(() => {});
const copied = await copySession({ fromPort: AUTOMATION_PORT, page, domain: /(^|\.)hh\.ru$/ });
console.log(copied > 0
  ? `🔑 Logged in with the hh.ru session of the automation browser (${copied} cookies, values not shown)`
  : '⚠️  The automation browser is not running: log in to hh.ru in the chat slot if needed');
enableConfirmations({ steps: [], onStop: () => process.exit(0), input: process.stdin });

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
  let learned = false;
  for (const [message, reply] of templates) {
    if (!findBestMatch(message, examples, { threshold: TEMPLATE_THRESHOLD })) {
      examples.set(message, reply);
      learned = true;
      console.log(`💾 Learned a template reply (chat-templates.lino): ${message.split('\n')[0]}`);
    }
  }
  if (learned) {
    // Template messages answered the same way are generalized into patterns
    const updated = withLearnedPatterns(examples);
    [...updated.keys()].filter((key) => isPattern(key) && !known.has(key))
      .forEach((key) => console.log(`🧩 Learned a template pattern: ${key}`));
    await templatesDb.writeQADatabase(updated);
  }
}

/** A person's pause between chats: a few seconds, never the same */
const humanPause = (fromMs = 3000, toMs = 7000) => sleep(fromMs + Math.random() * (toMs - fromMs));

/**
 * Open a chat as a person does: its cell in the chat list on the left is scrolled to and clicked.
 * A chat not in the list (a link given on the command line) is opened by its address
 */
async function openChat(id, top) {
  if (page.url().startsWith(chatUrl(id))) {
    return;
  }
  const cell = await scrollToChat(id, top);
  if (cell) {
    await cell.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await humanPause(600, 1500);
    await cell.click({ timeout: 5000 }).catch(() => {});
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
async function prefillChat(id, depth = 0, top = undefined) {
  await openChat(id, top);
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

  let reply = knownReply(last, sources.templates ? { templates: sources.templates, qaMap: sources.qaMap } : {
    templates: await templatesDb.readQADatabase(), qaMap: sources.qaMap,
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
  await page.goto('https://hh.ru/chat', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForSelector('[data-qa^="chatik-open-chat-"]', { timeout: 20000 }).catch(() => {});
  if (!await waitForCaptcha(page, console.log)) {
    return;
  }
  // The list shows every chat, not only the unread ones; the filter is put back afterwards
  const unreadOnly = page.locator('label', { hasText: 'Только непрочитанные' }).first();
  const filtered = await unreadOnly.locator('input[type="checkbox"]').isChecked().catch(() => false);
  if (filtered) {
    await unreadOnly.click({ timeout: 5000 }).catch(() => {});
    await humanPause(1500, 2500);
  }
  const all = await loadChatList();
  // A chat whose last message is the application itself («Отклик на вакансию», with a non-breaking space) has no answer in it
  const chats = all.filter((chat) => !chat.unread && !/^отклик\s+на\s+вакансию$/i.test(chat.last.trim()));
  const savedBefore = sources.qaMap.size;
  console.log(`📚 Reading ${chats.length} of ${all.length} chat(s) for answers not saved yet (unread chats are left ` +
    'unread; chats with only the application are not opened)');
  for (const [index, chat] of chats.entries()) {
    await openChat(chat.id, chat.top);
    if (!await waitForCaptcha(page, console.log)) {
      break;
    }
    await page.waitForSelector('[data-qa^="chatik-chat-message-"]', { timeout: 20000 }).catch(() => {});
    const opened = await page.evaluate(readChat).catch(() => null);
    if (opened) {
      await learn(opened.messages);
    }
    if ((index + 1) % 10 === 0) {
      console.log(`📚 ${index + 1} of ${chats.length} chats read`);
    }
    await humanPause();
  }
  if (filtered) {
    await page.goto('https://hh.ru/chat', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const label = page.locator('label', { hasText: 'Только непрочитанные' }).first();
    await label.waitFor({ timeout: 20000 }).catch(() => {});
    if (!await label.locator('input[type="checkbox"]').isChecked().catch(() => true)) {
      await label.click({ timeout: 5000 }).catch(() => {});
    }
  }
  console.log(`📚 Done: ${sources.qaMap.size - savedBefore} new answer(s) saved to qa.lino`);
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

if (argv.watch) {
  // A chat is seen again when its last message changes (the employer wrote again)
  const seen = new Set();
  const seenKey = (chat) => `${chat.id}\n${chat.last}`;
  // --auto: the chat left open for the user; nothing else is processed until it is answered
  let stuckChat = null;
  console.log(argv.auto
    ? `💬 Processing unread chats every ${argv.poll} s`
    : `👀 Watching the chat list every ${argv.poll} s for messages waiting for an answer`);
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
    await page.goto('https://hh.ru/chat', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForSelector('[data-qa^="chatik-open-chat-"]', { timeout: 20000 }).catch(() => {});
    if (!await waitForCaptcha(page, console.log)) {
      await sleep(argv.poll * 1000);
      continue;
    }
    const chats = argv.auto ? await loadChatList() : await page.evaluate(readChatList);
    const waiting = chats.filter((chat) => !chat.lastIsMine && !seen.has(seenKey(chat)) &&
      (argv.auto ? chat.unread : !argv.chats.includes(chat.id)));
    argv.chats.length = 0;
    // Rejections first, all of them: opening one reads it, so it leaves the unread list. The list
    // is read again after them, as the chats that load in their place may be rejections too
    const rejections = argv.auto ? waiting.filter(isRejectionCell) : [];
    if (argv.auto) {
      console.log(waiting.length > 0
        ? `💬 Unread chats: ${waiting.length}${rejections.length > 0 ? `, ${rejections.length} of them rejections (opened first, so they are read)` : ''}`
        : '💬 No unread chats');
    }
    if (rejections.length > 0) {
      for (const chat of rejections) {
        seen.add(seenKey(chat));
        // Only opened, so it is read: nothing is typed in a rejection
        await openChat(chat.id, chat.top);
        if (!await waitForCaptcha(page, console.log)) {
          break;
        }
        console.log(`📭 Chat ${chat.id} (${chat.title}): rejection read`);
        await humanPause();
      }
      continue;
    }
    for (const chat of waiting) {
      await humanPause();
      seen.add(seenKey(chat));
      const answered = await prefillChat(chat.id, 0, chat.top);
      if (!answered) {
        continue;
      }
      if (argv.auto) {
        // Nothing is sent by the tool: stop here with the chat open until the user has answered it
        console.log(`💬 ${answered.replied ? 'Check the typed reply and send it' : 'Chat needs your reply'}: ${chat.title} ${chatUrl(chat.id)}`);
        stuckChat = { id: chat.id, title: chat.title };
        break;
      }
      await waitForSend(answered.id);
    }
    await sleep(argv.poll * 1000);
  }
}

await session.release();
process.exit(0);
