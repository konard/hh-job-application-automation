/** Machine-local, expiring browser diagnostics. Never migrate old repository traces here. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TRACE_DIRECTORY = path.join(os.homedir(), '.hh-automation', 'traces');
export const DEFAULT_TRACE_RETENTION_DAYS = 3;
export const TRACE_SWEEP_MS = 60000;
const DAY_MS = 86400000;
const MARKER = '.hh-trace.json';
const KIND = 'hh-automation-trace';

export function traceRetentionDays(value = process.env.TRACE_RETENTION_DAYS ?? DEFAULT_TRACE_RETENTION_DAYS) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) throw new Error('Trace retention must be a positive number of days');
  return days;
}

const stamp = date => new Date(date).toISOString().replace(/[:.]/g, '-');

/** Only directories created and marked by this recorder can be removed automatically. */
export async function pruneTraceStorage({ directory = TRACE_DIRECTORY, retentionDays = traceRetentionDays(), now = Date.now } = {}) {
  const cutoff = now() - traceRetentionDays(retentionDays) * DAY_MS;
  const removed = [];
  const root = await fs.lstat(directory).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!root) return removed;
  if (!root.isDirectory()) throw new Error('Trace storage must be a real local directory');
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-z\d_-]+$/i.test(entry.name)) continue;
    const folder = path.join(directory, entry.name);
    const marker = path.join(folder, MARKER);
    const info = await fs.lstat(marker).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info?.isFile() || info.size > 4096) continue;
    const data = await fs.readFile(marker, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    });
    const started = Date.parse(data?.startedAt);
    if (data?.kind !== KIND || data.version !== 1 || !Number.isFinite(started) ||
      !entry.name.startsWith(`${stamp(started)}-`) || started > cutoff) continue;
    // rm does not follow nested symlinks. The root entry and marker were checked without following links.
    await fs.rm(folder, { recursive: true, force: true, maxRetries: 3 });
    removed.push(folder);
  }
  return removed;
}

export async function createTraceDirectory({ directory = TRACE_DIRECTORY, name = '', now = Date.now } = {}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Trace storage must be a real local directory');
  const startedAt = new Date(now()).toISOString();
  const label = String(name).replace(/[^a-z\d_-]/gi, '-').slice(0, 80) || 'run';
  const folder = await fs.mkdtemp(path.join(directory, `${stamp(startedAt)}-${label}-`));
  await fs.writeFile(path.join(folder, MARKER), JSON.stringify({ kind: KIND, version: 1, startedAt }), { mode: 0o600 });
  return folder;
}

/** Rotate long-lived recordings before expiry; sweep also while the browser waits on a form. */
export async function managedTraceRecording({ start, directory = TRACE_DIRECTORY, name = '', retentionDays = traceRetentionDays(),
  now = Date.now, schedule = setInterval, cancel = clearInterval, onError = () => {} }) {
  const days = traceRetentionDays(retentionDays);
  await pruneTraceStorage({ directory, retentionDays: days, now });
  const open = async () => start(await createTraceDirectory({ directory, name, now }));
  let recording = await open();
  let stopped = false;
  let queue = Promise.resolve();
  const enqueue = fn => {
    const task = queue.then(fn);
    queue = task.catch(onError);
    return task;
  };
  const rotate = () => enqueue(async () => {
    if (stopped) return;
    await recording.stop();
    recording = await open();
  });
  let sweeping = null;
  const sweep = () => {
    sweeping ??= pruneTraceStorage({ directory, retentionDays: days, now }).catch(onError).finally(() => { sweeping = null; });
    return sweeping;
  };
  const rotation = schedule(() => { void rotate().catch(onError); }, Math.min(DAY_MS, days * DAY_MS / 2));
  const cleanup = schedule(() => { void sweep(); }, Math.min(TRACE_SWEEP_MS, days * DAY_MS / 2));
  rotation?.unref?.();
  cleanup?.unref?.();
  return {
    get directory() { return recording.directory; },
    checkpoint: label => enqueue(() => stopped ? undefined : recording.checkpoint(label)),
    async stop() {
      if (stopped) return;
      stopped = true;
      cancel(rotation);
      cancel(cleanup);
      await queue;
      await recording.stop();
      await sweeping;
      await pruneTraceStorage({ directory, retentionDays: days, now }).catch(onError);
    },
  };
}
