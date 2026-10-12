/**
 * Tests for typing a long text: a field that takes keys slowly gets the whole text at once
 */
import { describe, test, assert } from 'test-anywhere';
import { typeLongText } from '../src/helpers/page-helpers.mjs';

describe('typeLongText', () => {
  test('typed like a person when the field keeps up', async () => {
    const calls = [];
    const commander = { fillTextArea: async (options) => (calls.push(options), { filled: true, verified: true }) };
    await typeLongText(commander, { selector: 'textarea', text: 'Здравствуйте' });
    assert.deepEqual(calls.map(({ simulateTyping, checkEmpty }) => [simulateTyping, checkEmpty]), [[true, true]]);
  });

  test('put in at once after a typing timeout, over what was typed so far', async () => {
    const calls = [];
    const timeout = Object.assign(new Error('locator.type: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
    const commander = {
      fillTextArea: async (options) => {
        calls.push(options);
        if (options.simulateTyping) {
          throw timeout;
        }
        return { filled: true, verified: true };
      },
    };
    const result = await typeLongText(commander, { selector: 'textarea', text: 'Здравствуйте' });
    assert.ok(result.verified);
    assert.deepEqual(calls.map(({ simulateTyping, checkEmpty }) => [simulateTyping, checkEmpty]), [[true, true], [false, false]]);
  });
});
