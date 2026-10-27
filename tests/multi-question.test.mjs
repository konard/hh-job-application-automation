import { describe, test, assert } from 'test-anywhere';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitQuestions, separateQuestionAnswers, expandQuestionAnswers, composeQuestionAnswer } from '../src/multi-question.mjs';
import { createQADatabase, findBestMatch } from '../src/qa-database.mjs';
import { countChatAnswers, learnedPairs, knownReply, knownReplyInContexts } from '../src/chat-answers.mjs';
import { createChatHistory } from '../src/chat-history.mjs';
import { learnChatQuestions, withChatHistoryAnswers } from '../src/chat-learning.mjs';
import { planAnswers } from '../src/form-prefill.mjs';
import { saveSentAnswers } from '../src/form-answers.mjs';
import { allAnswersExact } from '../src/qa.mjs';
import { withContacts } from '../src/contacts.mjs';
import { salaryQuestion } from '../src/salary-questions.mjs';
import { isPayQuestion } from '../src/vacancy-context.mjs';
import { setupQAHandling } from '../src/vacancy-response.mjs';

const questions = ['Как устроена работа агента?', 'Что делать, когда агент застрял?'];
const block = questions.map((text, i) => `${i + 1}. ${text}`).join('\n');
const answer = '1. Агент читает файлы, вызывает инструменты и проверяет результат.\n\n2. Смотрю логи и проверяю гипотезу.\nКонтекст сохраняю.';
const separate = ['Агент читает файлы, вызывает инструменты и проверяет результат.', 'Смотрю логи и проверяю гипотезу.\nКонтекст сохраняю.'];
const messages = [
  { id: '1', mine: false, text: block },
  { id: '2', mine: true, text: answer },
];
const fixture = async (run) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hh-multiple-'));
  try { await run(createQADatabase(path.join(dir, 'qa.lino'), { resolveVariants: true }), dir); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
};

