/**
 * Tests for learning the answers sent in external forms: page values → answers, what is saved,
 * submission detection
 */
import { describe, test, assert } from 'test-anywhere';
import {
  answersFromSnapshot, isSubmitClick, isSubmitted, notLearned, pairsToSave, sameAnswer, saveSentAnswers, stableEdits,
} from '../src/form-answers.mjs';
import { withContacts } from '../src/contacts.mjs';

// readFormFields() of a Google-like form page
const FIELDS = [
  { id: 'pf-0', kind: 'text', title: 'ФИО' },
  { id: 'pf-1', kind: 'text', title: 'Телефон' },
  { id: 'pf-2', kind: 'textarea', title: 'Расскажите о своём опыте' },
  { id: 'pf-3', kind: 'radio', title: 'Готовы к переезду?', options: ['Да', 'Нет'], optionIds: ['pf-3', 'pf-4'] },
  { id: 'pf-5', kind: 'checkbox', title: 'Языки', options: ['Go', 'Rust', 'Другое:'], optionIds: ['pf-5', 'pf-6', 'pf-7'] },
  { id: 'pf-8', kind: 'text', title: 'Языки' },
  { id: 'pf-9', kind: 'text', title: 'Дата рождения' },
  { id: 'pf-10', kind: 'select', title: 'Формат работы', options: ['Офис', 'Удалённо'] },
  { id: 'pf-11', kind: 'file', title: 'Резюме' },
  { id: 'pf-12', kind: 'textarea', title: 'Зарплатные ожидания' },
];
const VALUES = {
  'pf-0': { value: 'Иванов Пётр', type: 'text' },
  'pf-1': { value: '+7 900 123-45-67', type: 'tel' },
  'pf-2': { value: '  10 лет на Go\n', type: 'textarea' },
  'pf-3': { checked: false },
  'pf-4': { checked: true },
  'pf-5': { checked: true },
  'pf-6': { checked: false },
  'pf-7': { checked: true },
  'pf-8': { value: 'Kotlin', type: 'text' },
  'pf-9': { value: '1990-03-02', type: 'date' },
  'pf-10': { value: 'Удалённо' },
  'pf-11': { value: '' },
  'pf-12': { value: 'От [уточнить: сумма] рублей', type: 'textarea' },
};

describe('answersFromSnapshot', () => {
  test('reads text, a checked option, checked options, the «Другое» box, a date and a select', () => {
    assert.deepEqual(answersFromSnapshot(FIELDS, VALUES), [
      { title: 'ФИО', kind: 'text', answer: 'Иванов Пётр' },
      { title: 'Телефон', kind: 'text', answer: '+7 900 123-45-67' },
      { title: 'Расскажите о своём опыте', kind: 'textarea', answer: '10 лет на Go' },
      { title: 'Готовы к переезду?', kind: 'radio', answer: 'Нет' },
      { title: 'Языки', kind: 'checkbox', answer: ['Go', 'Kotlin'] },
      { title: 'Дата рождения', kind: 'text', answer: '02.03.1990' },
      { title: 'Формат работы', kind: 'select', answer: 'Удалённо' },
      { title: 'Зарплатные ожидания', kind: 'textarea', answer: 'От [уточнить: сумма] рублей' },
    ]);
  });

  test('one checked option is a string, none is empty; controls without values are left out', () => {
    const fields = [
      { id: 'pf-0', kind: 'checkbox', title: 'Стек', options: ['Go', 'Rust'], optionIds: ['pf-0', 'pf-1'] },
      { id: 'pf-2', kind: 'text', title: 'Город' },
    ];
    assert.deepEqual(answersFromSnapshot(fields, { 'pf-0': { checked: false }, 'pf-1': { checked: true } }), [
      { title: 'Стек', kind: 'checkbox', answer: 'Rust' },
    ]);
    assert.deepEqual(answersFromSnapshot(fields, {})[0].answer, []);
    assert.deepEqual(answersFromSnapshot(undefined, {}), []);
  });
});

describe('pairsToSave', () => {
  const answers = answersFromSnapshot(FIELDS, VALUES);
  const qaMap = new Map([
    ['Готовы ли вы к переезду?', 'Нет'],
    ['Расскажите о своем опыте', 'Пять лет на Rust'],
  ]);

  test('skips empty answers, «[уточнить]» marks, answers qa.lino already gives, unchanged prefilled contacts', () => {
    const prefilled = [{ title: 'ФИО', answer: 'Иванов Пётр' }, { title: 'Телефон', answer: '+7 900 111-11-11' }];
    const extra = [{ title: 'Город', answer: '' }, { title: 'Стек', answer: [] }];
    assert.deepEqual(pairsToSave([...answers, ...extra], { qaMap, prefilled }), [
      // Changed by the user, so learned
      { question: 'Телефон', answer: '+7 900 123-45-67' },
      // A similar saved question with another answer: the new answer is saved under this question
      { question: 'Расскажите о своём опыте', answer: '10 лет на Go' },
      { question: 'Языки', answer: ['Go', 'Kotlin'] },
      { question: 'Дата рождения', answer: '02.03.1990' },
      { question: 'Формат работы', answer: 'Удалённо' },
    ]);
  });

  test('a test assignment link belongs to one assignment and is not learned', () => {
    const answer = { title: 'Ссылка на выполненное тестовое задание', answer: 'https://github.com/petr/task' };
    assert.deepEqual(pairsToSave([answer], { qaMap }), []);
  });

  test('the same answer in another order or spacing is the same', () => {
    assert.ok(sameAnswer(['Go', 'Rust'], ['Rust', 'Go']));
    assert.ok(sameAnswer('Да', ['Да']));
    assert.ok(sameAnswer('10  лет\nна Go', '10 лет на Go'));
    assert.ok(!sameAnswer('Да', 'Нет'));
  });

  test('the prefill\'s own contacts and company are not learned unless changed', () => {
    const planned = [
      { title: 'ФИО', answer: 'Иванов Пётр', source: 'profile' },
      { title: 'Компания', answer: 'ООО Ромашка', source: 'company from the chat' },
      { title: 'Опыт', answer: 'Пять лет', source: 'qa.lino 0.91' },
      { title: 'Почта', open: true },
    ];
    assert.deepEqual(notLearned(planned), [{ title: 'ФИО', answer: 'Иванов Пётр' }, { title: 'Компания', answer: 'ООО Ромашка' }]);
  });
});

