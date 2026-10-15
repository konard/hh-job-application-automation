/**
 * Answers in the vacancy's context (data/answer-contexts.lino): a salary in dollars for a vacancy
 * paid in dollars, in rubles otherwise, whichever currency the answer was saved in
 */
import { describe, test, assert } from 'test-anywhere';
import { chooseContexts, hasWord, loadAnswerContexts, parseAnswerContexts } from '../src/answer-contexts.mjs';
import { contactsInContexts, expandContacts, withContacts } from '../src/contacts.mjs';

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
