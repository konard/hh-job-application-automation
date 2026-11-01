import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCvEditQueue } from '../src/cv-edit-queue.mjs';

test('owner requests survive restart, concurrent enqueue is idempotent, completion is explicit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-queue-'));
  const file = path.join(directory, 'queue.json');
  const queue = createCvEditQueue(file);
  const change = { resumeHash: 'ru', kind: 'update', target: { company: 'Example' }, fields: { description: 'C2C marketplace' } };
  try {
    await Promise.all([queue.enqueue('one', change), queue.enqueue('one', change), queue.enqueue('two', { ...change, resumeHash: 'en' })]);
    expect(await createCvEditQueue(file).pending()).toHaveLength(2);
    await expect(queue.enqueue('invalid', {})).rejects.toThrow('Invalid');
    await queue.complete('one');
    expect((await queue.pending()).map(e => e.requestId)).toEqual(['two']);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).find(e => e.id === 'one').status).toBe('saved_by_user');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
