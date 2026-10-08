/**
 * Unit tests for session-tracker module
 * The generic click listener / flag logic lives in browser-commander; these tests
 * verify that the hh.ru tracker binds it to the right button text and storage key.
 */

import { describe, test, assert } from 'test-anywhere';
import { SESSION_KEYS, createApplyButtonTracker } from '../src/helpers/session-tracker.mjs';

function createMockCommander() {
  const calls = [];
  return {
    calls,
    installClickListener: async (options) => {
      calls.push(['installClickListener', options]);
      return true;
    },
    checkAndClearFlag: async (options) => {
      calls.push(['checkAndClearFlag', options]);
      return true;
    },
  };
}

describe('Session Tracker', () => {
  test('SESSION_KEYS has the redirect flag key', () => {
    assert.equal(SESSION_KEYS.shouldRedirectAfterResponse, 'shouldRedirectAfterResponse');
  });

  test('install() listens for "Откликнуться" clicks with the redirect flag key', async () => {
    const commander = createMockCommander();
    assert.equal(await createApplyButtonTracker(commander).install(), true);
    assert.deepEqual(commander.calls, [[
      'installClickListener',
      { buttonText: 'Откликнуться', storageKey: SESSION_KEYS.shouldRedirectAfterResponse },
    ]]);
  });

  test('checkAndClear() reads and clears the redirect flag', async () => {
    const commander = createMockCommander();
    assert.equal(await createApplyButtonTracker(commander).checkAndClear(), true);
    assert.deepEqual(commander.calls, [[
      'checkAndClearFlag',
      { storageKey: SESSION_KEYS.shouldRedirectAfterResponse },
    ]]);
  });
});
