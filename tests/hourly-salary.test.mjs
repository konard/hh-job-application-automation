import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { salaryValues } from '../src/salary.mjs';
import { salaryQuestion, inferSalaryAnswer, learnSalaryPatterns, salaryClarificationQuestion } from '../src/salary-questions.mjs';
import { contractContacts, loadContacts, withContacts } from '../src/contacts.mjs';
import { answersInContexts, loadAnswerContexts } from '../src/answer-contexts.mjs';
import { savedAnswersInContext } from '../src/vacancy-response.mjs';
import { planAnswers } from '../src/form-prefill.mjs';
import { selectSalaryOption } from '../src/salary-options.mjs';
import { knownReplyInContexts } from '../src/chat-answers.mjs';

const question = 'Какую почасовую ставку (руб/час) рассматриваете для себя?';
const targets = salaryValues({ netRub: 450000, netUsd: 6000, netEur: 5500, usdRate: 84.9048, eurRate: 93.7693 });
const patterns = learnSalaryPatterns(new Map([['Ваши зарплатные ожидания?', 'От {{salary_net}} в месяц на руки.']]));
const makeDb = (values = targets, saved = new Map()) => withContacts({ readQADatabase: async () => new Map(saved) }, values);

test('hourly expectations use their own period, language and tax basis', () => {
  expect(salaryQuestion(question)).toEqual({ shape: 'net', language: 'ru', period: 'hour' });
  expect(inferSalaryAnswer(question, patterns)).toBe('От {{salary_net_hourly}} в час на руки.');
  expect(inferSalaryAnswer('What hourly rate in USD do you expect before taxes?', patterns)).toBe('From {{salary_gross_hourly}} gross per hour.');
  expect(inferSalaryAnswer('Ваша часовая ставка в евро до вычета налогов?', patterns)).toBe('От {{salary_gross_hourly}} в час до вычета {{salary_tax}}.');
  for (const text of ['Ваша предыдущая почасовая ставка?', 'What was your previous hourly rate?',
    'Подходит ли почасовая ставка 1000 рублей?', 'Как рассчитать почасовую ставку?', 'Сколько часов в неделю вы работаете?']) {
    expect(salaryQuestion(text)).toBeNull();
  }
});

test('division uses configurable hours and each currency target, rounding upward in currency steps', () => {
  expect(targets.salary_net_hourly).toBe('3 000 ₽');
  expect(targets.salary_gross_hourly).toBe('3 500 ₽');
  expect(targets.salary_net_hourly_usd).toBe('$40');
  expect(targets.salary_net_hourly_usdt).toBe('40 USDT');
  expect(targets.salary_net_hourly_eur).toBe('35 €');
  expect(salaryValues({ netRub: 450000, monthlyHours: 180 }).salary_net_hourly).toBe('2 500 ₽');
  expect(salaryValues({ netRub: 480000 }).salary_net_hourly).toBe('3 000 ₽');
  for (const monthlyHours of [0, -1, NaN, Infinity]) {
    expect(salaryValues({ netRub: 450000, monthlyHours }).salary_net_hourly).toBeUndefined();
  }
  expect(salaryValues({ netUsd: 6000 }).salary_net_hourly_usd).toBe('$40');
  expect(salaryValues({ netUsd: 6000 }).salary_gross_hourly_usd).toBeUndefined();
});

test('exact rounding steps stay unchanged; any excess rounds to the next step', () => {
  for (const [hourly, expected] of [[2499.99, '2 500 ₽'], [2500, '2 500 ₽'], [2500.01, '3 000 ₽']]) {
    expect(salaryValues({ netRub: hourly * 160 }).salary_net_hourly).toBe(expected);
  }
  for (const [hourly, expected] of [[39.99, '$40'], [40, '$40'], [40.01, '$45']]) {
    expect(salaryValues({ netUsd: hourly * 160 }).salary_net_hourly_usd).toBe(expected);
  }
  expect(salaryValues({ netEur: 40 * 160 }).salary_net_hourly_eur).toBe('40 €');
});