describe('saveSentAnswers', () => {
  test('contacts are saved as placeholders and an identical saved answer is not rewritten', async () => {
    const contacts = { telegram: '@petr_dev', phone: '+79001234567' };
    const stored = new Map([['Ваш Telegram', '{{telegram}}']]);
    const writes = [];
    const qaDatabase = withContacts({
      readQADatabase: async () => stored,
      addOrUpdateQA: async (question, answer) => writes.push([question, answer]),
    }, contacts);
    const saved = await saveSentAnswers([
      { title: 'Ваш Telegram', answer: '@petr_dev' },
      { title: 'Как с вами связаться?', answer: 'Telegram: @petr_dev, +7 900 123-45-67' },
      { title: 'Ожидания', answer: 'От [уточнить: сумма]' },
    ], { qaDatabase });
    assert.deepEqual(saved.map(({ question }) => question), ['Как с вами связаться?']);
    assert.deepEqual(writes, [['Как с вами связаться?', 'Telegram: {{telegram}}, {{phone}}']]);
  });
});

describe('submission', () => {
  test('the send button is a submit click, «Далее» and «Назад» are not', () => {
    assert.ok(isSubmitClick('Отправить'));
    assert.ok(isSubmitClick('  Submit '));
    assert.ok(isSubmitClick('Отправить ответ'));
    assert.ok(!isSubmitClick('Далее'));
    assert.ok(!isSubmitClick('Next'));
    assert.ok(!isSubmitClick('Назад'));
    assert.ok(!isSubmitClick('Очистить форму'));
    assert.ok(!isSubmitClick(undefined));
  });

  const sent = { formSeen: true, fields: 0, ready: true, text: '', submitClicked: false };
  test('a confirmation page (Google, Yandex, Microsoft) without the form is a submission', () => {
    assert.ok(isSubmitted({ ...sent, text: 'Анкета кандидата Ваш ответ записан. Отправить ещё один ответ' }));
    assert.ok(isSubmitted({ ...sent, text: 'Спасибо! Мы свяжемся с вами' }));
    assert.ok(isSubmitted({ ...sent, text: 'Your response was submitted.' }));
  });

  test('the form gone after a click on its send button is a submission', () => {
    assert.ok(isSubmitted({ ...sent, text: 'Вакансия', submitClicked: true }));
  });

  test('no submission while the form is shown, loading, never seen, or gone without a send', () => {
    assert.ok(!isSubmitted({ ...sent, fields: 3, text: 'Спасибо за интерес к вакансии', submitClicked: true }));
    assert.ok(!isSubmitted({ ...sent, ready: false, submitClicked: true }));
    assert.ok(!isSubmitted({ ...sent, formSeen: false, text: 'Спасибо' }));
    assert.ok(!isSubmitted({ ...sent, text: 'Страница 2 из 3' }));
  });
});

describe('stableEdits: answers changed before the form is sent', () => {
  const initial = [{ title: 'English?', answer: '(3) Fluent' }, { title: 'Projects?', answer: 'draft' }];

  test('an answer changed and left as it is for the stable time is given once', () => {
    const tracked = new Map();
    const at = (now, english) => stableEdits(tracked, [{ title: 'English?', answer: english }, { title: 'Projects?', answer: 'draft' }], { now, stableMs: 60000, initial });
    assert.deepEqual(at(0, '(3) Fluent'), []);
    assert.deepEqual(at(10000, '(2) Upper'), []);
    assert.deepEqual(at(60000, '(2) Upper'), []);
    assert.deepEqual(at(70000, '(2) Upper').map((answer) => answer.title), ['English?']);
    assert.deepEqual(at(200000, '(2) Upper'), []);
  });

  test('the prefilled answers, unchanged, are never given; typing restarts the wait', () => {
    const tracked = new Map();
    stableEdits(tracked, [{ title: 'Projects?', answer: 'draft' }], { now: 0, initial });
    assert.deepEqual(stableEdits(tracked, [{ title: 'Projects?', answer: 'draft' }], { now: 999999, initial }), []);
    stableEdits(tracked, [{ title: 'Projects?', answer: 'my te' }], { now: 1000000, initial });
    stableEdits(tracked, [{ title: 'Projects?', answer: 'my text' }], { now: 1030000, initial });
    assert.deepEqual(stableEdits(tracked, [{ title: 'Projects?', answer: 'my text' }], { now: 1070000, initial }), []);
    assert.equal(stableEdits(tracked, [{ title: 'Projects?', answer: 'my text' }], { now: 1090000, initial }).length, 1);
  });
});
