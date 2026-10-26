import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeAnswerVariants } from '../src/answer-variants.mjs';
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
