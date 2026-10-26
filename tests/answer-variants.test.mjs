import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAnswerFinalPeriod, mergeAnswerFrequencies, normalizeAnswerVariants } from '../src/answer-variants.mjs';
import { answerText, hasAnswerVariants, allAnswersExact } from '../src/qa.mjs';
import { createQADatabase } from '../src/qa-database.mjs';
import { knownReply } from '../src/chat-answers.mjs';

const salary = 'От 450 000 ₽ в месяц на руки';

describe('optional final periods in answer variants', () => {
  test('prefill prefers the dotted answer regardless of variant order, without inventing punctuation', () => {
    for (const variants of [`${salary} | ${salary}.`, `${salary}. | ${salary}`]) {
      expect(normalizeAnswerVariants(variants)).toBe(`${salary}.`);
      expect(answerText(variants)).toBe(`${salary}.`);
      expect(hasAnswerVariants(variants)).toBe(false);
    }
    expect(normalizeAnswerVariants(salary)).toBe(salary);
    expect(normalizeAnswerVariants('Да | Да. | Нет')).toBe('Да. | Нет');
    expect(hasAnswerVariants('Да | Да. | Нет')).toBe(true);
    expect(normalizeAnswerVariants(['Да', 'Да.'])).toEqual(['Да', 'Да.']);
  });

  test('other punctuation, different text and meaningful alternatives remain separate', () => {
    for (const variants of ['Ожидаю | Ожидаю...', 'Да | Да!', 'Да | да.', 'Да? | Да?.',
      `${salary}. | От 530 000 ₽ в месяц до налогов.`]) {
      expect(normalizeAnswerVariants(variants)).toBe(variants);
      expect(hasAnswerVariants(variants)).toBe(true);
    }
    // A lone saved answer is still compared literally, including code and free text.
    expect(allAnswersExact([{ type: 'textarea', question: 'Code?', currentValue: 'a.b.' }], new Map([['Code?', 'a.b']]))).toBe(false);
  });

  test('the alternate style resolves only existing conflicts, with the same combined frequencies', () => {
    const options = { finalPeriod: 'without' };
    expect(normalizeAnswerVariants(`${salary} | ${salary}.`, options)).toBe(salary);
    expect(normalizeAnswerVariants(`${salary}. | ${salary}`, options)).toBe(salary);
    expect(normalizeAnswerVariants(`${salary}.`, options)).toBe(`${salary}.`);
    expect(normalizeAnswerVariants(salary, { finalPeriod: 'with' })).toBe(salary);
    expect(mergeAnswerFrequencies([
      { answer: salary, count: 2 }, { answer: `${salary}.`, count: 2 }, { answer: 'Другая сумма.', count: 3 },
    ], options)).toEqual([{ answer: salary, count: 4 }, { answer: 'Другая сумма.', count: 3 }]);
    // Even frequency aggregation must not strip a period from a lone observed spelling.
    expect(mergeAnswerFrequencies([{ answer: `${salary}.`, count: 1 }], options))
      .toEqual([{ answer: `${salary}.`, count: 1 }]);
  });

  test('prefill and exact matching use the selected environment preference', () => {
    const before = process.env.ANSWER_FINAL_PERIOD;
    try {
      process.env.ANSWER_FINAL_PERIOD = 'without';
      const question = 'Какая зарплата?';
      const qaMap = new Map([[question, `${salary}. | ${salary}`]]);
      expect(answerText(qaMap.get(question))).toBe(salary);
      expect(allAnswersExact([{ type: 'textarea', question, currentValue: salary }], qaMap)).toBe(true);
      expect(knownReply({ title: '', text: question }, { templates: new Map(), qaMap }))
        .toMatchObject({ answer: salary, perfect: true });
    } finally {
      if (before === undefined) delete process.env.ANSWER_FINAL_PERIOD;
      else process.env.ANSWER_FINAL_PERIOD = before;
    }
  });

  test('answer storage preserves first saves, resolving conflicts only on later saves and loads', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-style-storage-'));
    try {
      for (const finalPeriod of ['with', 'without']) {
        for (const first of [salary, `${salary}.`]) {
          const file = path.join(dir, `${finalPeriod}-${first.endsWith('.')}.lino`);
          const options = { resolveVariants: true, finalPeriod };
          const db = createQADatabase(file, options);
          await db.addOrUpdateQA('Salary?', first);
          expect((await db.readQADatabase()).get('Salary?')).toBe(first);
          expect(await fs.readFile(file, 'utf8')).toBe(`Salary?\n  ${first}\n`);
          await db.addOrUpdateQA('Salary?', first === salary ? `${salary}.` : salary);
          const preferred = finalPeriod === 'with' ? `${salary}.` : salary;
          expect((await createQADatabase(file, options).readQADatabase()).get('Salary?')).toBe(preferred);
          expect(await fs.readFile(file, 'utf8')).toBe(`Salary?\n  ${preferred}\n`);
          const legacy = `Salary?\n  ${salary} | ${salary}.\n`;
          await fs.writeFile(file, legacy);
          const loaded = await db.readQADatabase();
          expect(loaded.get('Salary?')).toBe(preferred);
          expect(await fs.readFile(file, 'utf8')).toBe(legacy);
          await db.writeQADatabase(loaded);
          expect(await fs.readFile(file, 'utf8')).toBe(`Salary?\n  ${preferred}\n`);
          await db.addOrUpdateQA('Salary?', 'Другая сумма.');
          expect((await db.readQADatabase()).get('Salary?')).toBe('Другая сумма.');
          await db.addOrUpdateQA('Stack?', ['Go', 'Go.']);
          expect((await db.readQADatabase()).get('Stack?')).toEqual(['Go', 'Go.']);
        }
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('the local setting works for standalone workers; environment overrides it and invalid styles fail', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-style-settings-'));
    try {
      const file = path.join(dir, '.lenv');
      await fs.writeFile(file, 'ANSWER_FINAL_PERIOD: "without"\n');
      expect(getAnswerFinalPeriod({ env: {}, file })).toBe('without');
      expect(getAnswerFinalPeriod({ env: { ANSWER_FINAL_PERIOD: 'with' }, file })).toBe('with');
      expect(getAnswerFinalPeriod({ env: {}, file: path.join(dir, 'missing') })).toBe('with');
      expect(() => getAnswerFinalPeriod({ env: { ANSWER_FINAL_PERIOD: 'invalid' }, file })).toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('an invalid conflict preference cannot replace the database with an empty read', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-style-invalid-'));
    try {
      const file = path.join(dir, 'qa.lino');
      const original = 'Saved?\n  Да | Да.\n';
      await fs.writeFile(file, original);
      const invalid = createQADatabase(file, { resolveVariants: true, finalPeriod: 'invalid' });
      await expect(invalid.addOrUpdateQA('Another?', 'Answer')).rejects.toThrow();
      expect(await fs.readFile(file, 'utf8')).toBe(original);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('a single normalized answer can be sent automatically in a form or exact chat question', () => {
    const question = 'Какая зарплата?';
    const qaMap = new Map([[question, `${salary} | ${salary}.`]]);
    expect(allAnswersExact([{ type: 'textarea', question, currentValue: answerText(qaMap.get(question)) }], qaMap)).toBe(true);
    expect(knownReply({ title: '', text: question }, { templates: new Map(), qaMap }))
      .toMatchObject({ answer: `${salary}.`, perfect: true });
  });

  test('normalizing a prefill does not rewrite the original saved alternatives', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'answer-variants-'));
    try {
      const file = path.join(dir, 'qa.lino');
      const db = createQADatabase(file);
      const original = `Salary?\n  ${salary} | ${salary}.\n`;
      await fs.writeFile(file, original);
      const answers = await db.readQADatabase();
      expect(answerText(answers.get('Salary?'))).toBe(`${salary}.`);
      await db.writeQADatabase(answers);
      expect(await fs.readFile(file, 'utf8')).toBe(original);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
