/**
 * Tests for the periodic Q&A save: unchanged answers are not written again, and a question read
 * twice in one save (a choice and its "Свой вариант" text) does not flip between two answers
 */
import { describe, test, assert } from 'test-anywhere';
import { rejects } from 'node:assert/strict';
import { saveQAPairs, savePairs } from '../src/vacancy-response.mjs';

function fakeSave(pairs) {
  const writes = [];
  const commander = { evaluate: async () => pairs };
  const addOrUpdateQA = async (question, answer) => {
    writes.push([question, answer]);
  };
  return { writes, save: () => saveQAPairs({ commander, addOrUpdateQA }) };
}

describe('saveQAPairs', () => {
  test('an unchanged answer is written once', async () => {
    const { writes, save } = fakeSave([{ question: 'autosave-1: Ваш стек?', answer: 'Go' }]);
    assert.equal(await save(), 1);
    assert.equal(await save(), 0);
    assert.equal(writes.length, 1);
  });

  test('two answers of one question in a save do not overwrite each other on every save', async () => {
    const { writes, save } = fakeSave([
      { question: 'autosave-2: Работали ли Вы с AI-продуктами?', answer: 'Да, в kaiten' },
      { question: 'autosave-2: Работали ли Вы с AI-продуктами?', answer: 'Да' },
    ]);
    await save();
    await save();
    await save();
    assert.deepEqual(writes, [['autosave-2: Работали ли Вы с AI-продуктами?', 'Да']]);
  });

  test('a strict read failure is not reported as an empty successful save', async () => {
    const commander = { evaluate: async () => { throw new Error('cannot read the form'); } };
    let written = false;
    await rejects(saveQAPairs({ commander, strict: true, addOrUpdateQA: async () => { written = true; } }), /cannot read/);
    assert.equal(written, false);
  });

  test('concurrent saves finish in order, and the final complete answer wins', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const writes = [];
    const write = async (question, answer) => { writes.push(answer); if (answer === 'partial') await gate; };
    const first = savePairs([{ question: 'same question', answer: 'partial' }], write);
    const last = savePairs([{ question: 'same question', answer: 'full final answer' }], write);
    release();
    await Promise.all([first, last]);
    assert.deepEqual(writes, ['partial', 'full final answer']);
  });

  test('independent destinations do not share a save cache; failed writes can be retried', async () => {
    const pairs = [{ question: 'same question', answer: 'answer' }];
    const first = []; const second = [];
    await savePairs(pairs, async (q, a) => first.push(a));
    await savePairs(pairs, async (q, a) => second.push(a));
    assert.deepEqual(first, second);
    let attempts = 0;
    const write = async () => { if (++attempts === 1) throw new Error('disk full'); };
    await rejects(savePairs(pairs, write), /disk full/);
    assert.equal(await savePairs(pairs, write), 1);
  });
});
