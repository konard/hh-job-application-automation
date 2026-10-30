/** Ask once about a rejection's reason; private reservations prevent repeat sends on restart. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { asksSomething, isRejection, isSupportChat, pendingMessages } from './chat-answers.mjs';

export const DEFAULT_REJECTION_REPLY = 'Здравствуйте, могу я узнать причину?';

export function unansweredRejection(chat) {
  if (!chat?.id || chat.transitioning || !chat.canReply || chat.turnedOff || isSupportChat(chat)) return null;
  // Any response after an earlier rejection, including one written manually, ends this flow.
  let rejected = false;
  for (const message of chat.messages) {
    if (message.mine && rejected) return null;
    if (!message.mine && isRejection(message)) rejected = true;
  }
  const last = pendingMessages(chat.messages).at(-1);
  if (!last?.id || last.mine || !isRejection(last) || asksSomething(last.text) ||
      /(?:пришлите|отправьте|свяжитесь|позвоните|заполните|пройдите|перейдите|ответьте)|\b(?:please\s+)?(?:reply|send|provide|confirm|let us know)\b/iu.test(last.text)) return null;
  return last;
}

export function createRejectionResponder({ directory = path.join(process.cwd(), 'logs', 'rejection-replies'),
  enabled = true, reply = DEFAULT_REJECTION_REPLY } = {}) {
  return async ({ chatId, readChat, readDraft, maySend, send }) => {
    if (!enabled || !reply.trim()) return { status: 'disabled' };
    const candidate = async () => {
      const chat = await readChat();
      return chat?.id === String(chatId) && !String(await readDraft()).trim() && await maySend() === true
        ? unansweredRejection(chat) : null;
    };
    const message = await candidate();
    if (!message) return { status: 'left_for_user' };
    if (!/^\d+$/.test(String(chatId)) || !/^\d+$/.test(String(message.id))) throw new Error('A rejection reply needs numeric chat/message IDs');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${chatId}.json`);
    const entry = { chatId: String(chatId), messageId: String(message.id), at: new Date().toISOString(), status: 'attempted' };
    let reservation;
    try { reservation = await fs.open(file, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') return { status: 'already_attempted' }; throw error; }
    try { await reservation.writeFile(JSON.stringify(entry)); }
    finally { await reservation.close(); }
    // A concurrent worker sees the reservation. If nothing was dispatched, a changed pane/draft
    // or returning user cancels it safely; otherwise an uncertain send is never retried blindly.
    let dispatched = false;
    try {
      if ((await candidate())?.id !== message.id) {
        await fs.rm(file);
        return { status: 'left_for_user' };
      }
      dispatched = true;
      const confirmed = await send(message.id, { answer: reply, option: null,
        preserveDraft: true, maySend: async () => {
          const chat = await readChat();
          return chat?.id === String(chatId) && unansweredRejection(chat)?.id === message.id && await maySend() === true;
        } });
      entry.status = confirmed ? 'sent' : 'unconfirmed';
      await fs.writeFile(file, JSON.stringify(entry), { mode: 0o600 });
      return { status: entry.status, messageId: message.id };
    } catch (error) {
      if (!dispatched) await fs.rm(file, { force: true });
      throw error;
    }
  };
}
