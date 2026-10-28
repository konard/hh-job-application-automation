import { describe, test, assert } from 'test-anywhere';
import { applicationResumeLanguage, chooseApplicationResume } from '../src/application-resume.mjs';

describe('per-application CV language', () => {
  test('English employer questions select English even with a Russian vacancy', () => {
    assert.equal(applicationResumeLanguage({ questions: ['What is your expected monthly salary before taxes?'],
      context: ['Разработчик Python, зарплата 450 000 рублей.'] }), 'en');
  });
  test('dollar salary and salary questions select English independently of their language', () => {
    for (const text of ['$6,000 per month', '6000 USD', '6000 USDT', '6000 USDC', '6000 $', 'Зарплата в долларах']) {
      assert.equal(applicationResumeLanguage({ context: [text], questions: ['Сколько лет вы работаете с Docker?'] }), 'en');
    }
  });
  test('Russian questions outweigh an English job title; shell variables do not mean dollar pay', () => {
    assert.equal(applicationResumeLanguage({ questions: ['Какой у вас опыт разработки?'], context: ['Senior Software Engineer'] }), 'ru');
    assert.equal(applicationResumeLanguage({ context: ['Команды shell: $HOME, ${PATH}'] }), 'ru');
    assert.equal(applicationResumeLanguage({ context: ['Go / C++'] }), null);
    assert.equal(applicationResumeLanguage(), null);
  });
  test('English vacancy text selects English without a questionnaire', () => {
    assert.equal(applicationResumeLanguage({ context: ['We are looking for a senior backend engineer to develop our platform.'] }), 'en');
  });
  test('CV language comes from the export rather than the job title or option position', () => {
    const options = [{ hash: 'ru1', title: 'Senior Developer', checked: true },
      { hash: 'en1', title: 'Senior Developer', checked: false }];
    const resumes = [{ hash: 'ru1', language: 'ru' }, { hash: 'en1', language: 'en' }];
    assert.equal(chooseApplicationResume(options, resumes, 'en').hash, 'en1');
    assert.equal(chooseApplicationResume(options, [resumes[0]], 'en'), null);
    assert.equal(chooseApplicationResume([options[0]], resumes, 'en'), null);
  });
  test('preserve an already selected CV of the desired language', () => {
    const options = [{ hash: 'en1', checked: true }, { hash: 'en2', checked: false }];
    const resumes = [{ hash: 'en1', language: 'en', updatedAt: 1 }, { hash: 'en2', language: 'en', updatedAt: 2 }];
    assert.equal(chooseApplicationResume(options, resumes, 'en').hash, 'en1');
    assert.equal(chooseApplicationResume(options.map((o) => ({ ...o, checked: false })), resumes, 'en').hash, 'en2');
  });
});
