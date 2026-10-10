/**
 * Tests for the vacancy filters: rule matching and the record of filtered vacancies
 */

import { describe, test, assert } from 'test-anywhere';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createVacancyFilters, describeFilterMatch, findFilterMatch } from '../src/vacancy-filters.mjs';

const rules = {
  vacancy: ['схемотехник'],
  question: ['дифавтомат', 'кв.мм'],
  page: ['поменяйте видимость резюме'],
};

describe('findFilterMatch', () => {
  test('a vacancy card with a filtered title', () => {
    const match = findFilterMatch(rules, { vacancy: 'Сейчас смотрят 7 человек\nИнженер-Схемотехник\nМожно удалённо' });
    assert.equal(match?.kind, 'vacancy');
    assert.equal(match?.pattern, 'схемотехник');
  });

  test('a question containing a pattern, whatever the case and spacing', () => {
    const match = findFilterMatch(rules, { questions: ['Опыт с Go?', 'Зачем нужен  ДИФАВТОМАТ?'] });
    assert.deepEqual(match, { kind: 'question', pattern: 'дифавтомат', text: 'Зачем нужен  ДИФАВТОМАТ?' });
  });

  test('ё and е are the same letter', () => {
    assert.equal(findFilterMatch({ vacancy: ['ёлка'] }, { vacancy: 'Елка' })?.pattern, 'ёлка');
  });

  test('page text', () => {
    const match = findFilterMatch(rules, { page: 'Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно всем»' });
    assert.equal(match?.kind, 'page');
    assert.equal(describeFilterMatch(match), 'page "поменяйте видимость резюме"');
  });

  test('a programming vacancy passes', () => {
    assert.equal(findFilterMatch(rules, { vacancy: 'Embedded Linux Engineer', questions: ['Опыт с Yocto?'], page: 'Откликнуться' }), null);
  });

  test('a pattern only applies to its own kind', () => {
    assert.equal(findFilterMatch(rules, { page: 'Инженер-схемотехник' }), null);
  });
});

describe('createVacancyFilters', () => {
  const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'vacancy-filters-'));

  test('reads the rules and keeps filtered vacancies with their rule', async () => {
    const dir = await tempDir();
    const rulesPath = path.join(dir, 'vacancy-filters.lino');
    await fs.writeFile(rulesPath, 'vacancy\n  схемотехник\nquestion\n  дифавтомат\n  кв.мм\n');
    const filters = createVacancyFilters({ rulesPath, filteredPath: path.join(dir, 'filtered-vacancies.lino') });
    assert.deepEqual(await filters.rules(), {
      vacancy: ['схемотехник'], question: ['дифавтомат', 'кв.мм'], page: [], 'on-site': [], programming: [], remote: [],
    });

    const match = await filters.match({ questions: ['Можно ли автомат на кабель 1,5 кв.мм?'] });
    await filters.remember('138295841', match);
    assert.deepEqual([...await filters.filteredVacancyIds()], ['138295841']);
    assert.match(await fs.readFile(path.join(dir, 'filtered-vacancies.lino'), 'utf8'), /138295841\n {2}"question: кв\.мм"/);
  });

  test('no rules file means nothing is filtered', async () => {
    const dir = await tempDir();
    const filters = createVacancyFilters({ rulesPath: path.join(dir, 'none.lino'), filteredPath: path.join(dir, 'f.lino') });
    assert.equal(await filters.match({ vacancy: 'Инженер-схемотехник' }), null);
    assert.equal((await filters.filteredVacancyIds()).size, 0);
  });

  test('remember keeps the title and the time with the rule', async () => {
    const dir = await tempDir();
    const filteredPath = path.join(dir, 'filtered-vacancies.lino');
    const filters = createVacancyFilters({
      rulesPath: path.join(dir, 'none.lino'),
      filteredPath,
      now: () => new Date('2026-10-10T12:00:00.000Z'),
    });
    await filters.remember('138295842', { kind: 'on-site', pattern: 'разъездной', text: '...' }, { title: 'Сервисный инженер | ТехноСервис' });
    assert.equal(await fs.readFile(filteredPath, 'utf8'),
      '138295842\n  "on-site: разъездной"\n  "title: Сервисный инженер | ТехноСервис"\n  "time: 2026-10-10T12:00:00.000Z"\n');
    assert.deepEqual([...await filters.filteredVacancyIds()], ['138295842']);
  });
});

