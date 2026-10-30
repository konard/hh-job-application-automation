import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, assert } from 'test-anywhere';
import { createRejectionResponder, DEFAULT_REJECTION_REPLY, unansweredRejection } from '../src/rejection-replies.mjs';
import { isRejectionCell } from '../src/chat-answers.mjs';

const text = 'Здравствуйте. Еще раз спасибо за интерес к нашей вакансии.\nК сожалению, на данном этапе мы не готовы двигаться дальше. Если решение по вашему резюме изменится, я буду рада оставаться на связи. Желаю вам удачи в поиске подходящей позиции.';
const rejected = () => ({ id: '123456', canReply: true, company: 'STARTRIBE', vacancy: 'DevOps Engineer',
  messages: [{ id: '91', mine: false, title: 'Дарья', text }] });

describe('open rejection replies', () => {
  test('recognizes the reported wording; closed, answered, transitioning and question-bearing chats stay untouched', () => {
    assert.equal(isRejectionCell({ last: text }), true);
    assert.equal(unansweredRejection(rejected()).id, '91');
    for (const chat of [
      { ...rejected(), canReply: false }, { ...rejected(), turnedOff: true }, { ...rejected(), transitioning: true },
      { ...rejected(), messages: [...rejected().messages, { id: '92', mine: true, text: DEFAULT_REJECTION_REPLY }] },
      { ...rejected(), messages: [...rejected().messages, { id: '92', mine: true, text: 'Спасибо.' }, { id: '93', mine: false, text }] },
      { ...rejected(), messages: [{ id: '91', mine: false, text: `${text} Готовы обсудить другую роль?` }] },
      { ...rejected(), messages: [{ id: '91', mine: false, text: `${text} Пришлите, пожалуйста, резюме.` }] },
      { ...rejected(), messages: [...rejected().messages, { id: '92', mine: false, text: 'Уточните ваш опыт.' }] },
    ]) assert.equal(unansweredRejection(chat), null);
  });

  test('sends once across concurrent processors/restarts, with the requested default and private receipt', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rejection-reply-'));
    try {
      let sends = 0;
      const options = { chatId: '123456', readChat: async () => rejected(), readDraft: async () => '', maySend: async () => true,
        send: async (id, reply) => {
          assert.equal(id, '91');
          assert.equal(reply.answer, DEFAULT_REJECTION_REPLY);
          assert.equal(reply.preserveDraft, true);
          assert.equal(await reply.maySend(), true);
          sends++;
          return true;
        } };
      const outcomes = await Promise.all([createRejectionResponder({ directory })(options), createRejectionResponder({ directory })(options)]);
      assert.equal(sends, 1);
      assert.deepEqual(outcomes.map(({ status }) => status).sort(), ['already_attempted', 'sent']);
      assert.equal((await createRejectionResponder({ directory })(options)).status, 'already_attempted');
      assert.equal((await fs.stat(path.join(directory, '123456.json'))).mode & 0o777, 0o600);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  test('an uncertain send is never retried automatically', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rejection-uncertain-'));
    try {
      let sends = 0;
      const options = { chatId: '123456', readChat: async () => rejected(), readDraft: async () => '', maySend: async () => true,
        send: async () => { sends++; return false; } };
      assert.equal((await createRejectionResponder({ directory })(options)).status, 'unconfirmed');
      assert.equal((await createRejectionResponder({ directory })(options)).status, 'already_attempted');
      assert.equal(sends, 1);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  test('active/unknown windows, drafts, changed chats and disabled settings cannot send or reserve', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rejection-held-'));
    try {
      const base = { chatId: '123456', readChat: async () => rejected(), readDraft: async () => '', maySend: async () => true,
        send: async () => assert.fail('must not send') };
      for (const extra of [{ maySend: async () => false }, { maySend: async () => null }, { readDraft: async () => 'My draft' },
        { readChat: async () => ({ ...rejected(), id: '999' }) }]) {
        assert.equal((await createRejectionResponder({ directory })({ ...base, ...extra })).status, 'left_for_user');
      }
      assert.equal((await createRejectionResponder({ directory, enabled: false })(base)).status, 'disabled');
      let reads = 0;
      assert.equal((await createRejectionResponder({ directory })({ ...base, readChat: async () => ++reads === 1 ? rejected() :
        { ...rejected(), messages: [...rejected().messages, { id: '92', mine: true, text: 'My own reply' }] } })).status, 'left_for_user');
      assert.deepEqual(await fs.readdir(directory), []);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
