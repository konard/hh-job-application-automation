/** Explicit owner-requested CV edits, consumed only after a verified user Save. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './helpers/mutex.mjs';

export const CV_EDIT_QUEUE_FILE = path.resolve('logs/experience/cv-edit-queue.json');

export function createCvEditQueue(file = CV_EDIT_QUEUE_FILE) {
  const read = () => fs.readFile(file, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const write = async entries => {
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(entries, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
  };
  return {
    pending: async () => (await read()).filter(e => e.status === 'pending').map(e => ({ ...e.change, requestId: e.id })),
    enqueue: (id, change) => withFileLock(file, async () => {
      if (!id || !change.resumeHash || !change.target?.company || !change.fields) throw new Error('Invalid requested CV edit');
      const entries = await read();
      if (!entries.some(e => e.id === id)) {
        entries.push({ id, change, status: 'pending', at: new Date().toISOString() });
        await write(entries);
      }
    }),
    complete: id => withFileLock(file, async () => {
      const entries = await read();
      const entry = entries.find(e => e.id === id);
      if (!entry) throw new Error('Requested CV edit not found');
      entry.status = 'saved_by_user';
      entry.savedAt = new Date().toISOString();
      await write(entries);
    }),
  };
}
