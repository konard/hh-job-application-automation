/**
 * Answers in the vacancy's context (data/answer-contexts.lino): a salary in dollars for a vacancy
 * paid in dollars, in rubles otherwise, whichever currency the answer was saved in
 */
import { describe, test, assert } from 'test-anywhere';
import { answersInContexts, chooseContexts, hasWord, loadAnswerContexts, parseAnswerContexts, sameButSums, showsContext } from '../src/answer-contexts.mjs';
import { contactsInContexts, contractContacts, expandContacts, withContacts } from '../src/contacts.mjs';
import { knownReplyInContexts } from '../src/chat-answers.mjs';
import { planAnswers } from '../src/form-prefill.mjs';

const contexts = await loadAnswerContexts();
const currency = (question, known) => chooseContexts(contexts, question, known).find(({ group }) => group === 'currency')?.name;
const vacancy = 'Вакансия предполагает удаленную работу по прямому B2B-контракту с выплатами в валюте (USD). Подходит ли вам такой формат?';
const values = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_usd: '$6 000', salary_gross_usd: '$7 100', telegram: '@me' };

describe('The currency of an answer (data/answer-contexts.lino)', () => {
  test('dollars when the vacancy speaks of dollars, rubles otherwise', () => {
    assert.equal(currency('Какую вилку рассматриваете для себя?', vacancy), 'usd');
    assert.equal(currency('Какую вилку рассматриваете для себя?', 'от 3 000 $ на руки'), 'usd');
    assert.equal(currency('Какую вилку рассматриваете для себя?', 'Удалённая работа, Python'), 'rub');
    assert.equal(currency('Какую вилку рассматриваете для себя?', ''), 'rub');
  });

  test('the question\'s own currency first', () => {
    assert.equal(currency('На какой уровень дохода (в рублях на руки) вы ориентируетесь?', vacancy), 'rub');
    assert.equal(currency('От какой суммы вы рассматриваете предложения $/net ?', 'Удалённая работа'), 'usd');
    assert.equal(currency('Ваши ожидания по зарплате (в месяц, в USD)?', ''), 'usd');
  });

  test('words that only look like a currency are not one', () => {
    assert.equal(hasWord('usd', 'платежи в USDT'), false);
    assert.equal(hasWord('руб.', 'рубрикатор'), false);
    assert.equal(hasWord('рубл', 'в рублях'), true);
    assert.equal(currency('Ваши ожидания?', 'Работа с USDT-платежами, рубрикатор'), 'rub');
  });

  test('the saved answer in either currency', () => {
    const inUsd = contactsInContexts(values, chooseContexts(contexts, 'Ваша вилка?', vacancy));
    assert.equal(expandContacts('От {{salary_net}} на руки ({{salary_gross}} до вычета)', inUsd), 'От $6 000 на руки ($7 100 до вычета)');
    assert.equal(inUsd.telegram, '@me');
    const inRub = contactsInContexts(values, chooseContexts(contexts, 'Ваша вилка?', ''));
    assert.equal(expandContacts('От {{salary_net_usd}} на руки или эквивалент.', inRub), 'От 450 000 ₽ на руки или эквивалент.');
  });

  test('a sum missing in that context keeps the saved one', () => {
    const noRate = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_usd: '$6 000' };
    assert.equal(contactsInContexts(noRate, chooseContexts(contexts, 'Ваша вилка?', vacancy)).salary_gross, '530 000 ₽');
  });

  test('the Q&A database read in contexts', async () => {
    const db = { readQADatabase: async () => new Map([['Ваша вилка ЗП?', 'От {{salary_net}} в месяц на руки.']]) };
    const qa = withContacts(db, values);
    assert.equal((await qa.readQADatabase()).get('Ваша вилка ЗП?'), 'От 450 000 ₽ в месяц на руки.');
    assert.equal((await qa.readQADatabase({ contexts: chooseContexts(contexts, 'Ваша вилка ЗП?', vacancy) })).get('Ваша вилка ЗП?'), 'От $6 000 в месяц на руки.');
  });
});

