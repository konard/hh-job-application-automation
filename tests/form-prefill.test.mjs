/**
 * Tests for prefilling external forms: contacts from the resume, saved answers, choices
 */
import { describe, test, assert } from 'test-anywhere';
import {
  contactAnswer, draftPrompt, formatPhone, linksFor, parseResumeProfile, pickOptions, planAnswers,
} from '../src/form-prefill.mjs';

const RESUME = `Резюме обновлено 7 октября 2026

Иванов Пётр Сергеевич

Мужчина, 36 лет, родился 2 марта 1990

+7 (900) 1234567 — предпочитаемый способ связи

petr@example.com

telegram: @petr_dev

github.com: https://github.com/petr

Проживает: Вьетнам
`;
const profile = {
  ...parseResumeProfile(RESUME),
  links: ['https://hh.ru/resume/abc', 'https://github.com/petr', 'https://github.com/petr-org'],
  resumeFile: '/tmp/resume.pdf',
};

describe('parseResumeProfile', () => {
  test('reads the contacts of the exported resume', () => {
    assert.deepEqual(parseResumeProfile(RESUME), {
      fullName: 'Иванов Пётр Сергеевич', firstName: 'Пётр', lastName: 'Иванов', middleName: 'Сергеевич',
      phone: '+79001234567', email: 'petr@example.com', telegram: '@petr_dev', github: 'https://github.com/petr',
      city: 'Вьетнам', birthDate: '02.03.1990',
    });
    assert.equal(formatPhone('+79001234567'), '+7 900 123-45-67');
  });
});

describe('contactAnswer', () => {
  test('a combined contact question gets each part in its order', () => {
    assert.equal(contactAnswer('Укажите имя, номер телефона и Telegram.', profile).answer,
      'Пётр Иванов, +7 900 123-45-67, Telegram: @petr_dev');
  });

  test('ФИО, a first name alone, a last name alone', () => {
    assert.equal(contactAnswer('Твое ФИО', profile).answer, 'Иванов Пётр Сергеевич');
    assert.equal(contactAnswer('Имя', profile).answer, 'Пётр');
    assert.equal(contactAnswer('Фамилия', profile).answer, 'Иванов');
    assert.equal(contactAnswer('Дата рождения', profile).answer, '02.03.1990');
  });

  test('links: the resume alone, a named site, or all', () => {
    assert.deepEqual(linksFor('Ссылка на резюме', profile.links), ['https://hh.ru/resume/abc']);
    assert.deepEqual(linksFor('Ссылка на твой Linkedin', profile.links), []);
    assert.deepEqual(linksFor('Ваш GitHub', profile.links), ['https://github.com/petr', 'https://github.com/petr-org']);
    assert.equal(linksFor('Прикрепите ссылку на резюме, портфолио или профессиональный профиль', profile.links).length, 3);
    assert.equal(contactAnswer('Ссылка на твой Linkedin', profile), null);
  });

  test('a long question is not a contact question', () => {
    assert.equal(contactAnswer(`Опишите проект, в котором ваше имя ${'очень '.repeat(30)}важно`, profile), null);
  });
});

describe('planAnswers', () => {
  const qaMap = new Map([
    ['Укажите Ваши зарплатные ожидания', 'От 450000 рублей в месяц на руки.'],
    ['Готовы выполнить тестовое задание?', 'Да'],
    ['Какой у вас формат работы?', 'Удалённо'],
  ]);

  test('contacts, saved answers, choices and what is left open', () => {
    const planned = planAnswers([
      { id: 'a', kind: 'text', title: 'Твой ник в телеграм' },
      { id: 'b', kind: 'text', title: 'Укажи свои зарплатные ожидания' },
      { id: 'c', kind: 'text', title: 'Ссылка на выполненное тестовое задание' },
      { id: 'd', kind: 'radio', title: 'Какой у вас формат работы?', options: ['Офис', 'Удалённо'], optionIds: ['d1', 'd2'] },
      { id: 'e', kind: 'file', title: 'Прикрепите резюме' },
      { id: 'f', kind: 'textarea', title: 'Опишите самый сложный проект' },
    ], { profile, qaMap });
    assert.equal(planned[0].answer, '@petr_dev');
    assert.equal(planned[1].answer, 'От 450000 рублей в месяц на руки.');
    // A link question does not take a yes/no answer
    assert.equal(planned[2].open, true);
    assert.deepEqual(planned[3].choices, ['Удалённо']);
    assert.equal(planned[4].file, '/tmp/resume.pdf');
    assert.equal(planned[5].open, true);
  });

  test('choices are matched like on hh.ru forms', () => {
    assert.deepEqual(pickOptions(['Да', 'Нет'], 'да'), ['Да']);
    assert.deepEqual(pickOptions(['Python', 'Go', 'Rust'], ['Go', 'Rust']), ['Go', 'Rust']);
    assert.deepEqual(pickOptions(['Офис', 'Гибрид'], 'Удалённо'), []);
  });
});

describe('draftPrompt', () => {
  test('asks for facts only, marks unknowns, and limits a choice to its options', () => {
    const prompt = draftPrompt({
      form: { title: 'Анкета' },
      field: { title: 'Какой опыт?', kind: 'radio', options: ['Большой', 'Нет опыта'] },
      resume: 'резюме',
      related: '',
    });
    assert.ok(prompt.includes('Ничего не выдумывай'));
    assert.ok(prompt.includes('[уточнить'));
    assert.ok(prompt.includes('- Нет опыта'));
  });
});
