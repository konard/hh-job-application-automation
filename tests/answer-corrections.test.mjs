import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { allowedCorrectedAnswer, applyAnswerCorrections, compileAnswerCorrections, createAnswerCorrections } from '../src/answer-corrections.mjs';
import { createQADatabase } from '../src/qa-database.mjs';
import { createChatHistory } from '../src/chat-history.mjs';
import { learnChatQuestions, withChatHistoryAnswers } from '../src/chat-learning.mjs';
import { withContacts } from '../src/contacts.mjs';

const project = 'Расскажите о вашем проекте с ИИ?';
const rag = 'Работали ли вы с RAG?';
const approvedProject = 'Разработал оркестратор агентов для GitHub.';
const approvedRag = 'Разрабатывал юридических ассистентов с гибридным поиском.';
const wrong = 'Ошибочный пример, который пользователь явно отклонил как описание своего опыта.';
const apology = 'Прошу прощения за предыдущий ответ: этот черновик был отправлен по ошибке.';
const data = { version: 1, answers: [{ question: project, answer: approvedProject }, { question: rag, answer: approvedRag }],
  rejected: [wrong, apology] };

describe('explicit owner answer corrections', () => {
  test('approved answers replace historical variants without inserting apologies or other topics', () => {
    const policy = compileAnswerCorrections(data);
    const current = new Map([[project, wrong], [rag, `${apology}\n\n${approvedProject}\n\n${approvedRag}`], ['Other?', ['Yes', 'No']]]);
    const fixed = applyAnswerCorrections(current, policy);
    expect(fixed.get(project)).toBe(approvedProject);
    expect(fixed.get(rag)).toBe(approvedRag);
    expect(fixed.get('Other?')).toEqual(['Yes', 'No']);
    expect(current.get(project)).toBe(wrong);
    expect(allowedCorrectedAnswer(rag, approvedProject, policy)).toBe(false);
  });
  test('rejected answers remain rejected in markdown summaries, wrapped messages and whitespace variants', () => {
    const policy = compileAnswerCorrections(data);
    expect(allowedCorrectedAnswer('Another wording?', `*${wrong.replaceAll(' ', '\n\n')}*`, policy)).toBe(false);
    expect(allowedCorrectedAnswer('Another wording?', `Acknowledgement. ${apology}\n\n${approvedRag}`, policy)).toBe(false);
    expect(applyAnswerCorrections(new Map([['Paraphrased old question?', wrong]]), policy).has('Paraphrased old question?')).toBe(false);
    const short = compileAnswerCorrections({ version: 1, answers: [], rejected: ['No'] });
    expect(allowedCorrectedAnswer('Q?', 'No', short)).toBe(false);
    expect(allowedCorrectedAnswer('Q?', 'Node.js experience.', short)).toBe(true);
  });
  test('corrections survive restart, merge safely, refresh an existing reader and remain private', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-corrections-'));
    const file = path.join(dir, 'answers', 'corrections.json');
    const first = createAnswerCorrections(file), second = createAnswerCorrections(file);
    try {
      expect((await first.read()).approved.size).toBe(0);
      await second.update({ answers: data.answers, rejected: data.rejected });
      expect((await first.read()).approved.get(project.toLowerCase().replace('?', ''))).toBe(approvedProject);
      await Promise.all([first.update({ answers: [{ question: 'SOLID?', answer: 'Применяю SOLID.' }] }),
        second.update({ rejected: ['Ещё один отдельно отклонённый ответ для проверки слияния.'] })]);
      const restarted = await createAnswerCorrections(file).read();
      expect(restarted.approved.size).toBe(3);
      expect(restarted.rejected.length).toBe(3);
      expect((await fs.stat(file)).mode & 0o077).toBe(0);
      await expect(first.update({ answers: [{ question: project, answer: wrong }] })).rejects.toThrow('rejected content');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  test('history frequencies, edited messages and bot summaries cannot restore the rejected answer', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'corrected-history-'));
    const corrections = { read: async () => compileAnswerCorrections(data) };
    try {
      const raw = createQADatabase(path.join(dir, 'qa.lino'));
      await raw.addOrUpdateQA(project, wrong);
      const history = createChatHistory(path.join(dir, 'history.json'));
      const messages = [{ id: '1', mine: false, text: project },
        { id: '2', mine: true, text: wrong, previousTexts: [`*${wrong}*`] },
        { id: '3', mine: false, text: rag }, { id: '4', mine: true, text: `${apology}\n\n${approvedProject}\n\n${approvedRag}` },
        { id: '5', mine: false, text: `В разговоре с кандидатом я узнал:\n- ${project} Ответ:\n- *${wrong}*\n\nВопросов к работодателю не было` }];
      const chat = { id: '123', messages };
      await history.record(chat);
      const sources = withChatHistoryAnswers(raw, { history, corrections });
      expect((await sources.readQADatabase()).get(project)).toBe(approvedProject);
      expect((await sources.readQADatabase()).get(rag)).toBe(approvedRag);
      expect((await sources.readSavedQADatabase()).get(project)).toBe(approvedProject);
      const frequencies = await sources.readAnswerFrequencies();
      expect(frequencies.get(project).some(a => a.answer.includes('Ошибочный'))).toBe(false);
      await raw.writeQADatabase(new Map());
      // Production wrappers carry the policy through contact expansion into learning.
      await learnChatQuestions(chat, { history, qaDatabase: withContacts(sources, {}), log: () => {} });
      expect((await raw.readQADatabase()).size).toBe(0);
      // The transcript remains an accurate record; only reuse and learning are corrected.
      expect((await history.read())['123'].messages[1].text).toBe(wrong);
      expect((await sources.readQADatabase()).get(project)).toBe(approvedProject);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
