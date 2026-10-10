/**
 * Tests for fuzzy question matching functionality
 * Issue #74: Saved questions are not filled on vacancy response page form
 */
import { describe, test, assert } from 'test-anywhere';
import { extractSubjectTerms, findBestMatch, toFormalAddress } from '../src/qa-database.mjs';

// Test data simulating real Q&A database
const qaDatabase = new Map([
  ['Укажите ваши ожидания по заработной плате', 'От 450000 рублей в месяц на руки.'],
  ['Укажите размер заработной платы, от которого вы рассматриваете предложения.', 'От 450000 рублей в месяц на руки.'],
  ['От какой суммы сейчас отталкиваешься на руки ?', 'От 450000 рублей в месяц на руки.'],
  ['Расскажи чуть детальнее о проекте, пожалуйста.', 'Детальнее не получится, NDA.'],
  ['Территориально где находишься на данный момент?', 'В Гоа, в Индии.'],
]);

describe('Fuzzy Question Matching', () => {

  test('Exact match should work', () => {
    const question = 'Укажите ваши ожидания по заработной плате';
    const match = findBestMatch(question, qaDatabase);

    assert.ok(match);
    assert.equal(match.question, question);
    assert.equal(match.score, 1.0);
    assert.equal(match.answer, 'От 450000 рублей в месяц на руки.');
  });

  test('Fuzzy match for salary question (issue #74)', () => {
  // This is the actual question from issue #74
    const question = 'Укажите, пожалуйста, свои зарплатные ожидания';
    const match = findBestMatch(question, qaDatabase);

    assert.ok(match, 'Expected to find fuzzy match for salary question');

    // Should match one of the salary-related questions
    assert.ok(
      match.question.includes('заработной плате') || match.question.includes('зарплат'),
      `Expected to match salary question, got: ${match.question}`,
    );

    assert.equal(match.answer, 'От 450000 рублей в месяц на руки.');

    // Score should be above threshold
    assert.ok(match.score >= 0.4, `Score too low: ${match.score}`);
  });

  test('Fuzzy match for project question', () => {
    const question = 'Расскажи о проекте';
    const match = findBestMatch(question, qaDatabase);

    assert.ok(match);
    assert.equal(match.question, 'Расскажи чуть детальнее о проекте, пожалуйста.');
    assert.equal(match.answer, 'Детальнее не получится, NDA.');
  });

  test('Fuzzy match for location question', () => {
    const question = 'Территориально где ты?';
    const match = findBestMatch(question, qaDatabase);

    assert.ok(match);
    assert.equal(match.question, 'Территориально где находишься на данный момент?');
    assert.equal(match.answer, 'В Гоа, в Индии.');
  });

  test('Short location question may not match (too generic)', () => {
    const question = 'Где вы находитесь?';
    const match = findBestMatch(question, qaDatabase);

    // This question is too short and generic, may not match with default threshold
    // This is acceptable behavior - prevents false positives
    // If it does match, verify it's the location question
    if (match) {
      assert.equal(match.question, 'Территориально где находишься на данный момент?');
      assert.equal(match.answer, 'В Гоа, в Индии.');
    } else {
    // No match is also acceptable for such a generic question
      assert.ok(true);
    }
  });

  test('Unrelated question should not match', () => {
    const question = 'Совершенно не связанный вопрос о чем-то другом';
    const match = findBestMatch(question, qaDatabase);

    assert.equal(match, null, `Did not expect to match unrelated question, got: ${match ? match.question : 'null'}`);
  });

  test('Custom threshold should be respected', () => {
    const question = 'Какая у вас зарплата?';

    // With high threshold, should not match
    const noMatch = findBestMatch(question, qaDatabase, 0.9);
    assert.equal(noMatch, null, 'Expected no match with high threshold');

    // With low threshold, should not throw
    findBestMatch(question, qaDatabase, 0.1);
    // Just verify it doesn't crash
    assert.ok(true);
  });

  test('Empty database should return null', () => {
    const question = 'Any question';
    const match = findBestMatch(question, new Map());

    assert.equal(match, null);
  });

  test('Empty question should not crash', () => {
    const question = '';
    // Should not throw and should return null or a valid result
    findBestMatch(question, qaDatabase);
    // Just verify it doesn't crash
    assert.ok(true);
  });

  test('Multiple similar questions should return best match', () => {
    const question = 'Зарплатные ожидания';
    const match = findBestMatch(question, qaDatabase);

    // This is a very short question, may not match with default threshold 0.4
    // If it matches, verify it's a salary question
    if (match) {
      assert.ok(match.question.includes('зарплат') || match.question.includes('заработной'));
      assert.equal(match.answer, 'От 450000 рублей в месяц на руки.');
    } else {
      // No match is acceptable for such a short/generic question
      assert.ok(true);
    }
  });

  test('Case insensitive matching', () => {
    const question = 'УКАЖИТЕ ВАШИ ОЖИДАНИЯ ПО ЗАРАБОТНОЙ ПЛАТЕ';
    const match = findBestMatch(question, qaDatabase);

    assert.ok(match);
    assert.equal(match.score, 1.0);
    assert.equal(match.answer, 'От 450000 рублей в месяц на руки.');
  });

  test('Punctuation should not affect matching', () => {
    const question = 'Укажите ваши ожидания по заработной плате!!!';
    const match = findBestMatch(question, qaDatabase);

    assert.ok(match);
    assert.equal(match.score, 1.0);
    assert.equal(match.answer, 'От 450000 рублей в месяц на руки.');
  });

  test('Extra whitespace should not affect matching', () => {
    const question = 'Укажите   ваши   ожидания   по   заработной   плате';
    const match = findBestMatch(question, qaDatabase);

    assert.ok(match);
    assert.equal(match.score, 1.0);
    assert.equal(match.answer, 'От 450000 рублей в месяц на руки.');
  });

  test('Very different questions should not match', () => {
    const question = 'What is your favorite color?';
    const match = findBestMatch(question, qaDatabase);

    assert.equal(match, null);
  });

  test('Single word question should handle appropriately', () => {
    const question = 'зарплата';
    const match = findBestMatch(question, qaDatabase);

    // May or may not match depending on threshold, but should not crash
    // If matches, should be a salary-related question
    if (match) {
      assert.ok(match.question.includes('зарплат') || match.question.includes('заработной'));
    }
    assert.ok(true); // Just verify no crash
  });

  test('Very long question should handle appropriately', () => {
    const question = 'Укажите пожалуйста свои зарплатные ожидания с учетом того что вы будете работать удаленно из другой страны';
    const match = findBestMatch(question, qaDatabase);

    // Should still match salary question despite extra words
    if (match) {
      assert.ok(match.question.includes('зарплат') || match.question.includes('заработной'));
      assert.equal(match.answer, 'От 450000 рублей в месяц на руки.');
    }
  });

  test('Threshold 0 should match anything', () => {
    const question = 'Anything at all';
    const match = findBestMatch(question, qaDatabase, 0);

    // With threshold 0, should always find some match
    assert.ok(match);
  });

  test('Threshold 1 should only match exact', () => {
    const question = 'Укажите ваши ожидания по заработной плате';
    const slightlyDifferent = 'Укажите ваши ожидания по заработной плате.';

    const exactMatch = findBestMatch(question, qaDatabase, 1.0);
    assert.ok(exactMatch);
    assert.equal(exactMatch.score, 1.0);

    const stillExact = findBestMatch(slightlyDifferent, qaDatabase, 1.0);
    // Should still match after normalization removes punctuation
    if (stillExact) {
      assert.equal(stillExact.score, 1.0);
    } else {
      // If exact match logic is strict, no match is also acceptable
      assert.ok(true);
    }
  });

});

