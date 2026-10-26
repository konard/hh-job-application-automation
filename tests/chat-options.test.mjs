import { describe, test, expect } from 'bun:test';
import { answerWasRepeated, chooseChatOption, requiresChatOption } from '../src/chat-options.mjs';
import { inferSalaryAnswer, learnSalaryPatterns, salaryQuestion } from '../src/salary-questions.mjs';
import { withContacts } from '../src/contacts.mjs';
import { countChatAnswers, knownReply, learnedPairs } from '../src/chat-answers.mjs';

const question = 'Please specify your expected net monthly salary in Russian rubles (gross) (select one of the options):';
const options = ['Up to RUB 90,000', 'RUB 90,000–120,000', 'RUB 120,000–170,000', 'RUB 180,000 or more'];
const contacts = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_rub: '450000' };
const patterns = learnSalaryPatterns(new Map([
  ['Salary expectations net?', 'From {{salary_net}} net per month.'],
  ['Salary expectations gross?', 'From {{salary_gross}} gross per month ({{salary_net}} net).'],
]));

describe('salary basis in chat suggestions', () => {
  test('the main net-salary wording is not changed to gross by a contradictory parenthesis', () => {
    expect(salaryQuestion(question, patterns)).toEqual({ shape: 'net', language: 'en' });
    expect(inferSalaryAnswer(question, patterns)).toBe('From {{salary_net}} net per month.');
    expect(salaryQuestion('Expected gross monthly salary in RUB?', patterns)).toEqual({ shape: 'gross', language: 'en' });
  });

  test('saved gross and net attempts stay recorded, but a net question only prefills the net wording', async () => {
    const saved = new Map([[question, 'From {{salary_gross}} gross per month ({{salary_net}} net). | From {{salary_net}} net per month.']]);
    const original = saved.get(question);
    const db = withContacts({ readQADatabase: async () => new Map(saved) }, contacts);
    expect((await db.readQADatabase()).get(question)).toBe('From 450 000 ₽ net per month.');
    expect(saved.get(question)).toBe(original);
  });

  test('a wrong-basis saved suggestion falls back to a correctly inferred answer without rewriting it', async () => {
    const saved = new Map([
      [question, 'From {{salary_gross}} gross per month ({{salary_net}} net).'],
      ['Salary expectations net?', 'From {{salary_net}} net per month.'],
    ]);
    const db = withContacts({ readQADatabase: async () => new Map(saved) }, contacts);
    expect((await db.readQADatabase({ questions: [question] })).get(question)).toBe('From 450 000 ₽ net per month.');
    expect(saved.get(question)).toContain('{{salary_gross}}');
  });
});

describe('automatic chat options', () => {
  test('the reported question chooses the same top range for both configured net and gross', () => {
    expect(chooseChatOption({ question, options, contacts, reply: { answer: 'From 450 000 ₽ net per month.', perfect: true } }))
      .toMatchObject({ option: 'RUB 180,000 or more', autoSend: true });
  });

  test('net and gross questions select their own ranges', () => {
    const values = { salary_net: '110 000 ₽', salary_gross: '130 000 ₽' };
    expect(chooseChatOption({ question: 'Expected net monthly salary in RUB?', options, contacts: values }))
      .toMatchObject({ option: 'RUB 90,000–120,000' });
    expect(chooseChatOption({ question: 'Expected gross monthly salary in RUB?', options, contacts: values }))
      .toMatchObject({ option: 'RUB 120,000–170,000' });
    expect(chooseChatOption({ question, options, contacts: values })).toBe(null);
  });

  test('an exact saved option is automatic only for the same saved question', () => {
    expect(chooseChatOption({ question: 'Do you have the experience?', options: ['Yes', 'No'], reply: { answer: 'Yes.', perfect: true } }))
      .toMatchObject({ option: 'Yes', autoSend: true });
    expect(chooseChatOption({ question: 'Do you have the experience?', options: ['Yes', 'No'], reply: { answer: 'Yes', perfect: false } }))
      .toMatchObject({ option: 'Yes', autoSend: false });
  });

  test('overlapping boundaries, missing baselines, gaps and currency mismatches remain for review', () => {
    expect(chooseChatOption({ question, options, contacts: { salary_net: '90 000 ₽', salary_gross: '110 000 ₽' } })).toBe(null);
    expect(chooseChatOption({ question, options, contacts: {} })).toBe(null);
    expect(chooseChatOption({ question, options, contacts: { salary_net: '175 000 ₽', salary_gross: '175 000 ₽' } })).toBe(null);
    expect(chooseChatOption({ question, options: ['USD 180,000 or more'], contacts })).toBe(null);
    expect(chooseChatOption({ question, options: ['RUB 180k or more'], contacts })).toBe(null);
  });

  test('a specific saved amount is not replaced with a different default', () => {
    expect(chooseChatOption({ question: 'Expected net monthly salary in RUB?', options, contacts,
      reply: { answer: 'From 100 000 ₽ net per month.', perfect: true } })).toBe(null);
  });

  test('choice-only prompts wait for delayed buttons instead of inviting free text', () => {
    expect(requiresChatOption(question, [])).toBe(true);
    expect(requiresChatOption(question, options)).toBe(true);
    expect(requiresChatOption('How do you choose software libraries?', [])).toBe(false);
  });

  test('English instructions without a question mark are learned and counted as questions', () => {
    const messages = [
      { id: '1', mine: false, text: question, title: 'Робот-рекрутер' },
      { id: '2', mine: true, text: options[3], title: '' },
    ];
    expect(learnedPairs(messages).questions).toEqual([[question, options[3]]]);
    expect(countChatAnswers(messages)).toEqual([{ question, answer: options[3], count: 1 }]);
    expect(knownReply(messages[0], { templates: new Map(), qaMap: new Map([[question, 'From 450 000 ₽ net per month.']]) }))
      .toMatchObject({ answer: 'From 450 000 ₽ net per month.', perfect: true });
  });
});

describe('a bot repeating a question after an invalid answer', () => {
  test('does not propose the same rejected text again', () => {
    const chat = { messages: [
      { id: '1', mine: false, text: question },
      { id: '2', mine: true, text: 'From 450 000 ₽ net per month.' },
      { id: '3', mine: false, text: question },
    ] };
    expect(answerWasRepeated(chat, chat.messages[2], 'From 450 000 ₽ net per month.')).toBe(true);
    expect(answerWasRepeated(chat, chat.messages[2], 'RUB 180,000 or more')).toBe(false);
    chat.messages[0].text = 'Another question?';
    expect(answerWasRepeated(chat, chat.messages[2], 'From 450 000 ₽ net per month.')).toBe(false);
  });
});
