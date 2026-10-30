/** Private employer text, stored as Links Notation; never include this directory in git. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Parser } from 'links-notation';
import { quoteLino } from './cv.mjs';
import { withFileLock } from './helpers/mutex.mjs';

export const DEFAULT_VACANCY_CACHE_DIR = path.join(os.homedir(), '.hh-automation', 'vacancies');
export const VACANCY_CACHE_DIR = path.resolve(process.env.VACANCY_CACHE_DIR || DEFAULT_VACANCY_CACHE_DIR);
const LEGACY_VACANCY_CACHE_DIR = path.join(process.cwd(), 'data', 'vacancies');
const lists = new Set(['skills', 'required', 'preferred']);

function parseVacancy(content) {
  const data = Object.fromEntries(new Parser().parseGroups(content).map((group) => {
    const field = group.element.values[0].id;
    const values = group.children.map((child) => child.element.values[0]?.id ?? '').map((value) => value === ' ' ? '' : value);
    return [field, lists.has(field) ? values : values[0] ?? ''];
  }));
  return data.id ? data : null;
}

/** Copy older repository-local records once; keep the originals and never overwrite app records. */
export async function migrateVacancyCache({ from = LEGACY_VACANCY_CACHE_DIR, to = DEFAULT_VACANCY_CACHE_DIR } = {}) {
  const result = { imported: 0, existing: 0, invalid: [] };
  if (path.resolve(from) === path.resolve(to)) return result;
  const files = (await fs.readdir(from).catch((error) => { if (error.code === 'ENOENT') return []; throw error; }))
    .filter((file) => /^\d+\.lino$/.test(file));
  if (!files.length) return result;
  await fs.mkdir(to, { recursive: true, mode: 0o700 });
  return withFileLock(path.join(to, '.legacy-import'), async () => {
    for (const name of files) {
      const target = path.join(to, name);
      if (await fs.stat(target).then(() => true, () => false)) { result.existing++; continue; }
      const content = await fs.readFile(path.join(from, name), 'utf8');
      try {
        if (parseVacancy(content)?.id !== name.slice(0, -5)) throw new Error('Invalid vacancy ID');
      } catch { result.invalid.push(name); continue; }
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, content, { mode: 0o600 });
        await fs.rename(temporary, target);
        result.imported++;
      } finally { await fs.rm(temporary, { force: true }); }
    }
    return result;
  });
}

export function createVacancyCache(directory = VACANCY_CACHE_DIR, { now = () => new Date(),
  legacyDirectory = path.resolve(directory) === DEFAULT_VACANCY_CACHE_DIR ? LEGACY_VACANCY_CACHE_DIR : null } = {}) {
  let migrating;
  const ready = () => migrating ??= legacyDirectory ? migrateVacancyCache({ from: legacyDirectory, to: directory }) : Promise.resolve();
  const fileFor = (id) => {
    if (!/^\d+$/.test(String(id))) throw new Error('Invalid vacancy ID');
    return path.join(directory, `${id}.lino`);
  };
  const read = async (id) => {
    await ready();
    const content = await fs.readFile(fileFor(id), 'utf8').catch((error) => { if (error.code === 'ENOENT') return ''; throw error; });
    return parseVacancy(content);
  };
  return {
    directory, read,
    async record(vacancy) {
      await ready();
      const file = fileFor(vacancy.id);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      return withFileLock(file, async () => {
        const before = await read(vacancy.id);
        const record = { ...before, ...vacancy, id: String(vacancy.id),
          firstSeenAt: before?.firstSeenAt ?? now().toISOString(), lastSeenAt: now().toISOString() };
        const text = Object.entries(record).filter(([, value]) => value !== undefined && value !== null)
          .map(([field, value]) => `${field}\n${[value].flat().map((item) => `  ${quoteLino((typeof item === 'object' ? JSON.stringify(item) : String(item)) || ' ')}`).join('\n')}`).join('\n') + '\n';
        await fs.writeFile(`${file}.tmp`, text, { mode: 0o600 });
        await fs.rename(`${file}.tmp`, file);
        return record;
      });
    },
    async all() {
      await ready();
      const files = await fs.readdir(directory).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
      return (await Promise.all(files.filter((file) => /^\d+\.lino$/.test(file)).map((file) => read(file.slice(0, -5))))).filter(Boolean);
    },
  };
}
