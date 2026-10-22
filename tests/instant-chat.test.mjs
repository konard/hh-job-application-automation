import { describe, expect, test } from 'bun:test';
import { answersPassed, perfectOption } from '../src/instant-chat.mjs';
import { knownReply } from '../src/chat-answers.mjs';

describe('instant chat answers', () => {
  test('a saved answer is a perfect option only when it is the button itself', () => {
    expect(perfectOption('Да.', ['Да', 'Нет'])).toBe('Да');
    expect(perfectOption('Да, есть опыт', ['Да', 'Нет'])).toBe(null);
  });

  test('a saved question is perfect only when it is the question itself', () => {
    const qaMap = new Map([['У вас есть опыт работы с Картами, маршрутизацией, в том числе в Offline режиме?', 'Да']]);
    const exact = knownReply({ title: '', text: 'У вас есть опыт работы с картами, маршрутизацией, в том числе в Offline режиме?' }, { templates: new Map(), qaMap });
    expect(exact).toMatchObject({ answer: 'Да', perfect: true });
    const close = knownReply({ title: '', text: 'У вас есть опыт работы с картами и маршрутизацией?' }, { templates: new Map(), qaMap });
    expect(close?.perfect ?? false).toBe(false);
  });

  test('the bot\'s closing message needs no reply', () => {
    const templates = new Map([['Спасибо! Ваши ответы отправлены работодателю. Если ваш отклик его заинтересует, он напишет в этом же чате или позвонит по номеру, который вы указали.', '[без ответа]']]);
    const reply = knownReply({ title: 'Робот-рекрутер', text: 'Спасибо! Ваши ответы отправлены работодателю. Если ваш отклик его заинтересует, он напишет в этом же чате или позвонит по номеру, который вы указали.' }, { templates, qaMap: new Map() });
    expect(reply).toMatchObject({ noReply: true, perfect: true });
  });

  test('hh.ru saying the answers are passed on ends the bot, in any wording', () => {
    for (const text of ['Спасибо за ответы! Мы передали их работодателю.', 'Спасибо! Ваши ответы отправлены работодателю.',
      'Thank you for your answers! We have passed them to the employer.', 'Your answers have been sent to the employer.']) {
      expect(answersPassed({ text })).toBe(true);
    }
    for (const text of ['Опыт работы с Playwright или Cypress/Selenium', 'Готовы оформиться самозанятым или работать через ИП?', 'Какой у вас опыт с ответами клиентам?']) {
      expect(answersPassed({ text })).toBe(false);
    }
  });
});
