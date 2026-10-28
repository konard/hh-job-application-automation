import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { refreshSelectedCvCache } from '../src/cv-store.mjs';

test('only the selected CV cache is refreshed from saved exports; existing PDF remains', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selected-cv-'));
  try {
    await fs.mkdir(path.join(dir, 'cv', 'ru'), { recursive: true });
    await fs.mkdir(path.join(dir, 'cv', 'en'), { recursive: true });
    await fs.writeFile(path.join(dir, 'resume.json'), JSON.stringify({ hash: 'ru', about: 'Stale About' }));
    await fs.writeFile(path.join(dir, 'resume.pdf'), 'Existing PDF');
    await fs.writeFile(path.join(dir, 'cv', 'ru', 'resume.json'), JSON.stringify({ hash: 'ru', about: 'Go (Golang)' }));
    await fs.writeFile(path.join(dir, 'cv', 'en', 'resume.json'), JSON.stringify({ hash: 'en', about: 'English' }));
    expect(await refreshSelectedCvCache(path.join(dir, 'cv'), dir)).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'resume.json'), 'utf8')).about).toBe('Go (Golang)');
    expect(await fs.readFile(path.join(dir, 'resume.pdf'), 'utf8')).toBe('Existing PDF');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
