/**
 * Tests for typing a long text: a field that takes keys slowly gets the whole text at once
 */
import { describe, test, assert } from 'test-anywhere';
import { typeLongText } from '../src/helpers/page-helpers.mjs';

describe('typeLongText', () => {
  test('typed like a person when the field keeps up', async () => {
    const calls = [];
    const commander = { evaluate: async () => '', fillTextArea: async (options) => (calls.push(options), { filled: true, verified: true }) };
    await typeLongText(commander, { selector: 'textarea', text: 'Здравствуйте' });
    assert.deepEqual(calls.map(({ simulateTyping, checkEmpty }) => [simulateTyping, checkEmpty]), [[true, true]]);
  });

  test('put in at once after a typing timeout, over what was typed so far', async () => {
    const calls = [];
    const timeout = Object.assign(new Error('locator.type: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
    const commander = {
      evaluate: async () => '',
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

  test('set directly when the page is too slow even for putting it in at once', async () => {
    const timeout = Object.assign(new Error('waitFor: Timeout 5000ms exceeded.'), { name: 'TimeoutError' });
    let evaluated = 0;
    const commander = {
      evaluate: async ({ args }) => (evaluated++ === 0 ? '' : args[1]),
      fillTextArea: async () => {
        throw timeout;
      },
    };
    const result = await typeLongText(commander, { selector: 'textarea', text: 'Здравствуйте' });
    assert.deepEqual(result, { filled: true, verified: true, actualValue: 'Здравствуйте' });
  });

  test('a draft holding the start of the text is completed, not left cut off', async () => {
    const calls = [];
    const commander = {
      evaluate: async () => 'Здравствуйте,\n\nДля оперативной связи пре',
      fillTextArea: async (options) => (calls.push(options), { filled: true, verified: true }),
    };
    await typeLongText(commander, { selector: 'textarea', text: 'Здравствуйте,\n\nДля оперативной связи предлагаю Telegram.' });
    assert.deepEqual(calls.map(({ simulateTyping, checkEmpty }) => [simulateTyping, checkEmpty]), [[false, false]]);
  });

  test('another text in the field is left as it is', async () => {
    const calls = [];
    const commander = {
      evaluate: async () => 'Свой текст пользователя',
      fillTextArea: async (options) => (calls.push(options), { filled: false }),
    };
    await typeLongText(commander, { selector: 'textarea', text: 'Здравствуйте' });
    assert.deepEqual(calls.map(({ simulateTyping, checkEmpty }) => [simulateTyping, checkEmpty]), [[true, true]]);
  });
});
