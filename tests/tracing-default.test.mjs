import { describe, test, assert } from 'test-anywhere';
import { tracingEnabled } from '../src/browser-slots.mjs';

describe('recording is on by default', () => {
  test('every browser window is recorded unless TRACE turns it off', () => {
    assert.equal(tracingEnabled({}), true);
    assert.equal(tracingEnabled({ TRACE: '1' }), true);
    assert.equal(tracingEnabled({ TRACE: '0' }), false);
    assert.equal(tracingEnabled({ TRACE: 'false' }), false);
  });
});
