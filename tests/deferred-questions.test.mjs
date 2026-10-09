/**
 * Tests for questions answered later: matching, the .lino store, and which vacancies wait
 */
import { describe, test, assert } from 'test-anywhere';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createDeferredQuestions, matchQuestion } from '../src/deferred-questions.mjs';

const PORTFOLIO = 'Какой портфель автоматизаций и AI-продуктов вам удалось реализовать? Как считали эффекты для бизнеса?';
const TEAM = 'Приходилось ли вам руководить командой? Сколько человек было в подчинении и какие это были роли?';

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deferred-questions-'));
  return path.join(dir, 'deferred-questions.lino');
}

describe('matchQuestion', () => {
  test('a fragment of the question matches it', () => {
    assert.equal(matchQuestion(PORTFOLIO, ['портфель автоматизаций']), 'портфель автоматизаций');
  });

  test('case, punctuation and informal address do not matter', () => {
    assert.equal(matchQuestion(PORTFOLIO, ['Какой портфель автоматизаций и AI-продуктов тебе удалось реализовать']),
      'Какой портфель автоматизаций и AI-продуктов тебе удалось реализовать');
  });

  test('another question is no match', () => {
    assert.equal(matchQuestion(TEAM, ['портфель автоматизаций', PORTFOLIO]), null);
  });

  test('no patterns, no match', () => {
    assert.equal(matchQuestion(PORTFOLIO, []), null);
  });
});

describe('createDeferredQuestions', () => {
  test('keeps vacancy IDs under each question and reads them back', async () => {
    const store = createDeferredQuestions(await tempFile());
    await store.defer([PORTFOLIO], '137956393');
    await store.defer([PORTFOLIO, TEAM], '138000001');
    await store.defer([PORTFOLIO], '137956393');
    assert.deepEqual([...await store.read()], [
      [PORTFOLIO, ['137956393', '138000001']],
      [TEAM, ['138000001']],
    ]);
  });

  test('writes a readable .lino file', async () => {
    const file = await tempFile();
    await createDeferredQuestions(file).defer([PORTFOLIO], '137956393');
    assert.equal(await fs.readFile(file, 'utf8'), `${PORTFOLIO}\n  137956393\n`);
  });

  test('another wording of a deferred question is kept under it', async () => {
    const store = createDeferredQuestions(await tempFile());
    await store.defer([PORTFOLIO], '1');
    await store.defer([PORTFOLIO.replace('вам', 'тебе')], '2');
    assert.deepEqual([...await store.read()], [[PORTFOLIO, ['1', '2']]]);
  });

  test('a sent vacancy is forgotten, and a question with no vacancies left with it', async () => {
    const store = createDeferredQuestions(await tempFile());
    await store.defer([PORTFOLIO, TEAM], '1');
    await store.defer([PORTFOLIO], '2');
    await store.forget('1');
    assert.deepEqual([...await store.read()], [[PORTFOLIO, ['2']]]);
  });

  test('a deferred question skips a form only while it is open', async () => {
    const store = createDeferredQuestions(await tempFile());
    await store.defer([PORTFOLIO], '1');
    assert.deepEqual(await store.questionsToSkip({ questions: [PORTFOLIO, TEAM], openQuestions: [PORTFOLIO] }), [PORTFOLIO]);
    assert.deepEqual(await store.questionsToSkip({ questions: [PORTFOLIO, TEAM], openQuestions: [TEAM] }), []);
  });

  test('a --skip-question skips a form whether answered or not', async () => {
    const store = createDeferredQuestions(await tempFile(), { skipQuestions: ['портфель автоматизаций', 'руководить командой'] });
    assert.deepEqual(await store.questionsToSkip({ questions: [PORTFOLIO, TEAM], openQuestions: [] }), [PORTFOLIO, TEAM]);
  });

  test('vacancies wait until their question is answered in qa.lino', async () => {
    const store = createDeferredQuestions(await tempFile());
    await store.defer([PORTFOLIO], '1');
    await store.defer([TEAM], '2');
    const qaMap = new Map([[TEAM, 'Да, до 12 человек']]);
    assert.deepEqual([...await store.pendingVacancyIds(qaMap)], ['1']);
  });

  test('vacancies of a --skip-question wait even when it is answered', async () => {
    const store = createDeferredQuestions(await tempFile(), { skipQuestions: ['руководить командой'] });
    await store.defer([TEAM], '2');
    assert.deepEqual([...await store.pendingVacancyIds(new Map([[TEAM, 'Да']]))], ['2']);
  });

  test('a missing file is an empty store', async () => {
    const store = createDeferredQuestions(await tempFile());
    assert.equal((await store.read()).size, 0);
    assert.equal((await store.pendingVacancyIds(new Map())).size, 0);
  });
});