describe('on-site vacancies that are not programming (FLT5), with the rules of data/vacancy-filters.lino', () => {
  const filters = createVacancyFilters({
    rulesPath: path.join(import.meta.dir, '..', 'data', 'vacancy-filters.lino'),
    filteredPath: path.join(os.tmpdir(), 'unused-filtered-vacancies.lino'),
  });

  const goOffice = {
    vacancy: 'Go-разработчик (Middle+)\nOzon\nМосква, Пресненская набережная\nОпыт 3–6 лет\nОткликнуться',
    description: 'Golang-разработчик\nФормат работы: на месте работодателя\nПолная занятость\n' +
      'Разрабатываем WMS для наших складов: приёмка, работа на складе, курьерская доставка. ' +
      'Иногда выезды на объекты складской логистики, чтобы посмотреть на процессы. ' +
      'Офис в Москва-Сити, спецодежда для визитов на склад выдаётся.',
  };

  test('a Moscow office Go developer passes, whatever the description says about warehouses', async () => {
    assert.equal(await filters.match(goOffice), null);
    // The card alone settles it: no request for the description
    assert.equal(await filters.needsDescription(goOffice.vacancy), false);
  });

  test('an office Backend Engineer with an English title passes', async () => {
    const card = 'Senior Backend Engineer (Go)\nAvito\nМосква\nГибрид';
    assert.equal(await filters.needsDescription(card), false);
    assert.equal(await filters.match({ vacancy: card, description: 'Работа в офисе на Курской 3 дня в неделю' }), null);
  });

  test('installation work with field trips is filtered', async () => {
    const card = 'Монтажник слаботочных систем\nООО СтройСвязьМонтаж\nМосква\nОпыт 1–3 года';
    const match = await filters.match({
      vacancy: card,
      description: 'Монтаж СКС, видеонаблюдения и СКУД. Выезды на объекты по Москве и области. Спецодежда.',
    });
    assert.equal(match?.kind, 'on-site');
    // Its title already says it, so the description was not needed
    assert.equal(match?.pattern, 'монтажник');
    assert.equal(await filters.needsDescription(card), false);
  });

  test('a vague title is decided by the description, which is read for it', async () => {
    const card = 'Сервисный инженер\nТехноСервис\nКазань\nОпыт 1–3 года';
    assert.equal(await filters.needsDescription(card), true);
    assert.equal(await filters.match({ vacancy: card }), null);
    const match = await filters.match({
      vacancy: card,
      description: 'Ремонт и обслуживание оборудования. Разъездной характер работы, служебный автомобиль.',
    });
    assert.equal(match?.kind, 'on-site');
    assert.equal(match?.pattern, 'разъездной');
    assert.match(describeFilterMatch(match), /^on-site "разъездной": .*Разъездной характер/);
  });

  test('warehouse and production work are filtered', async () => {
    assert.equal((await filters.match({
      vacancy: 'Оператор склада\nLamoda\nПодольск',
      description: 'Работа на складе, сменный график 2/2, бесплатное питание.',
    }))?.pattern, 'работа на складе');
    assert.equal((await filters.match({
      vacancy: 'Специалист ОТК\nЗавод Прогресс',
      description: 'Работа на производстве, контроль качества продукции, спецодежда.',
    }))?.kind, 'on-site');
  });

  test('programming with on-site commissioning passes', async () => {
    assert.equal(await filters.match({
      vacancy: 'Инженер-программист АСУ ТП',
      description: 'Программирование ПЛК, пусконаладочные работы на объектах заказчика, командировки.',
    }), null);
  });

  test('a remote job is not physical presence only', async () => {
    const card = 'Специалист технической поддержки\nМожно удалённо\nКонтур';
    assert.equal(await filters.needsDescription(card), false);
    assert.equal(await filters.match({ vacancy: card, description: 'Иногда выезд на объект клиента.' }), null);
  });

  test('an on-site question of the form filters a vacancy that is not programming', async () => {
    assert.equal((await filters.match({
      vacancy: 'Инженер по эксплуатации',
      questions: ['Готовы ли вы к работе вахтовым методом?'],
    }))?.pattern, 'вахтовым методом');
  });

  test('the form page is no guard: it shows the user\'s own resume title', async () => {
    const match = await filters.match({
      vacancy: 'Кладовщик\nСклад-Сервис',
      page: 'Резюме: Go developer\nСопроводительное письмо',
    });
    assert.equal(match?.pattern, 'кладовщик');
  });

  test('a description read on the list is kept for the response form of the vacancy', () => {
    filters.keepDescription('138000001', 'Разъездной характер работы');
    assert.equal(filters.description('138000001'), 'Разъездной характер работы');
    assert.equal(filters.description('138000002'), '');
  });
});
