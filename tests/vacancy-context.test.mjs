import { describe, test, assert } from 'test-anywhere';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchVacancy, isPayQuestion, parseVacancyPage, payGuidance, statesPay } from '../src/vacancy-context.mjs';
import { createVacancyCache } from '../src/vacancy-cache.mjs';

describe('vacancy context for pay answers', () => {
  test('chat/form context reuses the complete collected vacancy without a network request', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vacancy-context-'));
    try {
      const vacancy = { id: '123', url: 'https://hh.ru/vacancy/123', title: 'Developer', salary: '6000 USD',
        description: 'Build services with Go, PostgreSQL and Kubernetes.', skills: ['Go', 'Kubernetes'], descriptionHtml: '<p>Full text.</p>' };
      await createVacancyCache(directory).record(vacancy);
      const cached = await fetchVacancy('https://hh.ru/vacancy/123?from=chat', {
        cache: createVacancyCache(directory), fetchPage: async () => assert.fail('Cached description must be available offline') });
      for (const key of Object.keys(vacancy)) assert.deepEqual(cached[key], vacancy[key]);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

  test('a cache miss falls back to the public page and another site cannot reuse an HH vacancy ID', async () => {
    const requested = [];
    const options = { cache: { read: async (id) => id === '123' ? { id, description: 'HH-only text' } : null },
      fetchPage: async (url) => { requested.push(url); return { ok: true,
        text: async () => '<h1 data-qa="vacancy-title">Public developer role</h1><div data-qa="vacancy-description">Full public description</div></div>' }; } };
    assert.equal((await fetchVacancy('https://hh.ru/vacancy/456', options)).description, 'Full public description');
    assert.equal((await fetchVacancy('https://example.com/vacancy/123', options)).description, 'Full public description');
    assert.deepEqual(requested, ['https://hh.ru/vacancy/456', 'https://example.com/vacancy/123']);
  });
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
