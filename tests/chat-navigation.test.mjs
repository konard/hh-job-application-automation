import { test, expect } from 'bun:test';
import { readChat } from '../src/chat-answers.mjs';

test('SPA URL, header and bubble changes never put a conversation under another chat ID', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const rect = { width: 100, left: 0, right: 100 };
  const bubble = (id) => ({
    getAttribute: () => `chatik-chat-message-${id}`,
    getBoundingClientRect: () => rect,
    querySelector: (selector) => selector === '[data-qa="chat-bubble-wrapper"]' ? { getBoundingClientRect: () => rect }
      : selector === '[data-qa="chat-bubble-text"]' ? { innerText: `Message ${id}` } : null,
  });
  try {
    globalThis.window = { location: { pathname: '/chat/1' } };
    const render = (id, messages, headerId = id) => {
      window.location.pathname = `/chat/${id}`;
      const header = { innerText: `Vacancy\nRole ${headerId}\nGo`, querySelector: () => ({ innerText: 'Go' }) };
      globalThis.document = {
        querySelectorAll: (selector) => selector.startsWith('[data-qa^="chatik-chat-message-') ? messages.map(bubble) : [],
        querySelector: (selector) => selector === '[data-qa="chatik-header-sub-header"]' ? (headerId ? header : null)
          : selector === '[data-qa="participant-info-title"]' ? { innerText: headerId ? `Company ${headerId}` : '' }
            : selector.includes('a[href') && headerId ? { href: `https://hh.ru/vacancy/${headerId}` } : null,
      };
      return readChat('turned off');
    };
    expect(render('1', ['11', '12']).id).toBe('1');
    // The address changes first, then the header, then the bubbles.
    expect(render('2', ['11', '12'], '1')).toMatchObject({ id: '1', transitioning: true });
    expect(render('2', ['11', '12'], '2')).toMatchObject({ id: '1', transitioning: true });
    expect(render('2', ['12', '21'], '2')).toMatchObject({ id: '1', transitioning: true });
    expect(render('2', [], '2')).toMatchObject({ id: '1', transitioning: true });
    expect(render('2', ['21', '22'])).toMatchObject({ id: '2', messages: [{ id: '21' }, { id: '22' }] });
    expect(render('1', ['21', '22'], '2')).toMatchObject({ id: '2', transitioning: true });
    // Restoring an old URL before the intermediate header is gone also waits.
    expect(render('1', ['13'], '2').transitioning).toBe(true);
    expect(render('1', ['11', '12', '13'])).not.toHaveProperty('transitioning');
    expect(render('1', ['11', '12', '13']).messages.at(-1).id).toBe('13');
    // An initially unloaded header can finish without permanently freezing recording.
    delete window.__hhChatView;
    expect(render('3', ['31'], '').id).toBe('3');
    expect(render('3', ['31'])).not.toHaveProperty('transitioning');
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});
