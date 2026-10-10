import { describe, test, assert } from 'test-anywhere';
import { isPayQuestion, parseVacancyPage, payGuidance } from '../src/vacancy-context.mjs';

describe('vacancy context for pay answers', () => {
  test('pay questions are recognized', () => {
    assert.ok(isPayQuestion('За какую минимальную оплату в час (60 минут) готовы работать?'));
    assert.ok(isPayQuestion('Ваши зарплатные ожидания?'));
    assert.ok(isPayQuestion('Expected salary'));
    assert.ok(!isPayQuestion('Ваш город и сколько от мск'));
  });

  test('the public vacancy page gives its title, pay and description', () => {
    const html = '<h1 data-qa="vacancy-title">Преподаватель</h1><div data-qa="vacancy-salary">от&nbsp;80&nbsp;000&nbsp;₽ за месяц, на руки</div><div data-qa="vacancy-description"><p>Онлайн-занятия</p><ul><li>ГПХ</li></ul></div></div>';
    assert.deepEqual(parseVacancyPage(html), { title: 'Преподаватель', salary: 'от 80 000 ₽ за месяц, на руки', description: 'Онлайн-занятия\nГПХ' });
  });

  test('the draft is told the target, the comfortable rate and the vacancy pay', () => {
    const text = payGuidance({ vacancy: { salary: 'от 80 000 ₽ за месяц' }, profile: { salary: 'от 450 000 ₽ в месяц', rate: '2 700 ₽ в час' } });
    assert.ok(text.includes('от 450 000 ₽ в месяц') && text.includes('2 700 ₽ в час') && text.includes('от 80 000 ₽ за месяц'));
    assert.ok(text.includes('верхнюю границу вилки вакансии'));
  });
});