test('contacts load the configurable hours rather than treating the decimal as an integer', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hourly-salary-'));
  try {
    const file = path.join(directory, 'contacts.lino');
    await fs.writeFile(file, 'salary_net_rub\n  450000\nsalary_hours_per_month\n  187.5\n');
    expect((await loadContacts(file)).salary_net_hourly).toBe('2 500 ₽');
    await fs.writeFile(file, 'salary_net_rub\n  450000\n');
    expect((await loadContacts(file)).salary_net_hourly).toBe('3 000 ₽');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('hourly replies follow explicit currencies over vacancy currency, including Russian rub/час', async () => {
  const db = makeDb();
  const answer = answersInContexts(db.readQADatabase, await loadAnswerContexts());
  expect((await answer(question, 'Paid in USD')).get(question)).toBe('От 3 000 ₽ в час на руки.');
  const usd = 'Какую почасовую ставку в долларах на руки рассматриваете?';
  expect((await answer(usd, 'Зарплата в рублях')).get(usd)).toBe('От $40 в час на руки.');
  const gross = 'What hourly rate in EUR do you expect before taxes?';
  expect((await answer(gross, '')).get(gross)).toBe('From 45 € gross per hour.');
  const stable = 'What hourly rate do you expect?';
  expect((await answer(stable, 'Blockchain, USDT')).get(stable)).toBe('From 40 USDT net per hour.');
  const missing = answersInContexts(makeDb(salaryValues({ netRub: 450000 })).readQADatabase, await loadAnswerContexts());
  expect((await missing(usd, '')).has(usd)).toBe(false);
});

test('a monthly answer stored under an hourly question is replaced by the hourly calculation', async () => {
  const db = makeDb(targets, new Map([[question, 'От {{salary_net}} в месяц на руки.']]));
  expect((await db.readQADatabase({ questions: [question] })).get(question)).toBe('От 3 000 ₽ в час на руки.');
  const learned = learnSalaryPatterns(new Map([[question, 'От {{salary_net_hourly}} в час на руки.']]));
  expect(inferSalaryAnswer('Ваши зарплатные ожидания?', learned)).toBe('От {{salary_net}} в месяц на руки.');
});

test('hourly values are saved as hourly placeholders and refresh when the monthly target changes', async () => {
  expect(contractContacts('От 3000 рублей в час на руки.', targets)).toBe('От {{salary_net_hourly}} в час на руки.');
  expect(contractContacts('From $40 net per hour.', targets)).toBe('From {{salary_net_hourly_usd}} net per hour.');
  expect(contractContacts('From 40 USDT net per hour.', targets)).toBe('From {{salary_net_hourly_usdt}} net per hour.');
  expect(contractContacts('От 2500 рублей в час.', salaryValues({ netRub: 400000 }))).toBe('От {{salary_net_hourly}} в час.');
  const saved = new Map([[question, 'От {{salary_net_hourly}} в час на руки.']]);
  expect((await makeDb(salaryValues({ netRub: 560000 }), saved).readQADatabase()).get(question)).toBe('От 3 500 ₽ в час на руки.');
});

test('HH.ru questionnaires and external forms use the same calculated hourly answer', async () => {
  const db = makeDb();
  const commander = { evaluate: async () => [{ question, type: 'textarea', selector: 'textarea', currentValue: '' }] };
  const saved = await savedAnswersInContext({ commander, readQADatabase: db.readQADatabase });
  expect(saved.get(question)).toBe('От 3 000 ₽ в час на руки.');
  const [plan] = planAnswers([{ kind: 'text', title: question }], { profile: {}, contacts: targets, qaMap: saved });
  expect(plan.answer).toBe('От 3 000 ₽ в час на руки.');
});

test('chat proposals and salary clarification chains keep hourly units', async () => {
  const db = makeDb();
  const contexts = await loadAnswerContexts();
  const sources = { readQADatabase: db.readQADatabase, readTemplates: async () => new Map(), contexts };
  const reply = await knownReplyInContexts({ title: 'Recruiter', text: question }, sources);
  expect(reply.answer).toBe('От 3 000 ₽ в час на руки.');
  expect(reply.perfect).toBe(false);
  const anchor = 'What hourly rate do you expect in USD net?';
  const clarified = salaryClarificationQuestion('And gross in EUR?', [anchor]);
  expect(salaryQuestion(clarified)).toEqual({ shape: 'gross', language: 'en', period: 'hour' });
});

test('hourly option selection uses hourly targets and never the monthly baseline', () => {
  const options = ['До 2000 руб', 'От 2000 до 3000 руб', 'Свыше 3000 руб'];
  expect(selectSalaryOption({ question, options, contacts: targets })).toMatchObject({ option: options[1], values: [3000] });
  expect(selectSalaryOption({ question, options, contacts: { salary_net: '450 000 ₽' } })).toBeNull();
  expect(selectSalaryOption({ question, options, answer: 'От 450 000 ₽ в месяц на руки.' })).toBeNull();
  expect(selectSalaryOption({ question: 'What hourly rate in USD net?', options: ['Up to $40', 'Over $40'], contacts: targets }))
    .toMatchObject({ option: 'Up to $40', contained: true, values: [40] });
  expect(selectSalaryOption({ question, options: ['Свыше 3000 руб'], contacts: targets, closest: true }))
    .toMatchObject({ contained: false });
});
