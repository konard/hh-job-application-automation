/** Private employer text, stored as Links Notation; never include this directory in git. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Parser } from 'links-notation';
import { quoteLino } from './cv.mjs';
import { withFileLock } from './helpers/mutex.mjs';

export const VACANCY_CACHE_DIR = path.resolve(process.env.VACANCY_CACHE_DIR || path.join(process.cwd(), 'data/vacancies'));
const lists = new Set(['skills', 'required', 'preferred']);

export function createVacancyCache(directory = VACANCY_CACHE_DIR, { now = () => new Date() } = {}) {
  const fileFor = (id) => {
    if (!/^\d+$/.test(String(id))) throw new Error('Invalid vacancy ID');
    return path.join(directory, `${id}.lino`);
  };
  const read = async (id) => {
    const content = await fs.readFile(fileFor(id), 'utf8').catch((error) => { if (error.code === 'ENOENT') return ''; throw error; });
    const data = Object.fromEntries(new Parser().parseGroups(content).map((group) => {
      const field = group.element.values[0].id;
      const values = group.children.map((child) => child.element.values[0]?.id ?? '').map((value) => value === ' ' ? '' : value);
      return [field, lists.has(field) ? values : values[0] ?? ''];
    }));
    return data.id ? data : null;
  };
  return {
    directory, read,
    async record(vacancy) {
      const file = fileFor(vacancy.id);
      await fs.mkdir(directory, { recursive: true });
      return withFileLock(file, async () => {
        const before = await read(vacancy.id);
        const record = { ...before, ...vacancy, id: String(vacancy.id),
          firstSeenAt: before?.firstSeenAt ?? now().toISOString(), lastSeenAt: now().toISOString() };
        const text = Object.entries(record).filter(([, value]) => value !== undefined && value !== null)
          .map(([field, value]) => `${field}\n${[value].flat().map((item) => `  ${quoteLino((typeof item === 'object' ? JSON.stringify(item) : String(item)) || ' ')}`).join('\n')}`).join('\n') + '\n';
        await fs.writeFile(`${file}.tmp`, text);
        await fs.rename(`${file}.tmp`, file);
        return record;
      });
    },
    async all() {
      const files = await fs.readdir(directory).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
      return (await Promise.all(files.filter((file) => /^\d+\.lino$/.test(file)).map((file) => read(file.slice(0, -5))))).filter(Boolean);
    },
  };
}
