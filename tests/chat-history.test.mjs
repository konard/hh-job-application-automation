/**
 * Tests for the chats kept: merged as they come, the user's replies to a template picked at random
 */
import { describe, test, assert } from 'test-anywhere';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { knownReply } from '../src/chat-answers.mjs';
import { createChatHistory, replyVariants, varyReply } from '../src/chat-history.mjs';

const TEMPLATE = 'Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.';
const templates = new Map([[TEMPLATE, 'Здравствуйте, благодарю, ожидаю.']]);
const chat = (id, reply, greeting = 'Константин Константинович, здравствуйте!') => ({
  id,
  vacancy: 'Senior Python Developer',
  messages: [
    { id: `${id}1`, mine: true, title: 'Отклик на вакансию', text: 'Отклик' },
    { id: `${id}2`, mine: false, title: 'Ирина', text: `${greeting}\n\n${TEMPLATE}\n\nХмелевская Ирина` },
    { id: `${id}3`, mine: true, title: '', text: reply },
  ],
});

describe('chat history', () => {
  test('a chat is kept, its new messages merged in', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chat-history-')), 'chat-history.json');
    const history = createChatHistory(file);
    const first = chat('5', 'Здравствуйте, благодарю.');
    assert.equal(await history.record({ ...first, messages: first.messages.slice(0, 2) }), true);
    assert.equal(await history.record(first), true);
    assert.equal(await history.record(first), false);
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(kept['5'].messages.map((message) => message.id), ['51', '52', '53']);
    // Another process reading the file sees it
    assert.equal((await createChatHistory(file).read())['5'].vacancy, 'Senior Python Developer');
  });

  test('a template gets one of the replies the user gave to it', () => {
    const history = { 1: chat('1', 'Здравствуйте, благодарю.'), 2: chat('2', 'Здравствуйте, ожидаю, спасибо.'),
      // A reply to someone by name, or a long one of its own, is not repeated elsewhere
      3: chat('3', 'Ирина, здравствуйте! Благодарю.'), 4: chat('4', `Здравствуйте. ${'Хотел бы уточнить детали. '.repeat(8)}`) };
    const variants = replyVariants(history, templates);
    assert.deepEqual(variants.get(TEMPLATE), ['Здравствуйте, благодарю.', 'Здравствуйте, ожидаю, спасибо.']);
    const reply = knownReply(chat('9', '').messages[1], { templates, qaMap: new Map() });
    assert.equal(varyReply(reply, variants, () => 0).answer, 'Здравствуйте, благодарю, ожидаю.');
    assert.equal(varyReply(reply, variants, () => 0.5).answer, 'Здравствуйте, благодарю.');
    assert.equal(varyReply(reply, variants, () => 0.9).answer, 'Здравствуйте, ожидаю, спасибо.');
    assert.equal(varyReply(reply, variants, () => 0.9).perfect, true);
    // Nothing given before: the saved reply
    assert.equal(varyReply(reply, new Map(), () => 0.9).answer, 'Здравствуйте, благодарю, ожидаю.');
    assert.equal(varyReply(null, variants), null);
  });
});
