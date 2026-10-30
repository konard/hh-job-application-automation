import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from 'test-anywhere';
import { createAcknowledgementResponder, unansweredAcknowledgement } from '../src/acknowledgement-replies.mjs';
import { isConversationFinished, templateReplyFromPreview } from '../src/chat-answers.mjs';

const text = 'Добрый день! Спасибо за Ваш отклик! Мы рассмотрим Ваше резюме в ближайшее время и вернемся с обратной связью.';
const thanks = 'Здравствуйте, благодарю, ожидаю.';
// Only an older, differently worded example: the newly reported message must not need learning.
const templates = new Map([['Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.', thanks]]);
const makeChat = () => ({ id: '12345', canReply: true, company: 'Employer', unread: false,
  messages: [{ id: '10', mine: true, text: 'Мой отклик.' }, { id: '11', mine: false, text }] });

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acknowledgement-replies-'));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

describe('pending acknowledgement in an already-read chat', () => {
  test('a finished conversation can still need its saved thanks without an unread badge or exact example', async () => {
    const chat = makeChat();
    assert.equal(isConversationFinished(chat), true);
    assert.equal(templateReplyFromPreview({ last: text }, templates)?.perfect, true);
    assert.deepEqual(unansweredAcknowledgement(chat, templates), { chatId: '12345', messageId: '11', answer: thanks });
    await fixture(async (directory) => {
      const sent = [];
      const result = await createAcknowledgementResponder({ directory })({ readChat: async () => chat,
        readTemplates: async () => templates, readDraft: async () => '', maySend: async () => true,
        send: async (id, reply) => { assert.equal(await reply.maySend(), true); sent.push([id, reply.answer]); return true; } });
      assert.equal(result.status, 'sent');
      assert.deepEqual(sent, [['11', thanks]]);
    });
  });

  test('manual replies, new questions, mixed pending messages, closed panes and transitions are not sent', () => {
    const chat = makeChat();
    for (const changed of [
      { ...chat, messages: [...chat.messages, { id: '12', mine: true, text: 'Здравствуйте, благодарю.' }] },
      { ...chat, messages: [...chat.messages, { id: '12', mine: false, text: 'Какой у вас опыт?' }] },
      { ...chat, messages: [...chat.messages, { id: '12', mine: false, text: 'Дополнительная информация.' }] },
      { ...chat, messages: [{ id: '11', mine: false, text: text + ' Пришлите примеры кода.' }] },
      { ...chat, canReply: false }, { ...chat, turnedOff: true }, { ...chat, transitioning: true },
    ]) assert.equal(unansweredAcknowledgement(changed, templates), null);
    assert.equal(unansweredAcknowledgement(chat, new Map()), null);
  });

  test('an existing draft and an active window prevent a send', async () => fixture(async (directory) => {
    const respond = createAcknowledgementResponder({ directory });
    for (const [draft, allowed] of [['My draft', true], ['', false]]) {
      const result = await respond({ readChat: async () => makeChat(), readTemplates: async () => templates,
        readDraft: async () => draft, maySend: async () => allowed, send: async () => { throw new Error('Must not send'); } });
      assert.equal(result.status, 'left_for_user');
    }
    assert.deepEqual(await fs.readdir(directory), []);
  }));

  test('a changed conversation cancels the reservation before dispatch', async () => fixture(async (directory) => {
    let reads = 0;
    const result = await createAcknowledgementResponder({ directory })({ readChat: async () => ++reads === 1
      ? makeChat() : { ...makeChat(), messages: [{ id: '12', mine: false, text: 'Пришлите резюме.' }] },
    readTemplates: async () => templates, readDraft: async () => '', maySend: async () => true,
    send: async () => { throw new Error('Must not send'); } });
    assert.equal(result.status, 'left_for_user');
    assert.deepEqual(await fs.readdir(directory), []);
  }));

  test('an uncertain send is not repeated, including by a restarted responder', async () => fixture(async (directory) => {
    let sends = 0;
    const options = { readChat: async () => makeChat(), readTemplates: async () => templates,
      readDraft: async () => '', maySend: async () => true, send: async () => { sends++; return false; } };
    assert.equal((await createAcknowledgementResponder({ directory })(options)).status, 'unconfirmed');
    assert.equal((await createAcknowledgementResponder({ directory })(options)).status, 'already_attempted');
    assert.equal(sends, 1);
  }));

  test('concurrent responders reserve the message once and the disabled mode does nothing', async () => fixture(async (directory) => {
    let sends = 0;
    const options = { readChat: async () => makeChat(), readTemplates: async () => templates,
      readDraft: async () => '', maySend: async () => true, send: async () => { sends++; return true; } };
    assert.equal((await createAcknowledgementResponder({ directory, enabled: false })(options)).status, 'disabled');
    const results = await Promise.all([createAcknowledgementResponder({ directory })(options), createAcknowledgementResponder({ directory })(options)]);
    assert.deepEqual(results.map(result => result.status).sort(), ['already_attempted', 'sent']);
    assert.equal(sends, 1);
  }));
});