describe('Context-aware answers everywhere', () => {
  const qa = withContacts({ readQADatabase: async () => new Map([
    ['Ваши зарплатные ожидания мин - комфорт?', 'От {{salary_net_usd}} на руки или эквивалент.'],
    ['Готовы к офису?', 'Нет'],
  ]) }, values);
  const card = 'Full-Stack разработчик PHP/Laravel + React\nот 250 000 ₽ на руки\nООО Дата Технолоджи';

  test('the most telling text decides: the card\'s pay before the description', () => {
    assert.equal(currency('Ваша вилка?', [card, 'Интеграции с платёжными API в USD']), 'rub');
    assert.equal(currency('Ваша вилка?', ['Удалённая работа', 'Оплата в USD']), 'usd');
    assert.equal(showsContext(contexts, ['Удалённая работа']), false);
    assert.equal(showsContext(contexts, ['от 3 000 $']), true);
  });

  test('an answer saved in dollars is typed in rubles for a vacancy paid in rubles', async () => {
    const inContexts = answersInContexts(qa.readQADatabase, contexts);
    assert.equal((await inContexts('Ваши зарплатные ожидания мин - комфорт?', [card])).get('Ваши зарплатные ожидания мин - комфорт?'),
      'От 450 000 ₽ на руки или эквивалент.');
    assert.equal((await inContexts('Ваши зарплатные ожидания мин - комфорт?', ['от 3 000 $'])).get('Ваши зарплатные ожидания мин - комфорт?'),
      'От $6 000 на руки или эквивалент.');
  });

  test('an answer typed before in another currency is told by its words', () => {
    assert.equal(sameButSums('От 6000 USDT на руки или эквивалент.', 'От 450 000 ₽ на руки или эквивалент.'), true);
    assert.equal(sameButSums('От 350 тыс. рублей могу рассмотреть.', 'От $6 000 могу рассмотреть.'), true);
    assert.equal(sameButSums('От 6000 USDT на руки.', 'От 450 000 ₽ в месяц на руки.'), false);
    assert.equal(sameButSums('Да', 'Да'), false);
  });

  test('a salary written as USDT is saved as the dollar placeholder', () => {
    assert.equal(contractContacts('От 6000 USDT на руки или эквивалент.', { salary_net_usd: '6000' }), 'От {{salary_net_usd}} на руки или эквивалент.');
  });

  test('chats: the chat tells the currency, else the vacancy page, read only when the reply depends on it', async () => {
    const sources = { readTemplates: async () => new Map(), readQADatabase: qa.readQADatabase, contexts };
    const asked = { title: 'Бот', text: 'Ваши зарплатные ожидания мин - комфорт?' };
    let read = 0;
    const vacancyTexts = async () => { read++; return ['от 5 000 $']; };
    assert.equal((await knownReplyInContexts(asked, { ...sources, known: ['Зарплата в рублях'], vacancyTexts })).answer, 'От 450 000 ₽ на руки или эквивалент.');
    assert.equal(read, 0);
    assert.equal((await knownReplyInContexts(asked, { ...sources, known: ['Здравствуйте!'], vacancyTexts })).answer, 'От $6 000 на руки или эквивалент.');
    assert.equal(read, 1);
    await knownReplyInContexts({ title: 'Бот', text: 'Готовы к офису?' }, { ...sources, known: [], vacancyTexts });
    assert.equal(read, 1);
    assert.equal((await knownReplyInContexts(asked, { ...sources, known: [] })).answer, 'От 450 000 ₽ на руки или эквивалент.');
  });

  test('forms prefilled in slots take the answers of each question\'s contexts', async () => {
    const inContexts = answersInContexts(qa.readQADatabase, contexts);
    const fields = [{ id: '1', kind: 'text', title: 'Ваши зарплатные ожидания мин - комфорт?' }];
    const map = await inContexts(fields[0].title, ['от 3 000 $']);
    const [planned] = planAnswers(fields, { profile: {}, qaMap: await qa.readQADatabase(), qaMapFor: () => map });
    assert.equal(planned.answer, 'От $6 000 на руки или эквивалент.');
  });
});

describe('Any context group', () => {
  const custom = parseAnswerContexts(new Map([
    ['format: office', ['офис', '{{format}}: Готов к офису']],
    ['format: remote (default)', ['удален', 'удалён', '{{format}}: Только удалённо']],
  ]));

  test('words, placeholders and the default of a group', () => {
    assert.deepEqual(custom.map(({ name, isDefault }) => [name, isDefault]), [['office', false], ['remote', true]]);
    assert.equal(chooseContexts(custom, 'Формат работы?', 'Работа в офисе, Москва')[0].name, 'office');
    assert.equal(chooseContexts(custom, 'Формат работы?', '')[0].name, 'remote');
    // Both shown in the question: the vacancy decides
    assert.equal(chooseContexts(custom, 'Офис или удалённо?', 'Только удалённая работа')[0].name, 'remote');
    assert.equal(contactsInContexts({}, chooseContexts(custom, 'Формат?', 'офис')).format, 'Готов к офису');
  });
});
