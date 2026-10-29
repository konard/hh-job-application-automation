/**
 * A saved answer of a similar question is used only when it can answer this one
 */
import { describe, test, assert } from 'test-anywhere';
import { answerFits } from '../src/qa.mjs';

describe('answerFits', () => {
  test('«да» or «нет» does not answer where, what or how many', () => {
    assert.equal(answerFits('Где вы находитесь?', 'Нет'), false);
    assert.equal(answerFits('Какую вилку рассматриваете для себя?', 'Да.'), false);
    assert.equal(answerFits('Where are you located?', 'No'), false);
  });

  test('a yes/no question takes it, and an open question a real answer', () => {
    assert.equal(answerFits('Вы находитесь в РФ?', 'Нет'), true);
    assert.equal(answerFits('Где вы находитесь?', 'В Нячанге, во Вьетнаме.'), true);
    assert.equal(answerFits('Как вы относитесь к переработкам?', 'Нормально'), true);
  });
  test('availability requires an answer about timing rather than performance metrics', () => {
    assert.equal(answerFits('Когда вы готовы выйти на работу?', 'Метрики производительности обычно - скорость отклика.'), false);
    assert.equal(answerFits('Когда вы готовы выйти на работу?', 'В течении недели-двух с момента получения офера.'), true);
  });
});
