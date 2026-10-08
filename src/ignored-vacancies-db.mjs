import fs from 'fs/promises';
import path from 'path';
import { createMutex } from './helpers/mutex.mjs';

const isVacancyId = (id) => /^\d+$/.test(id);

export function createIgnoredVacanciesDatabase(filePath) {
  if (!filePath) {
    throw new Error(
      'CRITICAL: Ignored vacancies database file path is REQUIRED!\n' +
      'Usage: createIgnoredVacanciesDatabase("/path/to/ignored-vacancies.txt")',
    );
  }

  const exclusive = createMutex();

  async function readIgnoredVacancyIds() {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return new Set(content.split('\n').map((line) => line.trim()).filter(isVacancyId));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading ignored vacancy IDs database:', error);
      }
      return new Set();
    }
  }

  async function writeIgnoredVacancyIds(vacancyIds) {
    const ids = Array.from(vacancyIds, (id) => String(id).trim())
      .filter(isVacancyId)
      .sort((a, b) => Number(a) - Number(b));
    const nextContent = ids.length > 0 ? `${ids.join('\n')}\n` : '';
    const existingContent = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (existingContent === nextContent) {
      return;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, nextContent, 'utf8');
  }

  function addIgnoredVacancyId(vacancyId) {
    if (!isVacancyId(String(vacancyId))) {
      return Promise.resolve(false);
    }
    return exclusive(async () => {
      const vacancyIds = await readIgnoredVacancyIds();
      const sizeBefore = vacancyIds.size;
      vacancyIds.add(String(vacancyId));
      await writeIgnoredVacancyIds(vacancyIds);
      return vacancyIds.size > sizeBefore;
    });
  }

  return {
    readIgnoredVacancyIds,
    writeIgnoredVacancyIds,
    addIgnoredVacancyId,
  };
}
