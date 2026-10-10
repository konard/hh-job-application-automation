/**
 * Tests for the periodic Q&A save: unchanged answers are not written again, and a question read
 * twice in one save (a choice and its "Свой вариант" text) does not flip between two answers
 */
import { describe, test, assert } from 'test-anywhere';
import { saveQAPairs } from '../src/vacancy-response.mjs';

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
});
