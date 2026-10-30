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
  test('a salary question can name dollars without a numeric amount', () => {
    for (const question of ['Ожидаемый уровень компенсации в $ или русских рублях, на руки',
      'Какую зарплату в $ вы рассматриваете?', 'Your expected compensation ($)?', 'Hourly rate in $/hour?']) {
      assert.equal(applicationResumeLanguage({ questions: ['Сколько лет у вас опыта?', question],
        vacancy: { description: 'Приглашаем разработчика в международную команду.' } }), 'en');
    }
  });
  test('salary wording must not turn shell variables or substitutions into dollar pay', () => {
    for (const question of ['Как найти $HOME в shell? Какую зарплату в рублях вы ожидаете?',
      'Расскажите про ${PATH} и $(pwd). Зарплата в рублях.', 'Как экранировать символ $?']) {
      assert.equal(applicationResumeLanguage({ questions: [question] }), 'ru');
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
  test('the collected description outweighs localized UI text and an ambiguous job title', () => {
    assert.equal(applicationResumeLanguage({ context: ['Разработчик, Москва. Отклик на вакансию. Сопроводительное письмо.'],
      vacancy: { title: 'Разработчик', description: 'We are looking for a backend engineer to develop our platform and work with international customers.' } }), 'en');
    assert.equal(applicationResumeLanguage({ context: ['Senior Software Engineer. Vacancy response. Covering letter. Send application.'],
      vacancy: { title: 'Senior Software Engineer', description: 'Ищем разработчика для развития продукта и поддержки наших сервисов.' } }), 'ru');
    assert.equal(applicationResumeLanguage({ questions: ['Какой у вас опыт работы?'],
      vacancy: { salary: '$6,000 monthly', description: 'Ищем разработчика.' } }), 'en');
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
