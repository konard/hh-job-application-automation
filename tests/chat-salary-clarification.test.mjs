import { describe, test, expect } from 'bun:test';
import { withContacts } from '../src/contacts.mjs';
import { loadAnswerContexts } from '../src/answer-contexts.mjs';
import { chatContextTexts, knownReplyInContexts } from '../src/chat-answers.mjs';

const contexts = await loadAnswerContexts();
const contacts = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_usd: '$6 000', salary_gross_usd: '$7 500',
  salary_net_eur: '5 500 €', salary_gross_eur: '6 900 €', salary_tax: 'НДФЛ' };
const original = 'Константин, спасибо за отклик! Подскажи свои зарплатные ожидания в долларах?';
const clarification = 'Константин подскажи пожалуйста цифры в долларах и до вычета налогов, спасибо!';
const saved = [
  ['Ваши зарплатные ожидания?', 'От {{salary_net}} в месяц на руки.'],
  ['Зарплатные ожидания gross?', 'От {{salary_gross}} в месяц до вычета {{salary_tax}}.'],
  ['Your salary expectations?', 'From {{salary_net}} net per month.'],
];
const sources = (values = contacts, extra = []) => ({
  contexts, readTemplates: async () => new Map(),
  readQADatabase: withContacts({ readQADatabase: async () => new Map([...saved, ...extra]) }, values).readQADatabase,
});

describe('salary currency and tax follow-ups in recruiter chats', () => {
  test('a salary acknowledgement followed by a GitHub question uses the actual question', async () => {
    const values = { ...contacts, github: 'github.com/example' };
    const wrappedTemplates = withContacts({ readQADatabase: async () => new Map() }, values).readQADatabase;
    for (const question of [
      'Спасибо за информацию о зарплате. Можете, пожалуйста, поделиться ссылкой на ваш GitHub или примеры кода, если они у вас есть?',
      'Thanks for sharing your salary expectations. Could you share your GitHub profile?',
    ]) {
      const reply = await knownReplyInContexts({ text: question }, {
        ...sources(values, [['pattern: github', '{{github}}']]), readTemplates: wrappedTemplates,
        known: [question, 'На какую заработную плату вы ориентируетесь на старте?'],
      });
      expect(reply).toMatchObject({ answer: 'github.com/example', perfect: false });
      expect(reply.source).toMatch(/^qa.lino/);
      expect(reply.answer).not.toMatch(/450|530|₽/);
    }
  });

  test('a new topic without a saved answer cannot fall back to the acknowledged salary', async () => {
    const question = 'Спасибо за информацию о зарплате. Можете поделиться ссылкой на ваш GitHub?';
    const reply = await knownReplyInContexts({ text: question }, {
      ...sources(), readTemplates: withContacts({ readQADatabase: async () => new Map() }, contacts).readQADatabase,
      known: [question, original],
    });
    expect(reply).toBeNull();
  });

  test('salary inference through wrapped templates never becomes an exact saved-template match', async () => {
    const question = 'Спасибо за отклик. Какие у вас зарплатные ожидания?';
    const reply = await knownReplyInContexts({ text: question }, {
      ...sources(), readTemplates: withContacts({ readQADatabase: async () => new Map() }, contacts).readQADatabase,
      known: [question],
    });
    expect(reply).toMatchObject({ answer: 'От 450 000 ₽ в месяц на руки.', perfect: false, source: 'salary question by pattern' });
  });

  test('the screenshot conversation gets Russian USD gross, ignoring the previously sent ruble net amount', async () => {
    const chat = { vacancy: 'Senior Backend Developer', messages: [
      { mine: false, text: original },
      { mine: true, text: 'От 450000 рублей в месяц на руки.' },
      { mine: false, text: clarification },
    ] };
    const reply = await knownReplyInContexts({ text: clarification }, { ...sources(), known: chatContextTexts(chat) });
    expect(reply).toMatchObject({ answer: 'От $7 500 в месяц до вычета налогов.', source: 'salary clarification by pattern', perfect: false });
    expect(reply.answer).not.toMatch(/₽|рубл|From|НДФЛ|6 000/);
    const first = await knownReplyInContexts({ text: original }, { ...sources(), known: [original, chat.vacancy] });
    expect(first.answer).toMatch(/\$6 000/);
    expect(first.answer).not.toMatch(/₽|рубл/);
  });

  test('explicit rubles override earlier dollars; a short follow-up inherits the latest gross basis', async () => {
    const question = 'А в рублях?';
    const reply = await knownReplyInContexts({ text: question }, { ...sources(), known: [question, clarification, original] });
    expect(reply.answer).toBe('От 530 000 ₽ в месяц до вычета НДФЛ.');
  });

  test('English, euros, and net follow-ups keep their independent language/currency/basis', async () => {
    const question = 'Please provide the amount in EUR before taxes.';
    const reply = await knownReplyInContexts({ text: question }, { ...sources(), known: [question, 'What are your salary expectations?'] });
    expect(reply.answer).toBe('From 6 900 € gross per month (5 500 € net).');
    const net = 'А в долларах на руки?';
    expect((await knownReplyInContexts({ text: net }, { ...sources(), known: [net, clarification, original] })).answer)
      .toBe('От $6 000 в месяц на руки.');
  });

  test('a historical wrong-basis answer cannot override an explicit gross correction', async () => {
    const reply = await knownReplyInContexts({ text: clarification }, {
      ...sources(contacts, [[clarification, 'От {{salary_net}} в месяц на руки.']]), known: [clarification, original],
    });
    expect(reply.answer).toBe('От $7 500 в месяц до вычета налогов.');
    expect(reply.perfect).toBe(false);
  });

  test('missing USD gross and unrelated prior topics cannot produce a ruble fallback', async () => {
    const { salary_gross_usd, ...missing } = contacts;
    expect(salary_gross_usd).toBe('$7 500');
    expect(await knownReplyInContexts({ text: clarification }, { ...sources(missing), known: [clarification, original] })).toBeNull();
    const unrelated = await knownReplyInContexts({ text: 'А в долларах?' }, {
      ...sources(), known: ['А в долларах?', 'Расскажите об опыте работы с PostgreSQL.', original],
    });
    expect(unrelated?.source).not.toBe('salary clarification by pattern');
  });
});
