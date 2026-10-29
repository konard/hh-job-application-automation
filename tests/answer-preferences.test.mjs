import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readAnswerPreferences, preferredAnswer, fitsAvailabilityQuestion } from '../src/answer-preferences.mjs';
import { mergeAnswerFrequencies, normalizeAnswerVariants } from '../src/answer-variants.mjs';
import { createQADatabase } from '../src/qa-database.mjs';
import { createChatHistory } from '../src/chat-history.mjs';
import { withChatHistoryAnswers } from '../src/chat-learning.mjs';

const question = 'Когда вы будете готовы выйти на работу, в случае успешного прохождения интервью?';
const preferred = 'В течении недели-двух с момента получения офера.';
const variants = ['В случае успешного прохождения в течении одной двух недель.', 'В течении одной-двух недель.',
  'Через 1-2 недели после получения офера.'];
const unrelated = 'Метрики производительности обычно - скорость отклика.';

describe('approved answer wording', () => {
  test('approved availability variants collapse, while different commitments and other topics stay literal', () => {
    expect(normalizeAnswerVariants([preferred, ...variants].join(' | '), { question })).toBe(preferred);
    expect(normalizeAnswerVariants(variants[0], { question })).toBe(preferred);
    expect(preferredAnswer('Сколько займёт проект?', variants[0])).toBe(variants[0]);
    expect(preferredAnswer(question, 'Через месяц.')).toBe('Через месяц.');
    expect(preferredAnswer(question, 'Через 2-3 недели.')).toBe('Через 2-3 недели.');
    expect(normalizeAnswerVariants(variants, { question })).toEqual(variants);
    expect(fitsAvailabilityQuestion(question, unrelated)).toBe(false);
    expect(fitsAvailabilityQuestion('Какие метрики производительности используете?', unrelated)).toBe(true);
    expect(fitsAvailabilityQuestion('Как выйти из сложной ситуации?', 'Ищу причину проблемы.')).toBe(true);
    expect(fitsAvailabilityQuestion('Готовы ли вы выйти на работу в офисе?', 'Да.')).toBe(true);
    expect(fitsAvailabilityQuestion('Готовы ли вы приступить к работе через 2 недели?', 'Да.')).toBe(true);
    expect(mergeAnswerFrequencies([{ answer: variants[0], count: 2 }, { answer: variants[1], count: 3 }], { question }))
      .toEqual([{ answer: preferred, count: 5 }]);
  });

  test('on load/save the approved data preference applies only to the matching question', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preferred-answers-'));
    try {
      const file = path.join(dir, 'qa.lino');
      const db = createQADatabase(file, { resolveVariants: true });
      await db.addOrUpdateQA(question, variants[0]);
      expect((await db.readQADatabase()).get(question)).toBe(preferred);
      expect(await fs.readFile(file, 'utf8')).toContain(preferred);
      await db.addOrUpdateQA('Как быстро будет готова функция?', variants[0]);
      expect((await db.readQADatabase()).get('Как быстро будет готова функция?')).toBe(variants[0]);
      await db.addOrUpdateQA('Checkboxes?', ['Да', 'Нет']);
      expect((await db.readQADatabase()).get('Checkboxes?')).toEqual(['Да', 'Нет']);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('history merges valid usage counts and hides the irrelevant reply without rewriting any messages', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preferred-history-'));
    try {
      const history = createChatHistory(path.join(dir, 'history.json'));
      for (const [index, answer] of [...variants, variants[0], unrelated].entries()) {
        await history.record({ id: String(index), vacancy: 'Developer', messages: [
          { id: `${index}q`, mine: false, text: question }, { id: `${index}a`, mine: true, text: answer },
        ] });
      }
      const before = await fs.readFile(path.join(dir, 'history.json'), 'utf8');
      const db = withChatHistoryAnswers(createQADatabase(path.join(dir, 'qa.lino')), { history });
      expect((await db.readQADatabase()).get(question)).toBe(preferred);
      expect((await db.readAnswerFrequencies()).get(question)).toEqual([{ answer: preferred, count: 4 }]);
      expect((await db.readAnswerFrequencies()).get(question)).toEqual([{ answer: preferred, count: 4 }]);
      expect(await fs.readFile(path.join(dir, 'history.json'), 'utf8')).toBe(before);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('the preference file reloads user edits and a missing file defines no aliases', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preferred-config-'));
    try {
      const file = path.join(dir, 'preferences.lino');
      expect(readAnswerPreferences(file).size).toBe(0);
      await fs.writeFile(file, '"Preferred."\n  "Alternative."\n');
      expect(readAnswerPreferences(file).get('Alternative.')).toBe('Preferred.');
      await fs.writeFile(file, '"Changed."\n  "Alternative."\n');
      expect(readAnswerPreferences(file).get('Alternative.')).toBe('Changed.');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
