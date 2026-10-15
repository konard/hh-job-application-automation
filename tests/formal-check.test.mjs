/**
 * What Formal AI's formalization of a saved question or answer misses
 */
import { describe, test, assert } from 'test-anywhere';
import { formalProblems } from '../src/formal-check.mjs';

const unknown = (surface) => ({ kind: 'unknown', surface });
const number = (surface) => ({ kind: 'number', surface });
const checks = (...args) => formalProblems(...args).map((problem) => problem.check);

describe('formalProblems', () => {
  test('a question with every word unknown, read as a claim', () => {
    const statements = [{ text: 'Где вы находитесь?', polarity: 'asserted', subject: unknown('Где'), terms: [unknown('вы'), unknown('находитесь')] }];
    assert.deepEqual(checks('Где вы находитесь?', statements, 'question'), ['all-words-unknown', 'question-as-claim']);
  });

  test('«Да» not recognized, «Нет» not denied', () => {
    assert.ok(checks('Да.', [{ text: 'Да.', polarity: 'asserted', subject: unknown('Да'), terms: [] }], 'answer').includes('yes-not-recognized'));
    assert.ok(checks('Нет', [{ text: 'Нет', polarity: 'asserted', subject: unknown('Нет'), terms: [] }], 'answer').includes('no-not-denied'));
    assert.ok(!checks('Нет', [{ text: 'Нет', polarity: 'denied', subject: { kind: 'negation', surface: 'Нет' }, terms: [] }], 'answer').includes('no-not-denied'));
  });

  test('«450 000 ₽» split into two numbers, the currency dropped', () => {
    const statements = [{ text: 'От 450 000 ₽ в месяц на руки.', polarity: 'asserted', subject: unknown('От'), terms: [number('450'), number('000'), unknown('месяц')] }];
    const found = checks('От 450 000 ₽ в месяц на руки.', statements, 'answer');
    assert.ok(found.includes('number-split'));
    assert.ok(found.includes('currency-dropped'));
  });

  test('«$file» in a script is not a currency', () => {
    assert.ok(!checks('echo $file $1', [], 'answer').includes('currency-dropped'));
  });

  test('a sentence cut inside «Node.js»', () => {
    const statements = [
      { text: 'Был ли опыт с Node.', polarity: 'asserted', subject: unknown('Был'), terms: [{ kind: 'name', surface: 'Node' }] },
      { text: 'js?', polarity: 'asserted', subject: unknown('js'), terms: [] },
    ];
    assert.ok(checks('Был ли опыт с Node.js?', statements, 'question').includes('sentence-cut-in-word'));
  });

  test('a bare number says it all', () => {
    assert.deepEqual(checks('8', [{ text: '8', polarity: 'asserted', subject: number('8'), terms: [] }], 'answer'), []);
  });
});