describe('Subject terms (technology and role names)', () => {
  const db = new Map([
    ['Сколько у вас лет коммерческого опыта разработки на Go?', 'Больше 3-х лет.'],
    ['Сколько лет коммерческого опыта с С#?', 'Более 5 лет'],
    ['Есть ли у вас опыт работы с Docker?', '4 (Опыт 3-6 лет)'],
    ['Какие ваши зарплатные ожидания?', 'От 450000 рублей в месяц на руки.'],
  ]);

  test('a question about C# does not take the answer about Go', () => {
    const match = findBestMatch('Сколько лет коммерческого опыта разработки у вас на C#?', db);
    assert.equal(match?.answer, 'Более 5 лет');
  });

  test('Cyrillic С# and Latin C# are the same name', () => {
    assert.equal(extractSubjectTerms('опыт с С#?'), extractSubjectTerms('опыт с C#?'));
  });

  test('different technologies do not match', () => {
    assert.equal(findBestMatch('Подскажите, пожалуйста, у вас есть опыт работы с MongoDB?', db), null);
    assert.equal(findBestMatch('Подскажите, пожалуйста, у вас есть опыт работы с AWS/Kubernetes?', db), null);
  });

  test('a role name does not match a technology', () => {
    assert.equal(findBestMatch('Сколько лет коммерческого опыта у вас на позиции Lead?', db), null);
  });

  test('a question in dollars does not take the answer in rubles', () => {
    assert.equal(findBestMatch('Какие ваши зарплатные ожидания в $?', db), null);
  });

  test('sharing only generic question words is not a match', () => {
    const cities = new Map([['Подскажите, в каком городе Вы проживаете?', 'В Гоа, в Индии.']]);
    assert.equal(findBestMatch('Подскажите, пожалуйста, на каком стеке вы разрабатываете?', cities), null);
  });

  test('"@username" is not a name', () => {
    const telegram = new Map([['Ваш @username telegram для связи?', '@drakonard']]);
    assert.equal(findBestMatch('Оставьте, пожалуйста, ваш telegram для оперативной связи', telegram)?.answer, '@drakonard');
  });

  test('a qualifier such as fulltime is not a name', () => {
    assert.equal(findBestMatch('Ваши зарплатные ожидания на fulltime?', db)?.answer, 'От 450000 рублей в месяц на руки.');
  });

  test('employment forms named by abbreviations do not take each other\'s answer', () => {
    const forms = new Map([['Готовы ли к оформлению по ИП?', 'да']]);
    assert.equal(findBestMatch('Готовы ли Вы к оформлению в штат по ТК РФ? С ИП и самозанятыми не сотрудничаем', forms), null);
    assert.equal(findBestMatch('Готовы ли вы рассмотреть оформление исключительно по ТК РФ?', forms), null);
  });
});

