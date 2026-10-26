/** Capture sent chat messages as the DOM changes, and read older bubbles in the history slot. */
import { readChat, readChatIn, isApplication } from './chat-answers.mjs';
import { TURNED_OFF_WORDS } from './hh-words.mjs';
import { createMutex } from './helpers/mutex.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** hh.ru duplicates this checkbox inside nested labels; only the outer input controls the list. */
export function setUnreadFilter(want) {
  const inputs = [...document.querySelectorAll('label:has(input[data-qa="chatik-checkbox-only-unread"]) input[type="checkbox"]')];
  const input = inputs.find((item) => !item.dataset.qa) ?? inputs[0];
  if (!input) return null;
  // The styled inner checkbox covers the outer input. Activate the native outer control so
  // the nested label's default action cannot silently toggle the list back.
  if (input.checked !== want) input.click();
  return input.checked;
}

/** Runs in every chat document, including the application panel's frame. */
export function observeChat(read, turnedOffWords, owner) {
  if (window.__hhChatRecorder?.owner === owner && window.__hhChatRecorder) return;
  window.__hhChatRecorder?.observer?.disconnect();
  if (window.__hhChatRecorder?.onInput) document.removeEventListener('input', window.__hhChatRecorder.onInput, true);
  const recorder = { owner };
  window.__hhChatRecorder = recorder;
  let last = '';
  const capture = () => {
    if (!/\/chat\/\d+/.test(window.location.pathname)) return;
    const chat = read(turnedOffWords);
    if (!chat.id || !chat.messages.length || chat.transitioning) return;
    const signature = JSON.stringify(chat);
    if (signature === last) return;
    last = signature;
    // Take the snapshot now: navigating to another chat must not replace the sent answer before
    // the recorder reads it. The binding queues disk writes outside the page.
    window.__hhRecordChat(chat).catch(() => { last = ''; });
  };
  recorder.onInput = (event) => {
    if (event.target.matches?.('textarea[data-qa="text-input"]') && !event.target.value.trim()) {
      // Clearing an unsent draft can unblock a bot's choices without changing any message.
      last = '';
      capture();
    }
  };
  document.addEventListener?.('input', recorder.onInput, true);
  const start = () => {
    const observer = new window.MutationObserver(capture);
    recorder.observer = observer;
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      // Delivery acknowledgement can change only an existing icon's data-qa, or a bubble's
      // outgoing class/style. Record the sender correction without waiting for another message.
      attributes: true, attributeFilter: ['data-qa', 'class', 'style'],
    });
    capture();
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

/** The URL can precede the new pane. Wait for an aligned snapshot before reading or replying. */
export async function waitForChat(target, id, { timeoutMs = 20000, pause = sleep } = {}) {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await pause(100)) {
    const chat = await readChatIn(target);
    if (chat.id === String(id) && !chat.transitioning && chat.messages.length) return chat;
  }
  throw new Error(`Chat ${id} did not finish loading its conversation`);
}

/** Register before navigation; also capture chats already open in the page and its frames. */
export async function watchChats(page, { onChat, onError = console.error }) {
  const exclusive = createMutex();
  await page.exposeBinding('__hhRecordChat', (source, chat) => exclusive(async () => {
    try {
      await onChat(chat, source.frame);
    } catch (error) {
      onError(error);
      throw error;
    }
  }));
  const owner = `${Date.now()}-${Math.random()}`;
  const script = `(${observeChat.toString()})(${readChat.toString()}, ${JSON.stringify(TURNED_OFF_WORDS)}, ${JSON.stringify(owner)})`;
  await page.addInitScript({ content: script });
  for (const frame of page.frames()) {
    await frame.evaluate(script).catch(onError);
  }
  return { flush: () => exclusive(async () => {}) };
}

/** Runs in the chat: move up within the messages, without scrolling the conversation list. */
export function scrollChatHistory() {
  const first = document.querySelector('[data-qa^="chatik-chat-message-"]');
  let box = first?.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 10 && /auto|scroll/.test(window.getComputedStyle(box).overflowY))) {
    box = box.parentElement;
  }
  if (!box) return false;
  // hh.ru uses a reversed flex column: zero is the newest end and older messages have
  // negative scrollTop. Setting zero repeatedly never requests an older history page.
  box.scrollTop = window.getComputedStyle(box).flexDirection === 'column-reverse' ? -box.scrollHeight : 0;
  return true;
}

/**
 * Read all loaded pages of a conversation, recording each snapshot before earlier bubbles can
 * be virtualized away. Only the original application proves the start was reached; a stalled
 * load stays incomplete and is retried on the next history pass.
 */
export async function readFullChat(target, {
  onRead = async () => {}, read = () => readChatIn(target), pause = sleep, settleMs = 1000, maxIdle = 6, maxPasses = 1000,
} = {}) {
  const messages = new Map();
  let chat;
  let firstId;
  let idle = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    chat = await read();
    if (!chat?.id) throw new Error('The history slot did not show a chat');
    if (chat.transitioning) throw new Error('The conversation is still changing; its history was not recorded');
    if (pass > 0 && chat.id !== firstId) throw new Error('The chat changed while its history was being read');
    firstId ??= chat.id;
    const size = messages.size;
    chat.messages.forEach((message) => messages.set(message.id, message));
    await onRead(chat);
    if ([...messages.values()].some(isApplication)) {
      const full = { ...chat, messages: [...messages.values()].sort((a, b) => Number(a.id) - Number(b.id)), historyComplete: true, recordingVersion: 2 };
      await onRead(full);
      return full;
    }
    idle = messages.size === size ? idle + 1 : 0;
    if (idle >= maxIdle || !await target.evaluate(scrollChatHistory)) break;
    await pause(settleMs);
  }
  return { ...chat, messages: [...messages.values()].sort((a, b) => Number(a.id) - Number(b.id)), historyComplete: false };
}
