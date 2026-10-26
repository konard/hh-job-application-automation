/**
 * Salary questions answered by pattern: what the question asks (net or gross) and the answer
 * shape, both learned from the saved questions and answers
 */
import { describe, test, assert } from 'test-anywhere';
import { answerShape, inferSalaryAnswer, learnSalaryPatterns, salaryClarificationQuestion, salaryQuestion } from '../src/salary-questions.mjs';
import { answersInContexts, loadAnswerContexts, plainSalaryAnswer } from '../src/answer-contexts.mjs';
import { withContacts } from '../src/contacts.mjs';
import { savedAnswersInContext } from '../src/vacancy-response.mjs';

const saved = new Map([
  ['Какие у вас зарплатные ожидания?', 'От {{salary_net}} в месяц на руки.'],
  ['Ваши ожидания по зарплате?', 'От {{salary_net}} ежемесячно на руки'],
  ['Укажите желаемый уровень дохода', 'От {{salary_net}} в месяц на руки.'],
  ['Ожидания по зарплате в долларах?', 'От {{salary_net_usd}} в месяц на руки.'],
  ['Зарплатные ожидания gross?', 'От {{salary_gross}} в месяц до вычета {{salary_tax}} ({{salary_net}} на руки).'],
  ['Укажите ваши ожидания по зп gross', 'От {{salary_gross}} в месяц до вычета {{salary_tax}} ({{salary_net}} на руки).'],
  ['Ожидания по оплате gross', 'От {{salary_gross}}.'],
  ['Your salary expectations?', 'From {{salary_net_usd}} net per month.'],
  ['Сколько вы получали на прошлом месте?', 'Не готов раскрывать.'],
  ['Ожидания по зарплате (и почему так)?', 'От {{salary_net}}, так как это рынок.'],
  ['Есть ли опыт с Go?', 'Да'],
]);
const patterns = learnSalaryPatterns(saved);

