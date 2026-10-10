/**
 * Tests for the record of skipped vacancies (SEC5): every skip is kept with its reason, title,
 * link and time; final reasons are not opened again, transient ones once more
 */
import { describe, test, assert } from 'test-anywhere';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createSkippedVacancies,
  formatSkippedVacancies,
  isSkippedForGood,
  noteSkip,
  parseEntry,
} from '../src/skipped-vacancies.mjs';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const tempStore = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skipped-vacancies-'));
  return { dir, skipped: createSkippedVacancies(path.join(dir, 'skipped-vacancies.lino'), { now: () => NOW }) };
};

describe('createSkippedVacancies', () => {
  test('keeps the reason, title, employer link and time in a .lino file', async () => {
    const { dir, skipped } = await tempStore();
    await skipped.record('138295841', {
      reason: 'external_site',
      title: 'Go-разработчик | ООО "Ромашка" (Москва)',
      url: 'https://career.example.com/jobs/1?utm=hh',
    });
    const content = await fs.readFile(path.join(dir, 'skipped-vacancies.lino'), 'utf8');
    assert.equal(content, [
      '138295841',
      '  "reason: external_site"',
      '  \'title: Go-разработчик | ООО "Ромашка" (Москва)\'',
      '  "url: https://career.example.com/jobs/1?utm=hh"',
      '  "time: 2026-10-10T12:00:00.000Z"',
      '  "attempts: 1"',
      '',
    ].join('\n'));
    assert.deepEqual((await skipped.read()).get('138295841'), {
      reason: 'external_site',
      title: 'Go-разработчик | ООО "Ромашка" (Москва)',
      url: 'https://career.example.com/jobs/1?utm=hh',
      time: '2026-10-10T12:00:00.000Z',
      attempts: 1,
    });
  });

  test('final reasons are not opened on the next run, a transient one is opened once more', async () => {
    const { skipped } = await tempStore();
    await skipped.record('1', { reason: 'external_site' });
    await skipped.record('2', { reason: 'resume_not_visible', title: 'Backend Engineer' });
    await skipped.record('3', { reason: 'modal_timeout' });
    await skipped.record('4', { reason: 'questions_deferred' });
    assert.deepEqual([...await skipped.skippedVacancyIds()].sort(), ['1', '2']);

    // Skipped a second time, the transient one is final too, and keeps the title known before
    await skipped.record('2', { reason: 'resume_not_visible' });
    await skipped.record('3', { reason: 'modal_timeout' });
    assert.deepEqual([...await skipped.skippedVacancyIds()].sort(), ['1', '2', '3']);
    const entries = await skipped.read();
    assert.equal(entries.get('2').title, 'Backend Engineer');
    assert.equal(entries.get('3').attempts, 2);
  });

  test('questionnaire skips count only with --ignore-vacancies-with-questionnaire', async () => {
    const { skipped } = await tempStore();
    await skipped.record('5', { reason: 'questionnaire_ignored' });
    assert.equal((await skipped.skippedVacancyIds()).size, 0);
    assert.deepEqual([...await skipped.skippedVacancyIds({ ignoreQuestionnaires: true })], ['5']);
  });

  test('an applied vacancy is forgotten; --clear opens a reason or a vacancy again', async () => {
    const { skipped } = await tempStore();
    await skipped.record('1', { reason: 'resume_not_visible' });
    await skipped.record('2', { reason: 'resume_not_visible' });
    await skipped.record('3', { reason: 'external_site' });
    await skipped.forget('3');
    assert.equal(await skipped.clear('resume_not_visible'), 2);
    assert.equal((await skipped.read()).size, 0);
    await skipped.record('4', { reason: 'external_site' });
    assert.equal(await skipped.clear('4'), 1);
  });

  test('a skip without a vacancy ID is not recorded', async () => {
    const { skipped } = await tempStore();
    assert.equal(await skipped.record(null, { reason: 'modal_timeout' }), null);
    assert.equal((await skipped.read()).size, 0);
  });

  test('the IDs of the former ignored-vacancy-ids.txt move into the store', async () => {
    const { dir, skipped } = await tempStore();
    const txtPath = path.join(dir, 'ignored-vacancy-ids.txt');
    await fs.writeFile(txtPath, '137000001\n137000002\n\n');
    assert.equal(await skipped.importIgnoredVacancyIds(txtPath), 2);
    assert.equal(await fs.access(txtPath).then(() => true, () => false), false);
    assert.deepEqual([...await skipped.skippedVacancyIds({ ignoreQuestionnaires: true })], ['137000001', '137000002']);
    assert.equal((await skipped.read()).get('137000001').reason, 'questionnaire_ignored');
    assert.equal(await skipped.importIgnoredVacancyIds(txtPath), 0);
  });
});

describe('isSkippedForGood', () => {
  test('an unknown reason is opened once more', () => {
    assert.equal(isSkippedForGood(parseEntry('reason: something_new')), false);
    assert.equal(isSkippedForGood(parseEntry(['reason: something_new', 'attempts: 2'])), true);
  });
});

describe('noteSkip', () => {
  test('logs and records; without a store it only logs', async () => {
    const { skipped } = await tempStore();
    await noteSkip(skipped, '138000001', { reason: 'button_disabled', title: 'Go Developer' });
    assert.equal((await skipped.read()).get('138000001').reason, 'button_disabled');
    await noteSkip(null, '138000002', { reason: 'button_disabled' });
  });
});

describe('formatSkippedVacancies', () => {
  test('lists external-site vacancies with the prefill command', async () => {
    const { skipped } = await tempStore();
    await skipped.record('1', { reason: 'external_site', title: 'Go Developer | Acme', url: 'https://acme.example/apply' });
    await skipped.record('2', { reason: 'external_site', url: 'https://hh.ru/vacancy/2' });
    await skipped.record('3', { reason: 'modal_timeout' });
    const text = formatSkippedVacancies(await skipped.read());
    assert.match(text, /external_site: .*\(2\)/);
    assert.match(text, /1 Go Developer \| Acme/);
    assert.match(text, /bun run prefill-form -- https:\/\/acme\.example\/apply/);
    // An hh.ru link is no employer form to prefill
    assert.equal(text.includes('prefill-form -- https://hh.ru'), false);
    assert.match(text, /modal_timeout: .*\n.*3 — 2026-10-10T12:00:00\.000Z \(opened again on the next run\)/);
  });
});