describe('multiple questions shared by forms and chats', () => {
  test('retains a numbered question with conditional follow-ups and separates trailing instructions/contact', () => {
    const text = `Пожалуйста, ответьте своими словами.\n\n${block}\n\nОтвечайте подробно и по существу.\n\nЕсли текст будет похож на сгенерированный ИИ, ответ не будет принят.\n\nОтветы учитываются при рассмотрении кандидатуры.\n\nДля дополнительной связи укажите ваш username в Telegram (@username).`;
    assert.deepEqual(splitQuestions(text).map(({ text }) => text), [...questions, 'Для дополнительной связи укажите ваш username в Telegram (@username).']);
    assert.deepEqual(splitQuestions('1) Был ли опыт Docker? Если да, расскажите подробнее.\n2) Какой опыт Kubernetes?').map(({ text }) => text),
      ['Был ли опыт Docker? Если да, расскажите подробнее.', 'Какой опыт Kubernetes?']);
  });

  test('supports independent questions in paragraphs, bullets and one line', () => {
    for (const value of [questions.join('\n\n'), questions.map((q) => `• ${q}`).join('\n'), questions.join(' ')]) {
      assert.deepEqual(splitQuestions(value).map(({ text }) => text), questions);
      assert.deepEqual(separateQuestionAnswers(value, answer), questions.map((q, i) => [q, separate[i]]));
    }
    assert.deepEqual(splitQuestions('Был ли опыт Docker? Если да, расскажите подробнее.'), []);
  });

  test('does not invent alignment, split checkbox arrays, nested lists or code fences', () => {
    assert.deepEqual(separateQuestionAnswers(block, 'Работал с агентами. Зависит от ситуации.'), []);
    assert.deepEqual(separateQuestionAnswers(block, '1. Только один ответ.'), []);
    assert.deepEqual(separateQuestionAnswers(block, ['Да', 'Нет']), []);
    assert.deepEqual(splitQuestions('```\n1. Какой вывод?\n2. Какой результат?\n```'), []);
    assert.deepEqual(separateQuestionAnswers(block, '1. Объяснение\n1. Вложенный список\n2. Ещё пункт\n2. Ответ'), []);
    assert.deepEqual(expandQuestionAnswers(new Map([[block, ['Go', 'Rust']]])).get(block), ['Go', 'Rust']);
  });

  test('preserves numbered code inside a fenced answer', () => {
    const reply = '1. Пример:\n```text\n1. literal\n2. literal\n```\n\n2. Проверяю.';
    assert.equal(separateQuestionAnswers(block, reply)[0][1], 'Пример:\n```text\n1. literal\n2. literal\n```');
  });

  test('saves full and each part literally; configuration databases remain generic', async () => fixture(async (db, dir) => {
    await db.addOrUpdateQA(block, answer);
    const saved = await db.readQADatabase();
    assert.equal(saved.get(block), answer);
    questions.forEach((q, i) => assert.equal(saved.get(q), separate[i]));
    const raw = await createQADatabase(db.filePath).readQADatabase();
    assert.equal(raw.size, 3);
    const config = createQADatabase(path.join(dir, 'config.lino'));
    await config.addOrUpdateQA(block, answer);
    assert.equal((await config.readQADatabase()).size, 1);
    assert.equal(findBestMatch(questions[1], saved).answer, separate[1]);
  }));

  test('backfills old files atomically and idempotently, preserving standalone variants', async () => fixture(async (db) => {
    await createQADatabase(db.filePath).writeQADatabase(new Map([[block, answer], [questions[1], 'Проверяю лимиты.']]));
    assert.equal((await db.backfillQuestionAnswers()).added, 1);
    const saved = await createQADatabase(db.filePath).readQADatabase();
    assert.equal(saved.get(questions[1]), `Проверяю лимиты. | ${separate[1]}`);
    assert.equal((await db.backfillQuestionAnswers()).added, 0);
    assert.equal((await db.readQADatabase()).get(questions[1]), saved.get(questions[1]));
  }));

  test('only collapses a final-period conflict after both versions actually exist', async () => fixture(async (db) => {
    await db.addOrUpdateQA(block, '1. Инструменты\n2. Логи');
    assert.equal((await db.readQADatabase()).get(questions[0]), 'Инструменты');
    await db.addOrUpdateQA(block, '1. Инструменты.\n2. Логи.');
    assert.equal((await db.readQADatabase()).get(questions[0]), 'Инструменты.');
  }));

  test('composes from complete individual records but does not auto-send as exact', () => {
    const saved = new Map(questions.map((q, i) => [q, separate[i]]));
    const match = findBestMatch(block, saved);
    assert.ok(match.composed);
    assert.equal(match.answer, answer);
    assert.equal(knownReply({ text: block }, { qaMap: saved, templates: new Map() }).perfect, false);
    assert.equal(allAnswersExact([{ type: 'textarea', question: block, currentValue: answer }], saved), false);
    assert.equal(findBestMatch(block, new Map([[questions[0], separate[0]]])), null);
    assert.equal(composeQuestionAnswer(block, () => null), null);
    assert.equal(findBestMatch(block, new Map([[block, answer]])).composed, undefined);
  });

  test('does not reuse an unsplit questionnaire as the answer to a single question', () => {
    assert.equal(findBestMatch(questions[0], new Map([[block, answer]])), null);
  });

  test('learns each component and full message; counts actual sends, including edited replies', () => {
    assert.equal(learnedPairs(messages).questions.length, 3);
    const first = countChatAnswers(messages);
    assert.equal(first.length, 3);
    first.forEach(({ count }) => assert.equal(count, 1));
    assert.deepEqual(countChatAnswers(messages), first);
    const edited = countChatAnswers([messages[0], { ...messages[1], previousTexts: [answer.replace('Смотрю логи', 'Проверяю логи')] }]);
    assert.equal(edited.find((item) => item.question === questions[0]).count, 1);
    assert.equal(edited.filter((item) => item.question === questions[1]).length, 2);
  });

  test('history slot and live learner persist components and rank their answers by frequency', async () => fixture(async (db, dir) => {
    const history = createChatHistory(path.join(dir, 'history.json'));
    await learnChatQuestions({ id: '7', vacancy: 'Engineer', messages }, { history, qaDatabase: db, log: () => {} });
    await learnChatQuestions({ id: '7', vacancy: 'Engineer', messages }, { history, qaDatabase: db, log: () => {} });
    const second = answer.replace('Смотрю логи', 'Проверяю логи');
    for (const id of ['8', '9']) await learnChatQuestions({ id, vacancy: 'Engineer', messages: [messages[0], { ...messages[1], text: second }] }, { history, qaDatabase: db, log: () => {} });
    const sources = withChatHistoryAnswers(db, { history });
    const counts = (await sources.readAnswerFrequencies()).get(questions[1]);
    assert.equal(counts[0].count, 2);
    assert.equal(counts[1].count, 1);
    assert.ok((await sources.readQADatabase()).get(questions[1]).startsWith('Проверяю логи'));
    assert.equal((await createQADatabase(db.filePath).readQADatabase()).size, 3);
  }));

  test('external form saving keeps salary-containing questionnaires and contact placeholders', async () => fixture(async (db) => {
    const title = '1. Ваши зарплатные ожидания?\n2. Укажите Telegram?';
    const value = '1. От 450 000 ₽ на руки.\n2. @tester';
    const contacts = withContacts(db, { telegram: '@tester' });
    assert.equal(salaryQuestion(title), null);
    assert.equal(isPayQuestion(title), false);
    assert.equal((await saveSentAnswers([{ title, answer: value }], { qaDatabase: contacts })).length, 1);
    assert.equal((await db.readQADatabase()).get('Укажите Telegram?'), '{{telegram}}');
    assert.equal((await contacts.readQADatabase()).get('Укажите Telegram?'), '@tester');
  }));

  test('external form prefill resolves each component in its own context', () => {
    const title = '1. Salary expectations in USD gross?\n2. Зарплатные ожидания в рублях на руки?';
    const maps = new Map([['Salary expectations in USD gross?', new Map([['Salary expectations in USD gross?', '$8000 gross.']])],
      ['Зарплатные ожидания в рублях на руки?', new Map([['Зарплатные ожидания в рублях на руки?', 'От 450 000 ₽ на руки.']])]]);
    const planned = planAnswers([{ title, kind: 'textarea' }], { profile: {}, qaMap: new Map(), qaMapFor: (q) => maps.get(q) ?? new Map() });
    assert.equal(planned[0].answer, '1. $8000 gross.\n\n2. От 450 000 ₽ на руки.');
    const contactBlock = '1. Ваш город?\n2. Укажите Telegram?';
    assert.equal(planAnswers([{ title: contactBlock, kind: 'text' }], { profile: { city: 'Нячанг', telegram: '@tester' }, qaMap: new Map() })[0].answer,
      '1. Нячанг\n\n2. @tester');
  });

  test('chat composition cannot fall back to a salary-only answer or acknowledgement template', async () => {
    const text = '1. Ваши зарплатные ожидания?\n2. Какой опыт Docker?';
    const db = withContacts({ readQADatabase: async () => new Map([['Какой опыт Docker?', 'Писал Dockerfile.']]) }, { salary_net: '450 000 ₽' });
    const reply = await knownReplyInContexts({ text }, { readTemplates: async () => new Map(), readQADatabase: db.readQADatabase, contexts: [] });
    assert.equal(reply?.perfect, false);
    assert.ok(reply.answer.includes('450 000 ₽'));
    assert.ok(reply.answer.includes('2. Писал Dockerfile.'));
    assert.equal(knownReply({ text }, { qaMap: new Map(), byPattern: 'Salary only', templates: new Map([['Ваши зарплатные ожидания?', 'Спасибо']]) }), null);
  });

  test('main application form fills the composed answer without requiring a saved full block', async () => {
    let typed;
    const commander = {
      evaluate: async ({ fn, args }) => {
        if (fn.toString().includes('taskBodies')) return [{ type: 'textarea', question: block, selector: '#q', currentValue: '' }];
        if (args?.[0] === '#q') return false;
        return [];
      },
      fillTextArea: async (value) => { typed = value; },
      wait: async () => {},
    };
    const qaMap = new Map(questions.map((q, i) => [q, separate[i]]));
    // Verify the shared context resolver reaches the main form's browser-command filler.
    await setupQAHandling({ commander, readQADatabase: async () => qaMap, addOrUpdateQA: async () => {} });
    assert.equal(typed?.text, answer);
  });
});
