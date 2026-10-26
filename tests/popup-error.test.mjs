/**
 * Generic application errors can be retried later; limits and blocks keep their own handling.
 */
import { describe, test, assert } from 'test-anywhere';
import { isPassingError } from '../src/vacancies.mjs';

describe('popup errors', () => {
  test('a generic error is eligible for a delayed retry', () => {
    assert.equal(isPassingError({ code: 'unknown', text: 'Произошла ошибка, попробуйте ещё раз' }), true);
  });

  test('the daily limit, a block or too many requests is not', () => {
    assert.equal(isPassingError({ code: 'negotiations-limit-exceeded', text: 'В течение 24 часов можно совершить не более 200 откликов' }), false);
    assert.equal(isPassingError({ code: 'unknown', text: 'Слишком много запросов, попробуйте позже' }), false);
    assert.equal(isPassingError({ code: 'unknown', text: 'Ваш аккаунт заблокирован' }), false);
    assert.equal(isPassingError(null), false);
  });
});
