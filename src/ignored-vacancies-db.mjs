import fs from 'fs/promises';
import path from 'path';

export function createIgnoredVacanciesDatabase(filePath) {
  if (!filePath) {
    throw new Error(
      'CRITICAL: Ignored vacancies database file path is REQUIRED!\n' +
      'Usage: createIgnoredVacanciesDatabase("/path/to/ignored-vacancies.txt")',
    );
  }

  const DB_FILE_PATH = filePath;
  const locks = new Map();

  async function acquireLock(key) {
    while (locks.has(key)) {
      await locks.get(key);
    }

    let releaseLock;
    const lockPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });

    locks.set(key, lockPromise);
    return releaseLock;
  }

  function releaseLock(key, releaseFn) {
    locks.delete(key);
    releaseFn();
  }

  async function readIgnoredVacancyIds() {
    try {
      await fs.mkdir(path.dirname(DB_FILE_PATH), { recursive: true });
      const content = await fs.readFile(DB_FILE_PATH, 'utf8');

      return new Set(
        content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^\d+$/.test(line)),
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        return new Set();
      }

      console.error('Error reading ignored vacancy IDs database:', error);
      return new Set();
    }
  }

  async function writeIgnoredVacancyIds(vacancyIds) {
    await fs.mkdir(path.dirname(DB_FILE_PATH), { recursive: true });

    const normalizedIds = Array.from(vacancyIds)
      .map((id) => String(id).trim())
      .filter((id) => /^\d+$/.test(id))
      .sort((a, b) => Number(a) - Number(b));

    const nextContent = normalizedIds.length > 0 ? `${normalizedIds.join('\n')}\n` : '';

    let existingContent = '';
    try {
      existingContent = await fs.readFile(DB_FILE_PATH, 'utf8');
    } catch {
      // File doesn't exist yet, will be created.
    }

    if (existingContent === nextContent) {
      return;
    }

    await fs.writeFile(DB_FILE_PATH, nextContent, 'utf8');
  }

  async function addIgnoredVacancyId(vacancyId) {
    if (!/^\d+$/.test(String(vacancyId))) {
      return false;
    }

    const lockKey = 'ignored-vacancies-database';
    const release = await acquireLock(lockKey);

    try {
      const vacancyIds = await readIgnoredVacancyIds();
      const sizeBefore = vacancyIds.size;
      vacancyIds.add(String(vacancyId));
      await writeIgnoredVacancyIds(vacancyIds);
      return vacancyIds.size > sizeBefore;
    } finally {
      releaseLock(lockKey, release);
    }
  }

  return {
    readIgnoredVacancyIds,
    writeIgnoredVacancyIds,
    addIgnoredVacancyId,
  };
}
