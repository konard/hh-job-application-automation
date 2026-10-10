/**
 * Tests for saving to qa.lino from several processes at once (the run, form watchers, chats)
 */
import { describe, test, assert } from 'test-anywhere';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { createQADatabase } from '../src/qa-database.mjs';
import { withFileLock } from '../src/helpers/mutex.mjs';

const writer = (file, prefix, count) => new Promise((resolve, reject) => {
  const script = `import { createQADatabase } from ${JSON.stringify(path.resolve('src/qa-database.mjs'))};
const db = createQADatabase(${JSON.stringify(file)});
for (let i = 0; i < ${count}; i++) await db.addOrUpdateQA('${prefix} вопрос ' + i + '?', 'Ответ ' + i);`;
  const child = spawn(process.execPath, ['-e', script], { stdio: 'inherit' });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer exited with ${code}`))));
});

describe('saving from several processes', () => {
  test('two processes saving at the same time lose no answer', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'qa-lock-')), 'qa.lino');
    await Promise.all([writer(file, 'Первый', 15), writer(file, 'Второй', 15)]);
    assert.equal((await createQADatabase(file).readQADatabase()).size, 30);
    assert.ok(!(await fs.readdir(path.dirname(file))).some((name) => name.endsWith('.lock') || name.endsWith('.tmp')));
  });

  test('a lock left by a process that died is taken over', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'qa-lock-')), 'qa.lino');
    await fs.mkdir(`${file}.lock`);
    const old = new Date(Date.now() - 120000);
    await fs.utimes(`${file}.lock`, old, old);
    assert.equal(await withFileLock(file, async () => 'done'), 'done');
  });
});
