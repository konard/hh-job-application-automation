/**
 * Unit tests for session-tracker module
 * The click listener finds the apply buttons by markup, in any language; the flag is read with
 * browser-commander's checkAndClearFlag.
 */

import { describe, test, assert } from 'test-anywhere';
import { APPLY_BUTTONS, SESSION_KEYS, createApplyButtonTracker, installApplyClickListener } from '../src/helpers/session-tracker.mjs';

function createMockCommander() {
  const calls = [];
  return {
    calls,
    safeEvaluate: async (options) => {
      calls.push(['safeEvaluate', options]);
      return { value: true };
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

  test('install() listens for apply clicks, found by markup, with the redirect flag key', async () => {
    const commander = createMockCommander();
    assert.equal(await createApplyButtonTracker(commander).install(), true);
    const [[name, options]] = commander.calls;
    assert.equal(name, 'safeEvaluate');
    assert.equal(options.fn, installApplyClickListener);
    assert.deepEqual(options.args, [APPLY_BUTTONS, SESSION_KEYS.shouldRedirectAfterResponse]);
    assert.ok(!/[а-яё]/i.test(APPLY_BUTTONS));
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
