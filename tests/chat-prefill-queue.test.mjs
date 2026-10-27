import { describe, test, expect } from 'bun:test';
import { createChatPrefillQueue } from '../src/chat-prefill-queue.mjs';

const waitUntil = async (condition) => {
  for (const start = Date.now(); !condition(); ) {
    if (Date.now() - start > 1000) throw new Error('Deferred prefill did not resume');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('live chat prefill after temporary automation', () => {
  test('a question arriving while the window is busy is prefilled after release without another DOM event', async () => {
    let busy = true;
    const writes = [];
    const frame = {};
    const chat = { id: '5742911523', question: 'В каком городе Вы фактически проживаете?' };
    const queue = createChatPrefillQueue({ busy: () => busy, write: async (value) => { writes.push(value); }, retryMs: 5 });
    try {
      await queue.enqueue(chat, frame);
      expect(writes).toEqual([]);
      busy = false;
      await waitUntil(() => writes.length > 0);
      expect(writes).toEqual([chat]);
    } finally { queue.stop(); }
  });

  test('changing chats while busy discards the old pending question', async () => {
    let busy = true;
    const writes = [];
    const frame = {};
    const queue = createChatPrefillQueue({ busy: () => busy, write: async (value) => { writes.push(value.id); }, retryMs: 5 });
    try {
      await queue.enqueue({ id: 'previous' }, frame);
      await queue.enqueue({ id: 'current' }, frame);
      busy = false;
      await waitUntil(() => writes.length > 0);
      expect(writes).toEqual(['current']);
    } finally { queue.stop(); }
  });

  test('a window taken during answer lookup retries the write and stopping cancels pending work', async () => {
    let attempts = 0;
    const queue = createChatPrefillQueue({ busy: () => false, write: async () => ++attempts === 1 ? false : undefined, retryMs: 5 });
    try {
      await queue.enqueue({ id: 'current' }, {});
      await waitUntil(() => attempts === 2);
      expect(attempts).toBe(2);
      queue.stop();
      await queue.enqueue({ id: 'stopped' }, {});
      expect(attempts).toBe(2);
    } finally { queue.stop(); }
  });
});
