import fs from 'fs/promises';
import path from 'path';

/**
 * Minimal async mutex: runs the given functions one at a time, in call order.
 *
 * @returns {(fn: () => Promise<any>) => Promise<any>} Function that runs `fn` exclusively
 */
export function createMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Run `fn` while holding a lock on a file shared by several processes (the application run, the
 * form watchers, answer-chats all save to data/qa.lino): a `<file>.lock` directory is created
 * atomically; a lock left by a process that died is taken over after `staleMs`
 * @param {string} file
 * @param {() => Promise<any>} fn
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=30000]
 * @param {number} [options.staleMs=60000]
 * @returns {Promise<any>}
 */
export async function withFileLock(file, fn, { timeoutMs = 30000, staleMs = 60000 } = {}) {
  const lock = `${file}.lock`;
  const started = Date.now();
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      const age = await fs.stat(lock).then((stat) => Date.now() - stat.mtimeMs).catch(() => 0);
      if (age > staleMs) {
        await fs.rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`${file} is locked by another process for more than ${timeoutMs / 1000} s (remove ${lock} if no process uses it)`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}
