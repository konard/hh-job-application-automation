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
    assert.deepEqual(await filters.rules(), { vacancy: ['схемотехник'], question: ['дифавтомат', 'кв.мм'], page: [] });

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
});