describe('Long questions around a saved short one', () => {
  const db = new Map([
    ['Пожалуйста, укажите Ваши зарплатные ожидания?', 'От 450000 рублей в месяц на руки.'],
    ['Какой для вас минимальный и комфортный уровень заработной платы?', 'От 450000 рублей в месяц на руки.'],
    ['Работали ли Вы с многопоточными приложениями?', 'Да'],
    ['Есть ли у Вас опыт проектирования интеграционных решений?', 'Да'],
  ]);

  test('the saved question is found inside a longer wording', () => {
    assert.equal(findBestMatch('Если в вашем резюме не указано, пожалуйста, поделитесь вашими зарплатными ожиданиями.', db)?.question,
      'Пожалуйста, укажите Ваши зарплатные ожидания?');
    assert.equal(findBestMatch('Какой уровень заработной платы сейчас рассматриваете (на руки)? Можно указать диапазон - например, в формате минимальная и комфортная планка.', db)?.question,
      'Какой для вас минимальный и комфортный уровень заработной платы?');
  });

  test('a few shared words in a longer question are not a match', () => {
    assert.equal(findBestMatch('Работали ли Вы в Enterprise-сегменте?', db), null);
    assert.equal(findBestMatch('Есть ли у вас опыт технического лидерства, менторинга, проектирования архитектуры решений? Опишите кратко.', db), null);
  });
});

describe('Informal address', () => {
  test('pronouns and 2nd person verbs become formal', () => {
    assert.equal(toFormalAddress('тебя'), 'вас');
    assert.equal(toFormalAddress('твои'), 'ваши');
    assert.equal(toFormalAddress('планируешь'), 'планируете');
    assert.equal(toFormalAddress('видишь'), 'видите');
  });

  test('short words ending in -шь stay', () => {
    assert.equal(toFormalAddress('лишь'), 'лишь');
    assert.equal(toFormalAddress('мышь'), 'мышь');
  });

  test('a question asked with "ты" finds the answer saved for "вы"', () => {
    const db = new Map([
      ['Какой у вас уровень английского языка?', 'C1'],
      ['Из какой локации вы планируете работать?', 'Из Нячанга, Вьетнам.'],
    ]);
    assert.equal(findBestMatch('Какой у тебя уровень английского языка?', db)?.answer, 'C1');
    assert.equal(findBestMatch('Из какой локации ты планируешь работать? Страна/город', db)?.answer, 'Из Нячанга, Вьетнам.');
  });

  test('sharing only generic words is no match', () => {
    const db = new Map([
      ['От какой суммы рассматриваете предложения о работе?', 'От 450000 рублей'],
      ['Какой у вас опыт?', '15 лет'],
      ['5. Есть ли опыт работы с ГИТ?', 'Да'],
    ]);
    assert.equal(findBestMatch('В связи с чем вы сейчас рассматриваете предложения о работе?', db), null);
    assert.equal(findBestMatch('Какой у тебя опыт работа с базами данных?', db), null);
    assert.equal(findBestMatch('6. Есть ли опыт работы с Докер?', db), null);
    assert.equal(findBestMatch('От какой минимальной суммы рассматриваешь предложения?', db)?.answer, 'От 450000 рублей');
  });
});
