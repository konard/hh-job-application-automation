import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadOxionSettings, oxionModelStatus } from '../src/oxion.mjs';

test('AI settings stay in local .lenv and model discovery reports unavailable Haiku honestly', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oxion-'));
  try {
    const file = path.join(dir, '.lenv');
    await fs.writeFile(file, "OXION_BASE_URL: 'https://api.test/v1'\nOXION_API_KEY: test-secret\nOXION_MODEL: claude-haiku-5-5\n");
    const settings = await loadOxionSettings({ file, env: {} });
    expect(settings).toEqual({ apiKey: 'test-secret', baseUrl: 'https://api.test/v1', model: 'claude-haiku-5-5' });
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push(String(url)); expect(options.redirect).toBe('error');
      expect(options.headers.Authorization).toBe('Bearer test-secret');
      return String(url).endsWith('/models') ? { ok: true, status: 200, json: async () => ({ data: [{ id: 'claude-fable-5' }] }) }
        : { ok: false, status: 404, json: async () => ({ error: { code: 'model_not_found', message: 'Unavailable test-secret' } }) };
    };
    const status = await oxionModelStatus(settings, { probe: true, fetchImpl });
    expect(status).toMatchObject({ authenticated: true, listed: false, available: false, error: { code: 'model_not_found', message: 'Unavailable [redacted]' } });
    expect(requests).toHaveLength(2);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
