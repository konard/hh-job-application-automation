/**
 * Tests for sending a form without asking: only when every question is a saved question word
 * for word and the form holds exactly the saved answers
 */
import { describe, test, assert } from 'test-anywhere';
import { allAnswersExact } from '../src/qa.mjs';

const ENGLISH = 'Твой уровень владения английским языком:';
const B2C = 'Есть ли у тебя опыт работы с крупными B2C-продуктами?';
const STACK = 'С какими технологиями работали?';

const radio = (question, options, checked) => ({
  type: 'radio',
  question,
  options: options.map((optionText, i) => ({ value: String(i), optionText, checked: optionText === checked })),
});
const checkbox = (question, options, checked) => ({
  type: 'checkbox',
  question,
  options: options.map((optionText, i) => ({ value: String(i), optionText, checked: checked.includes(optionText) })),
});
const textarea = (question, currentValue) => ({ type: 'textarea', question, currentValue });

describe('allAnswersExact', () => {
  const qaMap = new Map([[ENGLISH, 'В2'], [B2C, 'Да, Kaiten'], [STACK, ['Go', 'PostgreSQL']]]);

  test('saved questions with exactly the saved answers', () => {
    assert.equal(allAnswersExact([
      radio(ENGLISH, ['В1', 'В2', 'С1 и выше'], 'В2'),
      textarea(B2C, 'Да, Kaiten'),
      checkbox(STACK, ['Go', 'Java', 'PostgreSQL'], ['PostgreSQL', 'Go']),
    ], qaMap), true);
  });

  test('a question matched only approximately is not exact', () => {
    assert.equal(allAnswersExact([radio('Уровень владения английским языком:', ['В2'], 'В2')], qaMap), false);
  });

  test('an answer changed or chosen in the browser is not the saved one', () => {
    assert.equal(allAnswersExact([textarea(B2C, 'Да, Kaiten и Wildberries')], qaMap), false);
    assert.equal(allAnswersExact([radio(ENGLISH, ['В2', 'С1 и выше'], 'С1 и выше')], qaMap), false);
    assert.equal(allAnswersExact([checkbox(STACK, ['Go', 'Java', 'PostgreSQL'], ['Go'])], qaMap), false);
  });

  test('an unused "Свой вариант" text box of a choice question does not count', () => {
    assert.equal(allAnswersExact([radio(ENGLISH, ['В2', 'Свой вариант'], 'В2'), textarea(ENGLISH, '')], qaMap), true);
  });

  test('a form without questions is not sent this way', () => {
    assert.equal(allAnswersExact([], qaMap), false);
  });
});
