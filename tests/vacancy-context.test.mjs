import { describe, test, assert } from 'test-anywhere';
import { isPayQuestion, parseVacancyPage, payGuidance, statesPay } from '../src/vacancy-context.mjs';

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
    assert.ok(text.includes('верхняя граница') && text.includes('Ответ короткий'));
    assert.ok(!text.includes('Описание анкеты'));
  });

  test('a pay the form states is preferred over the vacancy pay', () => {
    const intro = 'Занятие идет 45 минут 10 минут перерыв и еще 45 минут = 1 час 30 минут.\nСтоимость за Занятие 3000р. на руки';
    assert.ok(statesPay(intro));
    assert.ok(!statesPay('Анкета для преподавателей: ИИ и Python'));
    const text = payGuidance({ vacancy: { salary: 'от 80 000 ₽ за месяц' }, profile: { salary: 'от 450 000 ₽ в месяц', rate: '2 700 ₽ в час' }, intro });
    assert.ok(text.includes('Описание анкеты (выше) называет свою оплату') && text.includes('за занятие 1,5 часа'));
  });
});
