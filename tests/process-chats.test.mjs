/**
 * The unread-chat processor of apply (--process-chats): its options, and when a chat left for
 * the user counts as answered
 */
import { describe, test, assert } from 'test-anywhere';
import { createConfig } from '../src/config.mjs';
import { isChatAnswered, userIsActive, USER_IDLE_MS } from '../src/chat-answers.mjs';

const configOf = (...args) => {
  const saved = process.argv;
  process.argv = [saved[0], 'apply.mjs', '--message', 'Hello', ...args];
  try {
    return createConfig();
  } finally {
    process.argv = saved;
  }
};

describe('apply --clear-rejections', () => {
  test('is on by default, every 2 hours, and can be turned off', () => {
    assert.equal(configOf().clearRejections, true);
    assert.equal(configOf().chatsIntervalMinutes, 120);
    assert.equal(configOf('--no-clear-rejections').clearRejections, false);
  });
});

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

describe('resuming rejection clearing after answering or switching chats', () => {
  test('an empty reply field resumes clearing after the short idle grace', () => {
    const sentAt = 100000;
    const afterSending = { at: sentAt, typing: false };
    assert.equal(userIsActive(afterSending, sentAt), true);
    assert.equal(userIsActive(afterSending, sentAt + USER_IDLE_MS - 1), true);
    assert.equal(userIsActive(afterSending, sentAt + USER_IDLE_MS), false);
    // A pointer click into a different, closed chat starts the grace again, without pinning
    // the automation to the previously answered chat or to the two-hour full-list poll.
    const switched = { at: sentAt + USER_IDLE_MS, typing: false };
    assert.equal(userIsActive(switched, switched.at + USER_IDLE_MS), false);
  });

  test('a draft or an unreadable activity state keeps the window with the user', () => {
    assert.equal(userIsActive({ at: 1, typing: true }, USER_IDLE_MS * 10), true);
    assert.equal(userIsActive(null), true);
  });
});
