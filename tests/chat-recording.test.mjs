import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatHistory } from '../src/chat-history.mjs';
import { createQADatabase } from '../src/qa-database.mjs';
import { learnedPairs, knownReply, countChatAnswers } from '../src/chat-answers.mjs';
import { withContacts } from '../src/contacts.mjs';
import { learnChatQuestions, withChatHistoryAnswers } from '../src/chat-learning.mjs';
import { observeChat, readFullChat, setUnreadFilter } from '../src/chat-recording.mjs';
import { allAnswersExact } from '../src/qa.mjs';

const question = 'Сколько проектов или задач вы можете вести одновременно? При каком количестве одновременных задач происходит распыление и снижение результативности?';
const chat = (id, answer) => ({ id, vacancy: 'Project manager', messages: [
  { id: `${id}1`, mine: false, title: 'Рекрутер', text: question },
  { id: `${id}2`, mine: true, title: '', text: answer },
] });
const fixture = async (fn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-recording-'));
  try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
};

describe('durable chat recording', () => {
  test('independent writers cannot lose chats or messages when their writes overlap', () => fixture(async (dir) => {
    const file = path.join(dir, 'history.json');
    await Promise.all(Array.from({ length: 12 }, (_, i) => createChatHistory(file).record(chat(String(i + 1), `Answer ${i}`))));
    expect(Object.keys(await createChatHistory(file).read())).toHaveLength(12);
    await Promise.all(Array.from({ length: 12 }, (_, i) => createChatHistory(file).record({
      id: 'shared', messages: [{ id: String(i), mine: true, title: '', text: `Part ${i}` }],
    })));
    expect((await createChatHistory(file).read()).shared.messages).toHaveLength(12);
  }));

  test('changed message text and metadata are saved; disk errors reach the caller', () => fixture(async (dir) => {
    const history = createChatHistory(path.join(dir, 'history.json'));
    await history.record(chat('1', 'Original'));
    await history.record({ ...chat('1', 'Edited'), historyComplete: true });
    expect((await history.read())['1']).toMatchObject({ historyComplete: true, messages: [{ text: question }, { text: 'Edited' }] });
    const answers = withChatHistoryAnswers(createQADatabase(path.join(dir, 'qa.lino')), { history });
    expect((await answers.readQADatabase()).get(question)).toBe('Original | Edited');
    expect(await history.record(chat('1', 'Edited'))).toBe(false);
    await fs.writeFile(path.join(dir, 'not-a-directory'), 'x');
    await expect(createChatHistory(path.join(dir, 'not-a-directory', 'history.json')).record(chat('2', 'Answer'))).rejects.toThrow();
  }));

  test('new answers to a known question are preserved and prefilled, without replacing its saved wording', () => fixture(async (dir) => {
    const history = createChatHistory(path.join(dir, 'history.json'));
    const original = createQADatabase(path.join(dir, 'qa.lino'));
    await original.addOrUpdateQA(question, '3–5 задач');
    const qaDatabase = withChatHistoryAnswers(original, { history });
    for (const item of [chat('1', '3–5 задач'), chat('2', '10–20 небольших задач'), chat('3', '10–20 небольших задач')]) {
      await learnChatQuestions(item, { history, qaDatabase, log: () => {} });
    }
    expect((await original.readQADatabase()).get(question)).toBe('3–5 задач');
    const answers = await qaDatabase.readQADatabase();
    expect(answers.get(question)).toBe('10–20 небольших задач | 3–5 задач');
    expect((await qaDatabase.readAnswerFrequencies()).get(question)).toEqual([
      { answer: '10–20 небольших задач', count: 2 }, { answer: '3–5 задач', count: 1 },
    ]);
    expect(knownReply({ title: '', text: question }, { templates: new Map(), qaMap: answers }))
      .toMatchObject({ answer: '10–20 небольших задач | 3–5 задач', perfect: false });
    expect(allAnswersExact([{ type: 'textarea', question, currentValue: answers.get(question) }], answers)).toBe(false);
    // A historical answer to a new question is also learned into qa.lino.
    await learnChatQuestions({ ...chat('4', 'Отвечаю'), messages: chat('4', 'Отвечаю').messages.map((m) => m.mine ? m : { ...m, text: 'Как вы проверяете результат?' }) },
      { history, qaDatabase, log: () => {} });
    expect((await original.readQADatabase()).get('Как вы проверяете результат?')).toBe('Отвечаю');
  }));

  test('frequencies persist once per sent reply, including repeats in the same chat, without counting bot summaries', () => fixture(async (dir) => {
    const history = createChatHistory(path.join(dir, 'history.json'));
    const conversation = { ...chat('1', 'Пять задач'), messages: [
      ...chat('1', 'Пять задач').messages,
      { id: '13', mine: false, title: '', text: question },
      { id: '14', mine: true, title: '', text: 'Пять задач' },
      { id: '15', mine: false, title: 'Робот-рекрутер', text: `${question}: Пять задач` },
    ] };
    for (let i = 0; i < 3; i += 1) await history.record(conversation);
    const persisted = JSON.parse(await fs.readFile(path.join(dir, 'history.json'), 'utf8'));
    expect(persisted['1'].answerCounts).toEqual([{ question, answer: 'Пять задач', count: 2 }]);
    const database = withChatHistoryAnswers(createQADatabase(path.join(dir, 'qa.lino')), { history });
    expect((await database.readAnswerFrequencies()).get(question)).toEqual([{ answer: 'Пять задач', count: 2 }]);
    // A summary alone supplies a historical candidate, without inventing a sent occurrence.
    expect(countChatAnswers([conversation.messages.at(-1)])).toEqual([{ question, answer: 'Пять задач', count: 0 }]);
  }));

  test('an old archive gets durable frequency counts without reopening the browser', () => fixture(async (dir) => {
    const file = path.join(dir, 'history.json');
    await fs.writeFile(file, JSON.stringify({ 1: chat('1', 'Первый ответ'), 2: chat('2', 'Первый ответ'), 3: chat('3', 'Второй ответ') }));
    const history = createChatHistory(file);
    expect(await history.recount()).toEqual({ chats: 3, sentAnswers: 3 });
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(persisted['1'].answerCounts).toEqual([{ question, answer: 'Первый ответ', count: 1 }]);
    const database = withChatHistoryAnswers(createQADatabase(path.join(dir, 'qa.lino')), { history });
    expect((await database.readAnswerFrequencies()).get(question)).toEqual([
      { answer: 'Первый ответ', count: 2 }, { answer: 'Второй ответ', count: 1 },
    ]);
    expect(await history.recount()).toEqual({ chats: 3, sentAnswers: 3 });
  }));

  test('message versions retain their frequencies without recounting unrelated answers', () => {
    const counts = countChatAnswers([
      ...chat('1', 'Новая формулировка').messages.map((m) => m.mine ? { ...m, previousTexts: ['Первый ответ', 'Новая формулировка'] } : m),
      { id: '13', mine: false, title: '', text: 'Когда готовы начать?' },
      { id: '14', mine: true, title: '', text: 'Через неделю' },
    ]);
    expect(counts.find(({ answer }) => answer === 'Первый ответ').count).toBe(1);
    expect(counts.find(({ answer }) => answer === 'Новая формулировка').count).toBe(1);
    expect(counts.find(({ answer }) => answer === 'Через неделю').count).toBe(1);
  });

  test('normalized duplicate questions and contacts deduplicate, checkbox selections keep their meaning', () => fixture(async (dir) => {
    const history = createChatHistory(path.join(dir, 'history.json'));
    const db = createQADatabase(path.join(dir, 'qa.lino'));
    await db.addOrUpdateQA('Ваш Telegram?', '{{telegram}}');
    await db.addOrUpdateQA('Ваш стек?', ['Python', 'Go']);
    await history.record({ id: '1', vacancy: 'Developer', messages: [
      { id: '1', mine: false, title: '', text: 'ваш telegram?' },
      { id: '2', mine: true, title: '', text: '@example' },
      { id: '3', mine: false, title: '', text: 'Ваш стек?' },
      { id: '4', mine: true, title: '', text: 'Python, Go' },
    ] });
    const contacts = { telegram: '@example' };
    const answers = await withContacts(withChatHistoryAnswers(db, { history, contacts }), contacts).readQADatabase();
    expect(answers.get('Ваш Telegram?')).toBe('@example');
    expect(answers.get('Ваш стек?')).toEqual(['Python', 'Go']);
  }));

  test('a named outgoing answer sent in several bubbles is learned in full', () => {
    const { questions } = learnedPairs([
      { mine: false, title: 'Ирина', text: question },
      { mine: true, title: 'Константин', text: 'До 5 крупных проектов.' },
      { mine: true, title: 'Константин', text: 'Либо до 20 небольших задач.' },
    ]);
    expect(questions).toEqual([[question, 'До 5 крупных проектов.\n\nЛибо до 20 небольших задач.']]);
    expect(learnedPairs([
      { mine: false, title: '', text: 'Как проверяете результат?' },
      { mine: true, title: '', text: 'Проверяю тестами. А вы как?' },
    ]).questions[0][1]).toBe('Проверяю тестами. А вы как?');
  });

  test('a sent answer is captured before the user changes chats, without waiting for a polling interval', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const snapshots = [];
    let mutated;
    let current = chat('1', 'Sent now');
    try {
      globalThis.window = {
        location: { pathname: '/chat/1' },
        MutationObserver: class {
          constructor(callback) { mutated = callback; }
          observe() {}
        },
        __hhRecordChat: async (snapshot) => { snapshots.push(snapshot); },
      };
      globalThis.document = { documentElement: {} };
      observeChat(() => current, '');
      mutated();
      current = chat('2', 'Another reply');
      window.location.pathname = '/chat/2';
      mutated();
      await Promise.resolve();
      expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['1', '2']);
      expect(snapshots[0].messages.at(-1).text).toBe('Sent now');
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

describe('complete chat history', () => {
  test('the duplicate styled checkbox cannot leave a full history scan filtered to unread chats', () => {
    const previous = globalThis.document;
    const clicked = [];
    const outer = { checked: true, dataset: {}, click() { clicked.push('outer'); this.checked = false; } };
    const inner = { checked: true, dataset: { qa: 'chatik-checkbox-only-unread' }, click() { clicked.push('inner'); this.checked = false; } };
    try {
      globalThis.document = { querySelectorAll: () => [outer, inner] };
      expect(setUnreadFilter(false)).toBe(false);
      expect(clicked).toEqual(['outer']);
      expect(setUnreadFilter(false)).toBe(false);
      expect(clicked).toEqual(['outer']);
    } finally { globalThis.document = previous; }
  });

  test('older pages are merged even when scrolling virtualizes the newer bubbles away', async () => {
    const pages = [
      [{ id: '3', mine: true, title: '', text: 'The answer' }],
      [{ id: '2', mine: false, title: 'Ирина', text: question }],
      [{ id: '1', mine: true, title: 'Отклик на вакансию', text: 'Cover letter' }],
    ];
    let at = 0;
    const saved = [];
    const full = await readFullChat({ evaluate: async () => { at += 1; return true; } }, {
      read: async () => ({ id: '1', messages: pages[at] }), pause: async () => {}, onRead: async (snapshot) => saved.push(snapshot),
    });
    expect(full.historyComplete).toBe(true);
    expect(full.messages.map((message) => message.id)).toEqual(['1', '2', '3']);
    expect(learnedPairs(full.messages).questions).toEqual([[question, 'The answer']]);
    expect(saved.at(-1).historyComplete).toBe(true);
  });

  test('a stalled load is not marked complete or treated as a checked history', async () => {
    const full = await readFullChat({ evaluate: async () => true }, {
      read: async () => chat('1', 'Answer'), pause: async () => {}, maxIdle: 2,
    });
    expect(full.historyComplete).toBe(false);
  });
});
