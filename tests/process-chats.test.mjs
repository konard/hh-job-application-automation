/**
 * The unread-chat processor of apply (--process-chats): its options, and when a chat left for
 * the user counts as answered
 */
import { describe, test, assert } from 'test-anywhere';
import { createConfig } from '../src/config.mjs';
import { isChatAnswered } from '../src/chat-answers.mjs';

const configOf = (...args) => {
  const saved = process.argv;
  process.argv = [saved[0], 'apply.mjs', '--message', 'Hello', ...args];
  try {
    return createConfig();
  } finally {
    process.argv = saved;
  }
};

describe('apply --process-chats', () => {
  test('is off by default and checks every 2 hours when on', () => {
    assert.equal(configOf().processChats, false);
    const config = configOf('--process-chats');
    assert.equal(config.processChats, true);
    assert.equal(config.chatsIntervalMinutes, 120);
    assert.equal(configOf('--process-chats', '--chats-interval-minutes', '30').chatsIntervalMinutes, 30);
  });
});

describe('isChatAnswered', () => {
  const employer = { mine: false, text: 'Расскажите о себе' };
  const mine = { mine: true, text: 'Добрый день' };

  test('a chat whose last message is the employer\'s waits for the user', () => {
    assert.equal(isChatAnswered({ canReply: true, messages: [mine, employer] }), false);
  });

  test('the user\'s own message last: answered', () => {
    assert.equal(isChatAnswered({ canReply: true, messages: [employer, mine] }), true);
  });

  test('a chat closed for replies needs nothing more', () => {
    assert.equal(isChatAnswered({ canReply: false, messages: [employer] }), true);
  });
});
