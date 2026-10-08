/**
 * Unit tests for modal-helpers module
 * Tests modal detection and closing functionality
 */

import { describe, test, assert } from 'test-anywhere';
import {
  closeModalIfPresent,
  checkAndCloseDirectApplicationModal,
} from '../src/helpers/modal-helpers.mjs';
import { SELECTORS } from '../src/hh-selectors.mjs';

function createMockCommander({ count = 0, evaluateValue, clickError } = {}) {
  const calls = { clicked: [], waits: [] };
  return {
    calls,
    count: async () => (typeof count === 'function' ? count() : count),
    clickButton: async ({ selector }) => {
      if (clickError) throw clickError;
      calls.clicked.push(selector);
    },
    wait: async ({ ms }) => {
      calls.waits.push(ms);
    },
    safeEvaluate: async ({ defaultValue }) => ({ value: evaluateValue ?? defaultValue }),
  };
}

describe('Modal Helpers', () => {
  describe('closeModalIfPresent()', () => {
    test('should return false when no modal is present', async () => {
      const commander = createMockCommander({ count: 0 });
      assert.equal(await closeModalIfPresent({ commander }), false);
      assert.equal(commander.calls.clicked.length, 0);
    });

    test('should click the default close button and wait when modal is present', async () => {
      const commander = createMockCommander({ count: 1 });
      assert.equal(await closeModalIfPresent({ commander }), true);
      assert.deepEqual(commander.calls.clicked, [SELECTORS.responsePopupClose]);
      assert.deepEqual(commander.calls.waits, [1000]);
    });

    test('should use custom close button selector and wait time', async () => {
      const commander = createMockCommander({ count: 1 });
      const closeButtonSelector = '[data-qa="custom-close"]';
      await closeModalIfPresent({ commander, closeButtonSelector, waitAfterClose: 250 });
      assert.deepEqual(commander.calls.clicked, [closeButtonSelector]);
      assert.deepEqual(commander.calls.waits, [250]);
    });

    test('should click only once even with multiple modals present', async () => {
      const commander = createMockCommander({ count: 3 });
      await closeModalIfPresent({ commander });
      assert.equal(commander.calls.clicked.length, 1);
    });

    test('should return false when count or click fails', async () => {
      const failingCount = createMockCommander({ count: () => { throw new Error('Count failed'); } });
      assert.equal(await closeModalIfPresent({ commander: failingCount }), false);

      const failingClick = createMockCommander({ count: 1, clickError: new Error('Click failed') });
      assert.equal(await closeModalIfPresent({ commander: failingClick }), false);
    });
  });

  describe('checkAndCloseDirectApplicationModal()', () => {
    test('should not detect anything without cancel button', async () => {
      const commander = createMockCommander({ count: 0 });
      const result = await checkAndCloseDirectApplicationModal({ commander });
      assert.deepEqual(result, { isDirectApplication: false, closed: false });
    });

    test('should not close modal when direct application text is missing', async () => {
      const commander = createMockCommander({ count: 1, evaluateValue: { found: false, reason: 'no text' } });
      const result = await checkAndCloseDirectApplicationModal({ commander });
      assert.equal(result.isDirectApplication, false);
      assert.equal(commander.calls.clicked.length, 0);
    });

    test('should click cancel button when direct application modal is detected', async () => {
      const commander = createMockCommander({ count: 1, evaluateValue: { found: true, reason: 'magritte-alert' } });
      const result = await checkAndCloseDirectApplicationModal({ commander });
      assert.deepEqual(result, { isDirectApplication: true, closed: true });
      assert.deepEqual(commander.calls.clicked, [SELECTORS.directApplicationCancelButton]);
    });

    test('should ignore navigation errors during detection', async () => {
      const commander = createMockCommander({ count: 1 });
      commander.safeEvaluate = async () => ({ value: { found: false }, navigationError: true });
      const result = await checkAndCloseDirectApplicationModal({ commander });
      assert.equal(result.isDirectApplication, false);
    });
  });
});
