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

  test('$6000 net at 84.9 ₽: rubles rounded up to 10 000, dollars to 100', () => {
    assert.deepEqual(salaryValues({ netUsd: 6000, usdRate: 84.9048 }), {
      salary_net: '510 000 ₽',
      salary_gross: '610 000 ₽',
      salary_net_usd: '$6 000',
      salary_gross_usd: '$7 100',
      salary_ndfl: '13% / 15% / 18%',
    });
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
