/**
 * Every chat read, kept as it was: logs/chat-history.json (personal: logs/ stays out of git), by
 * chat ID, its messages merged as they come. From it:
 *   - the answers are learned again without opening hh.ru (answer-chats --relearn)
 *   - a template message gets one of the replies the user has given to it, picked at random (the
 *     ones used more often more likely), the saved reply among them; a template thanked for only
 *     («Здравствуйте, благодарю, ожидаю.») gets one of all the thanks the user has given to
 *     templates and saved for them, with or without «ожидаю»
 *
 * @module chat-history
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { NO_REPLY, isThanks, knownReply, learnedPairs, countChatAnswers } from './chat-answers.mjs';
import { createMutex, withFileLock } from './helpers/mutex.mjs';

export { isThanks };

export const CHAT_HISTORY_FILE = path.join(process.cwd(), 'logs', 'chat-history.json');

/**
 * @param {string} [file]
 * @returns {{read: () => Promise<Object>, record: (chat: Object) => Promise<boolean>}}
 *   record: true when the chat has something new
 */
export function createChatHistory(file = CHAT_HISTORY_FILE) {
  // Read again when the file changed: the chat window and the application run each keep chats in it
  let cache = { mtime: null, history: {} };
  const read = async () => {
    const mtime = await fs.stat(file).then((stat) => stat.mtimeMs, () => 0);
    if (mtime !== cache.mtime) {
      cache = { mtime, history: await fs.readFile(file, 'utf8').then(JSON.parse, () => ({})) };
    }
    return cache.history;
  };
  const exclusive = createMutex();
  const readLocked = () => fs.readFile(file, 'utf8').then(JSON.parse, (error) => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const writeLocked = async (history) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(history));
    await fs.rename(`${file}.tmp`, file);
    cache = { mtime: (await fs.stat(file)).mtimeMs, history };
  };
  function record(chat) {
    if (!chat?.id || !chat.messages?.length) {
      return Promise.resolve(false);
    }
    return exclusive(() => withFileLock(file, async () => {
      // Always read under the shared lock: the panel, chat watcher and history slot write here.
      const history = await readLocked();
      const saved = history[chat.id] ?? { messages: [] };
      const byId = new Map(saved.messages.map((message) => [message.id, message]));
      const fresh = chat.messages.map((message) => {
        const before = byId.get(message.id);
        const previousTexts = [...before?.previousTexts ?? [], ...message.previousTexts ?? []];
        if (before?.mine && message.mine && before.text !== message.text) previousTexts.push(before.text);
        return previousTexts.length ? { ...message, previousTexts: [...new Set(previousTexts)] } : message;
      }).filter((message) => JSON.stringify(byId.get(message.id)) !== JSON.stringify(message));
      const metadata = Object.fromEntries(['vacancy', 'company', 'vacancyUrl', 'historyComplete', 'recordingVersion'].filter((key) => chat[key] !== undefined).map((key) => [key, chat[key]]));
      fresh.forEach((message) => byId.set(message.id, { ...message }));
      const messages = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
      const answerCounts = countChatAnswers(messages);
      if (fresh.length === 0 && Object.entries(metadata).every(([key, value]) => saved[key] === value) &&
        JSON.stringify(saved.answerCounts) === JSON.stringify(answerCounts)) {
        return false;
      }
      history[chat.id] = {
        ...saved, ...metadata, at: new Date().toISOString(),
        messages, answerCounts,
      };
      await writeLocked(history);
      return true;
    }));
  }
  /** Backfill frequency metadata in one locked write, without reopening chats or changing Q&A. */
  function recount() {
    return exclusive(() => withFileLock(file, async () => {
      const history = await readLocked();
      for (const chat of Object.values(history)) chat.answerCounts = countChatAnswers(chat.messages);
      await writeLocked(history);
      return { chats: Object.keys(history).length, sentAnswers: Object.values(history)
        .reduce((total, chat) => total + chat.answerCounts.reduce((sum, answer) => sum + answer.count, 0), 0) };
    }));
  }
  return { read, record, recount };
}

/** A reply to someone by name («Ирина, здравствуйте!») is theirs, not one for every chat */
const BY_NAME = /^(?![Зз]дравствуй|[Дд]обр|[Пп]ривет|[Сс]пасибо|[Бб]лагодар|[Хх]орошо|[Оо]тлично|[Пп]онял)[А-ЯЁA-Z][а-яёa-z-]+(?:\s+[А-ЯЁA-Z][а-яёa-z-]+)?\s*[,!]/u;

/** The key of the thanks for templates in replyVariants */
export const THANKS = 'thanks';

/**
 * The user's replies to each template, from the history
 * @param {Object} history - createChatHistory().read()
 * @param {Map} templates - chat-templates.lino with contacts filled in
 * @returns {Map<string, string[]>} Template message -> the replies given, once per use; THANKS ->
 *   the thanks given to templates thanked for and those saved for them
 */
export function replyVariants(history, templates) {
  const variants = new Map();
  const add = (key, reply) => variants.set(key, [...variants.get(key) ?? [], reply.trim()]);
  for (const answer of templates.values()) {
    const saved = [answer].flat().join('\n');
    if (isThanks(saved)) {
      add(THANKS, saved);
    }
  }
  for (const chat of Object.values(history)) {
    for (const [message, reply] of learnedPairs(chat.messages).templates) {
      const known = knownReply({ title: '', text: message }, { templates, qaMap: new Map() });
      if (!known?.matched || known.noReply || !known.source.startsWith('chat-templates') || BY_NAME.test(reply.trim())) {
        continue;
      }
      // A long reply of its own (a question about the pay) is not one to repeat in other chats
      if (reply.length > Math.max(2 * known.answer.length, 120)) {
        continue;
      }
      add(known.matched, reply);
      if (isThanks(known.answer) && isThanks(reply)) {
        add(THANKS, reply);
      }
    }
  }
  return variants;
}

/**
 * One of the replies given to a template, picked at random: those used more often more likely,
 * the saved one counted once more. A template thanked for: one of all the thanks
 * @param {Object|null} reply - knownReply
 * @param {Map<string, string[]>} variants - replyVariants
 * @param {() => number} [random]
 * @returns {Object|null} The reply, its answer maybe another one the user gave
 */
export function varyReply(reply, variants, random = Math.random) {
  const template = reply?.matched && !reply.noReply && reply.answer !== NO_REPLY && reply.source?.startsWith('chat-templates');
  const thanks = template && isThanks(reply.answer);
  // Replies in the language of the saved one: a message in English is not answered in Russian
  const russian = (text) => /[а-яё]/iu.test(text);
  const given = (template ? (thanks ? variants.get(THANKS) : variants.get(reply.matched)) ?? [] : [])
    .filter((answer) => russian(answer) === russian(reply.answer));
  if (given.length === 0) {
    return reply;
  }
  const all = [reply.answer, ...given];
  const answer = all[Math.floor(random() * all.length)];
  const kinds = new Set(all).size;
  return answer === reply.answer ? reply : { ...reply, answer, source: `${reply.source}, one of your ${kinds} ${thanks ? 'thanks' : 'replies to it'}` };
}
