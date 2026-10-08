/**
 * Unit tests for shared page helpers and the async mutex
 */

import { describe, test, assert } from 'test-anywhere';
import { findChatPanelClose, findFirstSelector, isResponseSubmitted } from '../src/helpers/page-helpers.mjs';
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

describe('findChatPanelClose', () => {
  const element = (qa, visible = true, tag = 'BUTTON') => ({
    getAttribute: (name) => (name === 'data-qa' ? qa : null),
    getClientRects: () => (visible ? [{}] : []),
    textContent: qa ?? '',
    tag,
  });
  const run = (panel) => {
    globalThis.document = { querySelector: () => panel };
    try {
      return findChatPanelClose({ panelSelector: '[data-qa="chatik-root"]' });
    } finally {
      delete globalThis.document;
    }
  };
  const panel = (children, visible = true) => ({
    ...element('chatik-root', visible, 'DIV'),
    querySelectorAll: (selector) => (selector === '[data-qa]' ? children.filter((child) => child.getAttribute('data-qa')) : children),
  });

  test('returns null when the panel is closed', () => {
    assert.equal(run(null), null);
    assert.equal(run(panel([element('chatik-close')], false)), null);
  });

  test('finds the visible close button of the panel', () => {
    assert.deepEqual(run(panel([element('chatik-expand'), element('chatik-close-chat')])),
      { selector: '[data-qa="chatik-root"] [data-qa="chatik-close-chat"]' });
  });

  test('ignores hidden close buttons and lists the buttons instead', () => {
    assert.deepEqual(run(panel([element('chatik-close', false), element('chatik-send')])), { buttons: ['chatik-send'] });
  });
});
