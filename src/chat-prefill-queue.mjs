/** Retry a live question after automated chat processing releases the window. */
import { createMutex } from './helpers/mutex.mjs';

export function createChatPrefillQueue({ busy, write, onError = console.error, retryMs = 500 }) {
  const pending = new Map();
  const exclusive = createMutex();
  let timer;
  let stopped = false;
  const drain = () => exclusive(async () => {
    clearTimeout(timer);
    if (stopped) return;
    try {
      for (const [frame, chat] of [...pending]) {
        if (await busy(frame) || pending.get(frame) !== chat) continue;
        pending.delete(frame);
        // Automation may have taken the window while the answer lookup was in flight.
        if (await write(chat, frame) === false && !pending.has(frame)) pending.set(frame, chat);
      }
    } finally {
      if (!stopped && pending.size) {
        timer = setTimeout(() => { drain().catch(onError); }, retryMs);
        timer.unref?.();
      }
    }
  });
  return {
    enqueue(chat, frame) {
      if (stopped) return Promise.resolve();
      pending.set(frame, chat);
      return drain();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      pending.clear();
    },
  };
}
