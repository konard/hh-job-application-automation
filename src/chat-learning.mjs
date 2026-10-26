/** Learning shared by the chat window, application panel and history slot. */
import { learnedPairs, isSupportChat, countChatAnswers } from './chat-answers.mjs';
import { createChatHistory } from './chat-history.mjs';
import { normalizeQuestion } from './qa-database.mjs';
import { contractContacts } from './contacts.mjs';
import { ANSWER_SEPARATOR } from './qa.mjs';

/**
 * Read every distinct answer given to the same question, without changing the user's saved
 * wording. Checkbox arrays keep their meaning. Contacts are templated before expansion in the
 * vacancy's context. The archive is the source of variants, including answers to known questions.
 */
export function withChatHistoryAnswers(db, { history = createChatHistory(), contacts = {} } = {}) {
  let previous;
  let recordedCounts = [];
  const read = async () => {
    const raw = await db.readQADatabase();
    const chats = await history.read();
    if (chats !== previous) {
      recordedCounts = Object.values(chats).filter((chat) => !isSupportChat(chat))
        .flatMap((chat) => chat.answerCounts ?? countChatAnswers(chat.messages));
      previous = chats;
    }
    const keys = new Map([...raw.keys()].map((key) => [normalizeQuestion(key), key]));
    const frequencies = new Map([...raw].filter(([, answer]) => !Array.isArray(answer)).map(([question, answer]) =>
      [question, new Map(String(answer).split(ANSWER_SEPARATOR).map((text) => [text, 0]))]));
    for (const { question, answer: reply, count } of recordedCounts) {
      const normalized = normalizeQuestion(question);
      const key = keys.get(normalized) ?? question;
      keys.set(normalized, key);
      const saved = raw.get(key);
      if (Array.isArray(saved)) continue;
      const answers = frequencies.get(key) ?? new Map();
      const answer = contractContacts(reply, contacts).trim();
      if (answer) answers.set(answer, (answers.get(answer) ?? 0) + count);
      frequencies.set(key, answers);
    }
    const ranked = new Map();
    for (const [question, counts] of frequencies) {
      const answers = [...counts].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count);
      raw.set(question, answers.map(({ answer }) => answer).join(ANSWER_SEPARATOR));
      ranked.set(question, answers);
    }
    return { answers: raw, frequencies: ranked };
  };
  return {
    ...db,
    readSavedQADatabase: db.readQADatabase,
    async readQADatabase() {
      return (await read()).answers;
    },
    async readAnswerFrequencies() {
      return (await read()).frequencies;
    },
  };
}

/** Persist the transcript first, then learn new questions; existing saved answers stay intact. */
export async function learnChatQuestions(chat, { history, qaDatabase, buttonQuestions = new Set(), log = console.log }) {
  await history.record(chat);
  if (!chat?.id || isSupportChat(chat)) return;
  const kept = (await history.read())[chat.id] ?? chat;
  const { questions, templates } = learnedPairs(kept.messages);
  const asked = templates.filter(([question]) => buttonQuestions.has(normalizeQuestion(question)));
  const known = await (qaDatabase.readSavedQADatabase ?? qaDatabase.readQADatabase)();
  for (const [question, answer] of [...questions, ...asked]) {
    if (known.has(question)) continue;
    if (qaDatabase.addQAIfMissing) {
      if (!await qaDatabase.addQAIfMissing(question, answer)) continue;
    } else {
      if ((await qaDatabase.readQADatabase()).has(question)) continue;
      await qaDatabase.addOrUpdateQA(question, answer);
    }
    known.set(question, answer);
    log(`💾 Learned from the chat (qa.lino): ${question}`);
  }
}
