import { describe, test, assert } from 'test-anywhere';
import { coverLetterFor, englishLetterFile, isClearlyEnglish } from '../src/cover-letter.mjs';

describe('cover letter language', () => {
  const message = { ru: 'Здравствуйте', en: 'Hello' };

  test('English questions take the English letter', () => {
    assert.equal(coverLetterFor(message, ['What is the minimum net salary you would consider?', 'What is your spoken English level?']), 'Hello');
  });

  test('Russian or mixed questions, or none, keep the Russian letter', () => {
    assert.equal(coverLetterFor(message, ['Какой у вас опыт работы с Go?']), 'Здравствуйте');
    assert.equal(coverLetterFor(message, ['Опыт с Kubernetes и Docker?', 'English level?']), 'Здравствуйте');
    assert.equal(coverLetterFor(message, []), 'Здравствуйте');
    assert.equal(coverLetterFor({ ru: 'Здравствуйте' }, ['What is your spoken English level?']), 'Здравствуйте');
    assert.equal(coverLetterFor('Здравствуйте', ['What is your spoken English level?']), 'Здравствуйте');
  });

  test('the English letter sits next to the chosen one', () => {
    assert.equal(englishLetterFile('data/cover-letter.txt'), 'data/cover-letter.en.txt');
    assert.ok(!isClearlyEnglish(['Go']));
  });
});
