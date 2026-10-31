/** Reply to a pending acknowledgement even when opening its chat already marked it read. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isAcknowledgement, isSummary, isCompletionNotice, isAnswersPassedNotice, isSupportChat, knownReply, pendingMessages, templateCore } from './chat-answers.mjs';

export function unansweredAcknowledgement(chat, templates) {
  if (!chat?.id || chat.transitioning || !chat.canReply || chat.turnedOff || isSupportChat(chat)) return null;
  const pending = pendingMessages(chat.messages).filter(message => !isSummary(message.text) &&
    !isCompletionNotice(message.text) && !isAnswersPassedNotice(message.text));
  if (pending.length !== 1) return null;
  const message = pending[0];
  if (!message.id || !isAcknowledgement(templateCore(message.text, { sender: message.title }))) return null;
  const reply = knownReply(message, { templates, qaMap: new Map() });
  return reply?.perfect && !reply.noReply && reply.answer && reply.source.startsWith('chat-templates')
    ? { chatId: String(chat.id), messageId: String(message.id), answer: reply.answer } : null;
}

/** A private per-message reservation prevents duplicates after an uncertain send or restart. */
export function createAcknowledgementResponder({ directory = path.join(process.cwd(), 'logs', 'acknowledgement-replies'), enabled = true } = {}) {
  return async ({ readChat, readTemplates, readDraft, maySend, send }) => {
    if (!enabled) return { status: 'disabled' };
    if (await maySend() !== true) return { status: 'left_for_user' };
    const templates = await readTemplates();
    const candidate = async () => {
      if (await maySend() !== true || String(await readDraft()).trim()) return null;
      return unansweredAcknowledgement(await readChat(), templates);
    };
    const message = await candidate();
    if (!message) return { status: 'left_for_user' };
    if (!/^\d+$/.test(message.chatId) || !/^\d+$/.test(message.messageId)) throw new Error('An acknowledgement reply needs numeric chat/message IDs');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${message.chatId}-${message.messageId}.json`);
    const entry = { ...message, at: new Date().toISOString(), status: 'attempted' };
    let reservation;
    try { reservation = await fs.open(file, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') return { status: 'already_attempted' }; throw error; }
    try { await reservation.writeFile(JSON.stringify(entry)); }
    finally { await reservation.close(); }
    let dispatched = false;
    try {
      const current = await candidate();
      if (current?.chatId !== message.chatId || current?.messageId !== message.messageId) {
        await fs.rm(file);
        return { status: 'left_for_user' };
      }
      dispatched = true;
      const confirmed = await send(message.messageId, { answer: message.answer, option: null, preserveDraft: true,
        maySend: async () => {
          const current = unansweredAcknowledgement(await readChat(), templates);
          return current?.chatId === message.chatId && current?.messageId === message.messageId && await maySend() === true;
        } });
      entry.status = confirmed ? 'sent' : 'unconfirmed';
      await fs.writeFile(file, JSON.stringify(entry), { mode: 0o600 });
      return { ...message, status: entry.status };
    } catch (error) {
      if (!dispatched) await fs.rm(file, { force: true });
      throw error;
    }
  };
}