describe('Salary questions by pattern', () => {
  test('the shape of a saved answer, its currency left out', () => {
    assert.deepEqual(answerShape('От {{salary_net_usd}} в месяц на руки'), {
      shape: 'net', template: 'От {{salary_net}} в месяц на руки.', plain: true, detail: 3,
    });
    assert.equal(answerShape('От {{salary_net}}, так как это рынок.').plain, false);
    assert.equal(answerShape('Да'), null);
  });

  test('the answers that say the most, each kept as saved', () => {
    assert.deepEqual(patterns.variants['net:ru'], ['От {{salary_net}} в месяц на руки.', 'От {{salary_net}} ежемесячно на руки.']);
    assert.deepEqual(patterns.variants['gross:ru'], ['От {{salary_gross}} в месяц до вычета {{salary_tax}} ({{salary_net}} на руки).']);
    assert.deepEqual(patterns.variants['net:en'], ['From {{salary_net}} net per month.']);
  });

  test('the wording weighed by its words, not by its placeholders\' names', () => {
    // «{{salary_net}}» is not «net»: «в месяц» alone says less than «в месяц на руки»
    assert.equal(answerShape('От {{salary_net}} в месяц.').detail, 2);
    assert.equal(answerShape('От {{salary_net}} в месяц на руки.').detail, 3);
  });

  test('a plain salary answer typed before may give way to another wording', () => {
    assert.equal(plainSalaryAnswer('От 450 000 ₽ в месяц.'), true);
    assert.equal(plainSalaryAnswer('От 530 000 ₽ в месяц до вычета НДФЛ (450 000 ₽ на руки).'), true);
    assert.equal(plainSalaryAnswer('От 450 000 ₽, обсуждаемо.'), false);
    assert.equal(plainSalaryAnswer('Да.'), false);
  });

  test('net or gross, in Russian or English', () => {
    assert.deepEqual(salaryQuestion('Укажите ваши минимальные финансовые ожидания в месяц (Gross, EUR)?', patterns), { shape: 'gross', language: 'ru' });
    assert.deepEqual(salaryQuestion('От какой суммы рассматриваете предложения?', patterns), { shape: 'net', language: 'ru' });
    assert.deepEqual(salaryQuestion('Ожидаемый уровень дохода до вычета налогов?', patterns), { shape: 'gross', language: 'ru' });
    assert.deepEqual(salaryQuestion('What are your salary expectations (net)?', patterns), { shape: 'net', language: 'en' });
  });

  test('salary clarifications inherit a recent salary topic and tax basis, independently of currency and language', () => {
    const previous = 'Константин, спасибо за отклик! Подскажи свои зарплатные ожидания в долларах?';
    const followup = 'Константин подскажи пожалуйста цифры в долларах и до вычета налогов, спасибо!';
    assert.deepEqual(salaryQuestion(salaryClarificationQuestion(followup, [followup, previous])), { shape: 'gross', language: 'ru' });
    assert.deepEqual(salaryQuestion(salaryClarificationQuestion('USD gross?', [previous])), { shape: 'gross', language: 'ru' });
    assert.deepEqual(salaryQuestion(salaryClarificationQuestion('А в рублях?', ['Укажите зарплатные ожидания до вычета налогов'])), { shape: 'gross', language: 'ru' });
    assert.deepEqual(salaryQuestion(salaryClarificationQuestion('Please provide the figures in USD before taxes.', ['What are your salary expectations?'])), { shape: 'gross', language: 'en' });
  });

  test('a clarification cannot reuse an old salary topic across an unrelated question or change the pay period', () => {
    const previous = 'Ваши зарплатные ожидания?';
    for (const [text, known] of [
      ['Какие цифры в долларах до вычета налогов?', []],
      ['А в долларах?', ['Какой ваш опыт с PostgreSQL?', previous]],
      ['А в долларах в час?', [previous]],
      ['А какая выручка в долларах?', [previous]],
      ['Подскажите как рассчитываете налоги в долларах?', [previous]],
    ]) assert.equal(salaryClarificationQuestion(text, known), null, text);
  });

  test('fallback wording uses Russian for a Russian question even when only English examples exist', () => {
    const onlyEnglish = learnSalaryPatterns(new Map([['Your salary expectations?', 'From {{salary_net}} net per month.']]));
    assert.equal(inferSalaryAnswer('Ваши зарплатные ожидания в долларах до вычета налогов?', onlyEnglish),
      'От {{salary_gross}} в месяц до вычета {{salary_tax}}.');
    assert.equal(inferSalaryAnswer('Ваши зарплатные ожидания?', onlyEnglish), 'От {{salary_net}} в месяц на руки.');
  });

  test('not the expected pay a month: left to the saved answers', () => {
    for (const question of [
      'Какая зарплата была на прошлом месте работы?',
      'Вилка до 210к на руки вас устраивает?',
      'Входит ли вилка до 210к на руки в ваши зарплатные ожидания?',
      'Ваши ожидания по годовому доходу?',
      'Как вы относитесь к зарплатной карте Альфа-банка?',
      'В каких подсистемах 1С работали? (продажи, склад, зарплата)',
      'Есть ли опыт с Go?',
    ]) {
      assert.equal(salaryQuestion(question, patterns), null, question);
    }
  });

  test('the same question, the same answer; others may take another saved wording', () => {
    const question = 'Какие ваши ожидания по зарплате на руки?';
    assert.equal(inferSalaryAnswer(question, patterns), inferSalaryAnswer(question, patterns));
    const answers = new Set(['Зарплата?', 'Ожидаемая зарплата?', 'Зарплатные ожидания на руки?', 'Ваша желаемая зарплата?', 'Ожидания по з/п?']
      .map((item) => inferSalaryAnswer(item, patterns)));
    assert.deepEqual([...answers].every((answer) => patterns.variants['net:ru'].includes(answer)), true);
    assert.equal(answers.size, 2);
    assert.equal(inferSalaryAnswer('Зарплатные ожидания (Gross)?', patterns), patterns.variants['gross:ru'][0]);
  });

  test('a question in English is answered in English, never with a Russian answer', () => {
    const question = 'What are your salary expectations for this position (USD/monthly and indicate Gross or Net.)?';
    assert.equal(inferSalaryAnswer(question, patterns), 'From {{salary_gross}} gross per month ({{salary_net}} net).');
    assert.equal(inferSalaryAnswer('What are your salary expectations (net)?', patterns), 'From {{salary_net}} net per month.');
    // An English question saved with a Russian answer is not an English answer
    const mixed = learnSalaryPatterns(new Map([...saved, ['Salary expectations gross?', 'От {{salary_gross}} в месяц до вычета {{salary_tax}} ({{salary_net}} на руки).']]));
    assert.equal(mixed.variants['gross:en'], undefined);
    assert.equal(inferSalaryAnswer(question, mixed), 'From {{salary_gross}} gross per month ({{salary_net}} net).');
  });

  test('in the currency of the question or the vacancy', async () => {
    const values = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_usd: '$6 000', salary_gross_usd: '$7 100',
      salary_net_usdt: '6 000 USDT', salary_gross_usdt: '7 100 USDT', salary_net_eur: '5 500 €', salary_gross_eur: '6 500 €', salary_tax: 'НДФЛ' };
    const qa = withContacts({ readQADatabase: async () => new Map(saved) }, values);
    const inContexts = answersInContexts(qa.readQADatabase, await loadAnswerContexts());
    const eur = 'Укажите ваши минимальные финансовые ожидания в месяц (Gross, EUR)?';
    assert.equal((await inContexts(eur, '')).get(eur), 'От 6 500 € в месяц до вычета налогов (5 500 € на руки).');
    const rub = 'Ожидаемый уровень дохода до вычета налогов?';
    assert.equal((await inContexts(rub, 'от 300 000 ₽')).get(rub), 'От 530 000 ₽ в месяц до вычета НДФЛ (450 000 ₽ на руки).');
    const usdt = 'Напишите, пожалуйста, какие у вас зарплатные пожелания?';
    assert.match((await inContexts(usdt, 'Lead Blockchain Engineer / Architect')).get(usdt), /^От 6 000 USDT /);
    assert.match((await inContexts(usdt, 'Python, криптография')).get(usdt), /^От 450 000 ₽ /);
    const usd = 'From what salary do you consider offers?';
    assert.equal((await inContexts(usd, 'Paid in USD')).get(usd), 'From $6 000 net per month.');
    // A question saved word for word keeps its own answer
    assert.equal((await inContexts('Ожидания по оплате gross', '')).get('Ожидания по оплате gross'), 'От 530 000 ₽.');
    assert.equal((await inContexts('Есть ли опыт с Rust?', '')).has('Есть ли опыт с Rust?'), false);
  });

  test('counts as saved for sending the form only when the currency is told', async () => {
    const values = { salary_net: '450 000 ₽', salary_gross: '530 000 ₽', salary_net_eur: '5 500 €', salary_gross_eur: '6 500 €', salary_tax: 'НДФЛ' };
    const qa = withContacts({ readQADatabase: async () => new Map(saved) }, values);
    const form = (question) => ({ evaluate: async () => [{ question, type: 'textarea', selector: 'textarea', currentValue: '' }] });
    const eur = 'Ваши финансовые ожидания в месяц (Gross, EUR)?';
    assert.equal((await savedAnswersInContext({ commander: form(eur), readQADatabase: qa.readQADatabase })).get(eur),
      'От 6 500 € в месяц до вычета налогов (5 500 € на руки).');
    const plain = 'Ваши финансовые ожидания?';
    assert.equal((await savedAnswersInContext({ commander: form(plain), readQADatabase: qa.readQADatabase })).has(plain), false);
    assert.equal((await savedAnswersInContext({ commander: form(plain), readQADatabase: qa.readQADatabase, context: 'от 300 000 ₽ на руки' })).has(plain), true);
  });
});
