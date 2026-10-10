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
  TEMPLATE_THRESHOLD, chatDraftPrompt, formLinks, isPattern, isRejection, knownReply, learnedPairs, pendingMessages, readChat, readChatList, templateCore, withLearnedPatterns,
} from './chat-answers.mjs';

const USAGE = `Usage: bun run answer-chats -- [<chat url or id> ...] [options]

  --watch                Go through the chats waiting for an answer, one at a time, and keep watching
  --auto                 Unread-only watch mode for use alongside apply: process unread chats without
                         interactive prompts; stop on a chat that needs a human reply and leave it open
  --no-draft             Do not draft unknown answers with local Claude Code
  --no-forms             Do not prefill questionnaire links from chats
  --no-learn             Do not save the answers you send in those questionnaires to data/qa.lino
  --poll <seconds>       How often the chat list is checked in --watch / --auto (default 300)`;

function parseArgs(args) {
  const parsed = { chats: [], watch: false, auto: false, draft: true, forms: true, learn: true, poll: 300 };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=');
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (flag === '--watch') {
      parsed.watch = true;
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
  if (parsed.chats.length === 0 && !parsed.watch) {
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

const sources = await loadAnswerSources();
// Template replies may hold contact placeholders too
const templatesDb = withContacts(createQADatabase(path.join(process.cwd(), 'data', 'chat-templates.lino')), sources.contacts);
const handledForms = new Set();

const session = await openSlot({ name: 'chat-slot', port: CHAT_SLOT_PORT });
const { page } = session;
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

/** Prefill the reply to the waiting message; returns the id of the message it answers, or null */
async function prefillChat(id) {
  if (!page.url().startsWith(chatUrl(id))) {
    await page.goto(chatUrl(id), { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  }
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
    prefillForms(links, { draft: argv.draft, learn: argv.learn, sources, company: chat.company })
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

for (const id of argv.chats) {
  const answered = await prefillChat(id);
  if (answered && !argv.auto && (argv.watch || argv.chats.length > 1)) {
    await waitForSend(answered.id);
  }
}

if (argv.watch) {
  // A chat is seen again when its last message changes (the employer wrote again)
  const seen = new Set();
  const seenKey = (chat) => `${chat.id}\n${chat.subtitle}`;
  // In auto mode: track the chat that needs a human reply, pause until it is resolved
  let stuckChat = null; // { id: string, title: string }
  console.log(argv.auto
    ? `💬 Auto-processing unread chats every ${argv.poll} s`
    : `👀 Watching the chat list every ${argv.poll} s for messages waiting for an answer`);
  for (;;) {
    await page.goto('https://hh.ru/chat', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForSelector('[data-qa^="chatik-open-chat-"]', { timeout: 20000 }).catch(() => {});
    if (!await waitForCaptcha(page, console.log)) {
      await sleep(argv.poll * 1000);
      continue;
    }
    const chats = await page.evaluate(readChatList);

    // In auto mode: check whether the stuck chat has been resolved before processing more
    if (stuckChat) {
      const found = chats.find((c) => c.id === stuckChat.id);
      if (!found || !found.unread || found.lastIsMine) {
        console.log(`💬 Chat was handled, resuming auto-processing: ${stuckChat.title}`);
        stuckChat = null;
      } else {
        // Still waiting for the user's reply: skip this cycle
        await sleep(argv.poll * 1000);
        continue;
      }
    }

    const waiting = argv.auto
      ? chats.filter((chat) => chat.unread && !chat.lastIsMine && !seen.has(seenKey(chat)))
      : chats.filter((chat) => !chat.lastIsMine && !seen.has(seenKey(chat)) && !argv.chats.includes(chat.id));
    if (!argv.auto) {
      argv.chats.length = 0;
    }
    for (const chat of waiting) {
      seen.add(seenKey(chat));
      const answered = await prefillChat(chat.id);
      if (!answered) {
        continue;
      }
      if (!answered.replied && argv.auto) {
        // Chat needs a human reply: stop processing, leave it open, alert the user
        const url = chatUrl(chat.id);
        console.log(`💬 Chat needs your reply: ${chat.title} ${url}`);
        stuckChat = { id: chat.id, title: chat.title };
        break;
      }
      if (!argv.auto) {
        await waitForSend(answered.id);
      }
    }
    await sleep(argv.poll * 1000);
  }
}

await session.release();
process.exit(0);
