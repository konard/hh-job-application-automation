/**
 * Tests for the slot window size: a window remembered small is grown to a workable one
 */
import { describe, test, assert } from 'test-anywhere';
import { workableBounds } from '../src/browser-slots.mjs';

const screen = { left: 0, top: 38, width: 1728, height: 1016 };

describe('Slot window size', () => {
  test('a small window is grown and kept on the screen', () => {
    assert.deepEqual(workableBounds({ left: 0, top: 679, width: 500, height: 375 }, screen), { left: 0, top: 154, width: 1280, height: 900 });
  });

  test('a big enough window is left as it is', () => {
    assert.equal(workableBounds({ left: 0, top: 38, width: 1280, height: 900 }, screen), null);
  });

  test('a screen smaller than the workable size is filled', () => {
    assert.deepEqual(workableBounds({ left: 100, top: 100, width: 400, height: 300 }, { left: 0, top: 0, width: 1024, height: 700 }),
      { left: 0, top: 0, width: 1024, height: 700 });
  });
});
