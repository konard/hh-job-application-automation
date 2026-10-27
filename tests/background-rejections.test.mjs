import { describe, test, expect } from 'bun:test';
import { createBackgroundRejectionSweep } from '../src/background-rejections.mjs';

function fixture({ active = false, finished = false, draft = 'Мой незаконченный ответ', scan } = {}) {
  const state = { active, url: 'https://hh.ru/chat/123', draft, restored: 0, scanned: 0, finishedChat: null };
  const page = { isClosed: () => false, url: () => state.url, evaluate: async () => {} };
  const sweep = createBackgroundRejectionSweep({
    page, isActive: async () => state.active,
    capture: async () => ({ url: state.url, chatId: '123', finished, draft: { value: state.draft } }),
    onFinished: (id) => { state.finishedChat = id; },
    restore: async (_page, view, { allowRestore }) => {
      if (!await allowRestore()) return;
      state.url = view.url; state.draft = view.draft.value; state.restored += 1;
    },
    scan: async (options) => { state.scanned += 1; return scan?.(options, state) ?? 0; },
  });
  return { sweep, state };
}

describe('background rejection cleanup', () => {
  test('a finished conversation without a draft is not reopened, but an unfinished draft is preserved', async () => {
    for (const draft of ['', 'Дополнительный вопрос работодателю']) {
      const { sweep, state } = fixture({ finished: true, draft, scan: async ({ onNavigate }, state) => {
        onNavigate('https://hh.ru/chat/456'); state.url = 'https://hh.ru/chat/456'; return 2;
      } });
      await sweep.run();
      expect(state.restored).toBe(draft ? 1 : 0);
      expect(state.url).toBe(draft ? 'https://hh.ru/chat/123' : 'https://hh.ru/chat/456');
      expect(state.finishedChat).toBe(draft ? null : '123');
    }
  });

  test('foreground and unknown focus leave the current chat alone', async () => {
    for (const active of [true, null]) {
      const { sweep, state } = fixture({ active });
      expect(await sweep.run()).toEqual({ ran: false });
      expect(state.scanned).toBe(0);
      expect(state.restored).toBe(0);
    }
  });

  test('an inactive window may clear rejections with a draft, then returns to that exact draft', async () => {
    const { sweep, state } = fixture({ scan: async ({ canContinue, onNavigate }, state) => {
      expect(await canContinue()).toBe(true);
      onNavigate('https://hh.ru/chat/456'); state.url = 'https://hh.ru/chat/456'; state.draft = '';
      return 3;
    } });
    expect(await sweep.run()).toEqual({ ran: true, count: 3 });
    expect(state.url).toBe('https://hh.ru/chat/123');
    expect(state.draft).toBe('Мой незаконченный ответ');
    expect(state.restored).toBe(1);
  });

  test('returning to the browser stops the pass and restores the original conversation', async () => {
    const { sweep, state } = fixture({ scan: async ({ canContinue, onNavigate }, state) => {
      onNavigate('https://hh.ru/chat/456'); state.url = 'https://hh.ru/chat/456';
      state.active = true;
      expect(await canContinue()).toBe(false);
      return 1;
    } });
    await sweep.run();
    expect(state.url).toBe('https://hh.ru/chat/123');
    expect(state.restored).toBe(1);
  });

  test('a user selecting another chat during the pass keeps that selection', async () => {
    const { sweep, state } = fixture({ scan: async ({ onNavigate }, state) => {
      onNavigate('https://hh.ru/chat/456');
      state.active = true; state.url = 'https://hh.ru/chat/789'; state.draft = 'Новый ответ';
    } });
    await sweep.run();
    expect(state.url).toBe('https://hh.ru/chat/789');
    expect(state.draft).toBe('Новый ответ');
    expect(state.restored).toBe(0);
  });

  test('a failed navigation still restores the draft and releases the window', async () => {
    const { sweep, state } = fixture({ scan: async ({ onNavigate }, state) => {
      onNavigate('https://hh.ru/chat/456'); state.url = 'https://hh.ru/chat/456'; state.draft = '';
      throw new Error('Failed after opening rejection');
    } });
    await expect(sweep.run()).rejects.toThrow('Failed after opening rejection');
    expect(state.url).toBe('https://hh.ru/chat/123');
    expect(state.draft).toBe('Мой незаконченный ответ');
    expect(sweep.running).toBe(false);
  });

  test('concurrent timer and scheduled passes run only one scan', async () => {
    const { sweep, state } = fixture({ scan: async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return 1; } });
    await Promise.all([sweep.run(), sweep.run()]);
    expect(state.scanned).toBe(1);
    expect(state.restored).toBe(1);
  });

  test('shutdown cancels further navigation and waits for the original chat to be restored', async () => {
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    const { sweep, state } = fixture({ scan: async ({ canContinue, onNavigate }, state) => {
      onNavigate('https://hh.ru/chat/456'); state.url = 'https://hh.ru/chat/456';
      entered(); await released;
      expect(await canContinue()).toBe(false);
    } });
    const pending = sweep.run();
    await started;
    const stopped = sweep.stop();
    release(); await Promise.all([pending, stopped]);
    expect(state.url).toBe('https://hh.ru/chat/123');
    expect(await sweep.run()).toEqual({ ran: false });
  });
});
