/**
 * Tests for salary answers from the net baseline: gross through the progressive income tax, the
 * placeholders, and question templates («pattern: gross») in saved answers
 */
import { describe, test, assert } from 'test-anywhere';
import { annualGrossFromNet, salaryValues } from '../src/salary.mjs';
import { findBestMatch } from '../src/qa-database.mjs';
import { expandContacts, withContacts } from '../src/contacts.mjs';

describe('Gross from net', () => {
  test('within the first bracket: 13%', () => {
    const { gross, rates } = annualGrossFromNet(870000);
    assert.equal(Math.round(gross), 1000000);
    assert.deepEqual(rates, [0.13]);
  });

  test('through three brackets: 13% / 15% / 18%', () => {
    // 2.4M at 13% and 2.6M at 15% leave 4 298 000 net; the rest is taxed at 18%
    const { gross, rates } = annualGrossFromNet(4298000 + 820000);
    assert.equal(Math.round(gross), 6000000);
    assert.deepEqual(rates, [0.13, 0.15, 0.18]);
  });

  test('rubles and dollars from their own baselines, gross rounded up', () => {
    assert.deepEqual(salaryValues({ netRub: 450000, netUsd: 6000, usdRate: 84.9048 }), {
      salary_net: '450 000 ₽',
      salary_gross: '530 000 ₽',
      salary_ndfl: '13% / 15% / 18%',
      salary_net_usd: '$6 000',
      salary_gross_usd: '$7 100',
    });
  });

  test('no rate: the dollar gross is left out', () => {
    assert.ok(!('salary_gross_usd' in salaryValues({ netRub: 450000, netUsd: 6000 })));
  });
});

describe('Question templates', () => {
  const qa = new Map([
    ['Ваши зарплатные ожидания?', 'От {{salary_net}} в месяц на руки.'],
    ['pattern: gross', 'От {{salary_gross}} в месяц до вычета НДФЛ.'],
    ['pattern: gross … usd', 'От {{salary_gross_usd}} в месяц до вычета налогов.'],
  ]);

  test('any wording of a gross question takes the gross answer, not a similar net one', () => {
    assert.equal(findBestMatch('На какой уровень з/пл ориентируетесь в gross?', qa).question, 'pattern: gross');
  });

  test('the most specific template wins', () => {
    assert.equal(findBestMatch('Ожидания в gross, в USD?', qa).question, 'pattern: gross … usd');
  });

  test('a template is not a fuzzy match for other questions', () => {
    assert.equal(findBestMatch('Ваши зарплатные ожидания?', qa).question, 'Ваши зарплатные ожидания?');
  });

  test('placeholders are filled, an answer whose placeholder has no value is left out', async () => {
    const db = withContacts({ readQADatabase: async () => qa, addOrUpdateQA: async () => {} }, { salary_net: '510 000 ₽' });
    const read = await db.readQADatabase();
    assert.equal(read.get('Ваши зарплатные ожидания?'), 'От 510 000 ₽ в месяц на руки.');
    assert.ok(!read.has('pattern: gross'));
    assert.equal(expandContacts('{{salary_net}}', { salary_net: '510 000 ₽' }), '510 000 ₽');
  });
});

describe('Salary written back as placeholders', () => {
  test('as people write it, in rubles and dollars', async () => {
    const { contractContacts } = await import('../src/contacts.mjs');
    const contacts = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_usd: '$6 000' };
    assert.equal(contractContacts('От 6000 долларов на руки.', contacts), 'От {{salary_net_usd}} на руки.');
    assert.equal(contractContacts('От $6000, от 450000 рублей, 530 000 ₽', contacts), 'От {{salary_net_usd}}, от {{salary_net}}, {{salary_gross}}');
    assert.equal(contractContacts('Опыт 6000 часов, 1450000 рублей', contacts), 'Опыт 6000 часов, 1450000 рублей');
  });
});
