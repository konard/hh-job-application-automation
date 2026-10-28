import { test, expect } from 'bun:test';
import { salaryAmounts, selectSalaryOption } from '../src/salary-options.mjs';
import { planAnswers } from '../src/form-prefill.mjs';
import { fillRadioQuestion } from '../src/qa.mjs';
import { chooseChatOption } from '../src/chat-options.mjs';

const question = 'В каком диапазоне рассматриваете предложения? (на руки)';
const options = ['До 100 тыс. руб', ...Array.from({ length: 7 }, (_, i) => `От ${101 + i * 20} тыс. руб до ${120 + i * 20} тыс. руб`), 'Свыше 241 тыс. руб', 'Own variant'];
const contacts = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_usd: '$6 000' };

test('Russian thousands and English abbreviations are numeric amounts, not fuzzy text', () => {
  expect(salaryAmounts('От 221 тыс. руб до 240 тыс. руб')).toEqual([221000, 240000]);
  expect(salaryAmounts('RUB 90,000–120,000')).toEqual([90000, 120000]);
  expect(salaryAmounts('100–120 тыс. руб')).toEqual([100000, 120000]);
  expect(salaryAmounts('EUR 1,5k–2k')).toEqual([1500, 2000]);
  expect(selectSalaryOption({ question, options, contacts })).toMatchObject({ option: 'Свыше 241 тыс. руб', contained: true });
});
test('external forms choose the target band despite an old learned lower band', () => {
  const result = planAnswers([{ kind: 'radio', title: question, options }], { profile: {}, contacts, qaMap: new Map([[question, options[7]]]) });
  expect(result[0].choices).toEqual(['Свыше 241 тыс. руб']);
  expect(chooseChatOption({ question, options, contacts, reply: { answer: options[7], perfect: true } })).toMatchObject({ option: 'Свыше 241 тыс. руб' });
});
test('closest band is prefilled only when unique; currencies and gross/net remain separate', () => {
  const bands = ['До 100 тыс. руб', 'От 121 тыс. руб до 140 тыс. руб'];
  expect(selectSalaryOption({ question, options: bands, contacts: { salary_net: '115 000 ₽' } })).toBeNull();
  expect(selectSalaryOption({ question, options: bands, contacts: { salary_net: '115 000 ₽' }, closest: true })).toMatchObject({ option: bands[1], contained: false });
  expect(selectSalaryOption({ question, options: bands, contacts: { salary_net: '110 500 ₽' }, closest: true })).toBeNull();
  expect(selectSalaryOption({ question: 'Salary expectations in USD net?', options, contacts, closest: true })).toBeNull();
  expect(selectSalaryOption({ question: 'Salary expectations gross in RUB?', options: ['До 500 тыс. руб', 'Свыше 500 тыс. руб'], contacts })).toMatchObject({ option: 'Свыше 500 тыс. руб' });
});
test('HH.ru radios use the same numeric choice and never submit the form', async () => {
  const clicked = [];
  const commander = { evaluate: async () => false, clickButton: async ({ selector }) => clicked.push(selector), wait: async () => {} };
  const filled = await fillRadioQuestion({ commander, questionData: { question, name: 'salary', answer: 'От 450 000 ₽ в месяц на руки.',
    options: options.map((optionText, index) => ({ optionText, value: String(index) })) } });
  expect(filled).toBe(true);
  expect(clicked).toEqual(['input[name="salary"][value="8"]']);
});
