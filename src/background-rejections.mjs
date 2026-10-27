/** Read rejections while the chat window is inactive, then restore its conversation and draft. */
import { isConversationFinished, readChatIn, scrollChatList } from './chat-answers.mjs';
import { setUnreadFilter, waitForChat } from './chat-recording.mjs';

/** Runs in the browser; a reversed message column may have a negative scroll position. */
function messageScroll(top = null) {
  let box = document.querySelector('[data-qa^="chatik-chat-message-"]')?.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 10 && /auto|scroll/.test(window.getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return null;
  if (top !== null) box.scrollTop = top;
  return box.scrollTop;
}

export async function captureChatView(page) {
  const view = await page.evaluate(() => {
    const input = document.querySelector('textarea[data-qa="text-input"]');
    const inputs = [...document.querySelectorAll('label:has(input[data-qa="chatik-checkbox-only-unread"]) input[type="checkbox"]')];
    return {
      url: window.location.href, historyLength: window.history.length,
      unreadOnly: (inputs.find((item) => !item.dataset.qa) ?? inputs[0])?.checked ?? null,
      draft: input ? { value: input.value, start: input.selectionStart, end: input.selectionEnd, scrollTop: input.scrollTop } : null,
    };
  });
  const chat = await readChatIn(page);
  const chatId = new URL(view.url).pathname.match(/\/chat\/(\d+)/)?.[1];
  return { ...view, chatId, finished: chat.id === chatId && isConversationFinished(chat),
    listTop: (await page.evaluate(scrollChatList, null))?.top ?? null,
    messageTop: await page.evaluate(messageScroll, null) };
}

export async function restoreChatView(page, view, { allowRestore = async () => true } = {}) {
  if (page.isClosed() || !await allowRestore()) return false;
  if (page.url() !== view.url) {
    const steps = await page.evaluate((length) => window.history.length - length, view.historyLength).catch(() => 0);
    if (steps > 0) {
      await page.evaluate((count) => window.history.go(-count), steps);
      await page.waitForURL(view.url, { timeout: 5000 }).catch(() => {});
    }
    if (page.url() !== view.url) {
      if (!await allowRestore()) return false;
      await page.goto(view.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
  }
  const id = new URL(view.url).pathname.match(/\/chat\/(\d+)/)?.[1];
  if (id) await waitForChat(page, id);
  if (page.url() !== view.url) return false;
  if (typeof view.unreadOnly === 'boolean') await page.evaluate(setUnreadFilter, view.unreadOnly);
  if (view.listTop !== null) await page.evaluate(scrollChatList, view.listTop);
  if (view.messageTop !== null) await page.evaluate(messageScroll, view.messageTop);
  if (view.draft) {
    const input = page.locator('textarea[data-qa="text-input"]').first();
    const current = await input.inputValue({ timeout: 1000 }).catch(() => null);
    // hh.ru normally retains its per-chat drafts. Restore only a missing one, preserving edits.
    if (current === '' && view.draft.value) await input.fill(view.draft.value);
    if (current === view.draft.value || current === '') {
      await input.evaluate((field, draft) => {
        field.setSelectionRange(draft.start, draft.end);
        field.scrollTop = draft.scrollTop;
      }, view.draft).catch(() => {});
    }
  }
  return true;
}

export function createBackgroundRejectionSweep({
  page, getPage = () => page, isActive, blocked = () => false, scan, capture = captureChatView, restore = restoreChatView,
  onFinished = () => {},
}) {
  let running = false;
  let stopping = false;
  const finished = [];
  return {
    get running() { return running; },
    stop() {
      stopping = true;
      return running ? new Promise((resolve) => finished.push(resolve)) : Promise.resolve();
    },
    async run(options = {}) {
      const page = getPage();
      if (stopping || running || blocked() || page.isClosed() || await isActive() !== false) return { ran: false };
      if (stopping || running || blocked() || page.isClosed()) return { ran: false };
      running = true;
      let view;
      let ownedUrl;
      try {
        view = await capture(page);
        ownedUrl = view.url;
        await page.evaluate(() => { window.__chatAutomating = true; });
        const canContinue = async () => !stopping && !page.isClosed() && !blocked() && await isActive() === false;
        const count = await scan({ ...options, canContinue, onNavigate: (url) => { ownedUrl = url; } });
        return { ran: true, count };
      } finally {
        try {
          if (view && !page.isClosed()) {
            // A user who returned and selected another chat keeps that choice.
            if (view.finished && !view.draft?.value?.trim()) onFinished(view.chatId);
            else await restore(page, view, { allowRestore: async () => page.url() === ownedUrl || page.url() === view.url });
          }
        } finally {
          if (!page.isClosed()) await page.evaluate(() => { window.__chatAutomating = false; }).catch(() => {});
          running = false;
          finished.splice(0).forEach((resolve) => resolve());
        }
      }
    },
  };
}
