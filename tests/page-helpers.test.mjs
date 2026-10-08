/**
 * Unit tests for shared page helpers and the async mutex
 */

import { describe, test, assert } from 'test-anywhere';
import { findFirstSelector, isResponseSubmitted } from '../src/helpers/page-helpers.mjs';
import { createMutex } from '../src/helpers/mutex.mjs';

describe('findFirstSelector()', () => {
  const commander = {
    count: async ({ selector }) => ({ '.hidden': 1, '.shown': 1 }[selector] ?? 0),
    isVisible: async ({ selector }) => selector === '.shown',
  };

  test('returns the first selector with matching elements', async () => {
    assert.equal(await findFirstSelector(commander, ['.missing', '.hidden', '.shown']), '.hidden');
  });

  test('can require visibility', async () => {
    assert.equal(await findFirstSelector(commander, ['.hidden', '.shown'], { visible: true }), '.shown');
  });

  test('returns null when nothing matches', async () => {
    assert.equal(await findFirstSelector(commander, ['.missing']), null);
  });
});

describe('isResponseSubmitted()', () => {
  test('returns the evaluated value and false on navigation', async () => {
    assert.equal(await isResponseSubmitted({ safeEvaluate: async () => ({ value: true }) }), true);
    assert.equal(
      await isResponseSubmitted({ safeEvaluate: async ({ defaultValue }) => ({ value: defaultValue, navigationError: true }) }),
      false,
    );
  });
});

describe('createMutex()', () => {
  test('runs functions one at a time in call order, even after failures', async () => {
    const exclusive = createMutex();
    const events = [];
    const task = (name, ms, fail = false) => exclusive(async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end ${name}`);
      if (fail) throw new Error(name);
      return name;
    });

    const results = await Promise.allSettled([task('a', 20), task('b', 5, true), task('c', 1)]);
    assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  });
});
