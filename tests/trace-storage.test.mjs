import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTraceDirectory, DEFAULT_TRACE_RETENTION_DAYS, managedTraceRecording,
  pruneTraceStorage, TRACE_DIRECTORY, traceRetentionDays } from '../src/trace-storage.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const exists = file => fs.access(file).then(() => true, () => false);

describe('private trace retention', () => {
  test('defaults to three days in machine-local app storage and refuses unlimited/invalid ages', () => {
    expect(TRACE_DIRECTORY).toBe(path.join(os.homedir(), '.hh-automation', 'traces'));
    expect(DEFAULT_TRACE_RETENTION_DAYS).toBe(3);
    expect(traceRetentionDays('1.5')).toBe(1.5);
    for (const value of [0, -1, '', 'forever', Infinity, NaN]) expect(() => traceRetentionDays(value)).toThrow('positive');
  });
  test('deletes expired managed diagnostics by recording age, retaining recent runs and unrelated files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-retention-'));
    try {
      const expired = await createTraceDirectory({ directory, name: 'main', now: () => NOW - 4 * DAY });
      const recent = await createTraceDirectory({ directory, name: 'chat', now: () => NOW - 2 * DAY });
      await fs.writeFile(path.join(expired, 'network.lino'), 'Old diagnostic');
      await fs.utimes(expired, new Date(NOW), new Date(NOW));
      const unknown = path.join(directory, '2026-10-01T12-00-00-000Z-manual-source');
      await fs.mkdir(unknown);
      await fs.writeFile(path.join(unknown, 'app.mjs'), 'Keep me');
      expect(await pruneTraceStorage({ directory, now: () => NOW })).toEqual([expired]);
      expect(await exists(expired)).toBe(false);
      expect(await exists(recent)).toBe(true);
      expect(await fs.readFile(path.join(unknown, 'app.mjs'), 'utf8')).toBe('Keep me');
      expect(await pruneTraceStorage({ directory, now: () => NOW })).toEqual([]);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  test('does not traverse symlinks or delete anything through a symlinked storage root', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-links-'));
    const directory = path.join(parent, 'traces');
    const outside = path.join(parent, 'outside');
    try {
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'source.mjs'), 'Source remains');
      const expired = await createTraceDirectory({ directory, now: () => NOW - 4 * DAY });
      await fs.symlink(outside, path.join(expired, 'link'));
      await fs.symlink(outside, path.join(directory, '2026-10-01T12-00-00-000Z-outside'));
      await pruneTraceStorage({ directory, now: () => NOW });
      expect(await fs.readFile(path.join(outside, 'source.mjs'), 'utf8')).toBe('Source remains');
      const rootLink = path.join(parent, 'linked-root');
      await fs.symlink(directory, rootLink);
      await expect(pruneTraceStorage({ directory: rootLink })).rejects.toThrow('real local directory');
      await expect(createTraceDirectory({ directory: rootLink })).rejects.toThrow('real local directory');
    } finally { await fs.rm(parent, { recursive: true, force: true }); }
  });
  test('requires the private marker to match the generated run timestamp', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-markers-'));
    try {
      const folder = await createTraceDirectory({ directory, now: () => NOW - 4 * DAY });
      await fs.writeFile(path.join(folder, '.hh-trace.json'), JSON.stringify({ kind: 'hh-automation-trace', version: 1,
        startedAt: '2020-01-01T00:00:00Z' }));
      expect(await pruneTraceStorage({ directory, now: () => NOW })).toEqual([]);
      expect(await exists(folder)).toBe(true);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  test('sanitizes trace labels and creates private directories and marker files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-name-'));
    try {
      const folder = await createTraceDirectory({ directory, name: '../../source', now: () => NOW });
      expect(path.dirname(folder)).toBe(directory);
      expect((await fs.stat(folder)).mode & 0o077).toBe(0);
      expect((await fs.stat(path.join(folder, '.hh-trace.json'))).mode & 0o077).toBe(0);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  test('idle sessions sweep old runs, rotate long recordings, and stop every timer', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-managed-'));
    let now = NOW;
    const timers = [];
    const events = [];
    const schedule = (fn, ms) => {
      const timer = { fn, ms, cancelled: false, unref() { this.unreferenced = true; } };
      timers.push(timer);
      return timer;
    };
    const errors = [];
    const recorder = await managedTraceRecording({ directory, now: () => now, schedule,
      cancel: timer => { timer.cancelled = true; }, onError: error => errors.push(error),
      start: async folder => {
        events.push(['start', folder]);
        return { directory: folder, checkpoint: async label => events.push(['checkpoint', label]),
          stop: async () => events.push(['stop', folder]) };
      } });
    try {
      const original = recorder.directory;
      const rotation = timers.find(t => t.ms === DAY);
      const sweep = timers.find(t => t.ms === 60000);
      expect(timers.every(t => t.unreferenced)).toBe(true);
      now += DAY;
      rotation.fn();
      await recorder.checkpoint('after rotation');
      expect(recorder.directory).not.toBe(original);
      expect(events[1]).toEqual(['stop', original]);
      expect(events.at(-1)).toEqual(['checkpoint', 'after rotation']);
      now += 2 * DAY + 1;
      sweep.fn();
      await recorder.stop();
      expect(await exists(original)).toBe(false);
      expect(await exists(recorder.directory)).toBe(true);
      expect(timers.every(t => t.cancelled)).toBe(true);
      const count = events.length;
      rotation.fn();
      await recorder.checkpoint('after stop');
      expect(events.length).toBe(count);
      expect(errors).toEqual([]);
    } finally { await recorder.stop(); await fs.rm(directory, { recursive: true, force: true }); }
  });
  test('retention can be shortened and concurrent sweeps remove an expired run safely', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-sweeps-'));
    try {
      const folder = await createTraceDirectory({ directory, now: () => NOW - 2 * DAY });
      await Promise.all([1, 2].map(() => pruneTraceStorage({ directory, retentionDays: 1, now: () => NOW })));
      expect(await exists(folder)).toBe(false);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
