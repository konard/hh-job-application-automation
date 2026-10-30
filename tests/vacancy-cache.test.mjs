import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVacancyCache, DEFAULT_VACANCY_CACHE_DIR, migrateVacancyCache } from '../src/vacancy-cache.mjs';

describe('local app vacancy archive', () => {
  test('the default is the app folder outside the repository', () => {
    expect(DEFAULT_VACANCY_CACHE_DIR).toBe(path.join(os.homedir(), '.hh-automation', 'vacancies'));
    expect(DEFAULT_VACANCY_CACHE_DIR.startsWith(process.cwd() + path.sep)).toBe(false);
  });

  test('migration preserves complete records and originals without overwriting newer app data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vacancy-migration-'));
    try {
      const from = path.join(root, 'legacy'), to = path.join(root, 'app');
      const legacy = createVacancyCache(from), app = createVacancyCache(to);
      await legacy.record({ id: '123', title: 'Old title', description: 'Old version.' });
      const description = 'Requirements\nGo, PostgreSQL\n"Quotes", apostrophe\'s, colon: value.\n'.repeat(100);
      await legacy.record({ id: '456', title: 'Archived speech role', url: 'https://hh.ru/vacancy/456', company: 'Example',
        description, descriptionHtml: '<p>Original HTML</p>', skills: ['Whisper', 'Go'], status: 'applied', appliedAt: '2026-10-30T01:00:00Z' });
      await app.record({ id: '123', title: 'Current app title', description: 'Keep this version.' });
      const bytes = await fs.readFile(path.join(from, '456.lino'), 'utf8');
      await fs.writeFile(path.join(from, '789.lino'), 'id\n  999\n');
      const results = await Promise.all([migrateVacancyCache({ from, to }), migrateVacancyCache({ from, to })]);
      expect(results.reduce((sum, result) => sum + result.imported, 0)).toBe(1);
      expect(results[0].invalid).toContain('789.lino');
      expect((await app.read('123')).title).toBe('Current app title');
      expect((await app.read('456')).description).toBe(description);
      expect(await fs.readFile(path.join(to, '456.lino'), 'utf8')).toBe(bytes);
      expect(await fs.readFile(path.join(from, '456.lino'), 'utf8')).toBe(bytes);
      expect((await fs.stat(path.join(to, '456.lino'))).mode & 0o777).toBe(0o600);
      expect(await app.read('789')).toBe(null);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  test('lazy reads import existing local records and a missing legacy directory needs no new folder', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vacancy-lazy-import-'));
    try {
      const from = path.join(root, 'legacy'), to = path.join(root, 'app');
      await createVacancyCache(from).record({ id: '1', description: 'Full original text.' });
      const app = createVacancyCache(to, { legacyDirectory: from });
      expect((await app.read('1')).description).toBe('Full original text.');
      expect(await app.all()).toHaveLength(1);
      const missing = path.join(root, 'missing');
      expect((await migrateVacancyCache({ from: missing, to: path.join(root, 'unused') })).imported).toBe(0);
      expect(await fs.stat(path.join(root, 'unused')).then(() => true, () => false)).toBe(false);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
