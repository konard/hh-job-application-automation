/** Text-only Oxion API access. Keys come from the ignored .lenv, never CLI arguments or logs. */
import fs from 'node:fs/promises';

export async function loadOxionSettings({ file = '.lenv', env = process.env } = {}) {
  const text = await fs.readFile(file, 'utf8').catch((error) => { if (error.code === 'ENOENT') return ''; throw error; });
  const setting = (name, fallback = '') => env[name] ?? text.match(new RegExp(`^${name}:\\s*['"\x60]?([^'"\x60\\r\\n]+)`, 'm'))?.[1].trim() ?? fallback;
  return { apiKey: setting('OXION_API_KEY'), baseUrl: setting('OXION_BASE_URL', 'https://oxionai.com/v1').replace(/\/+$/, ''),
    model: setting('OXION_MODEL', 'claude-haiku-5-5') };
}

export async function oxionRequest(settings, endpoint, { fetchImpl = fetch, body } = {}) {
  if (!settings.apiKey) throw new Error('OXION_API_KEY is not configured in .lenv');
  const url = new URL(`${settings.baseUrl}/${endpoint}`);
  if (url.protocol !== 'https:') throw new Error('The AI endpoint must use HTTPS');
  const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: globalThis.AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) {
    const message = String(data.error?.message ?? `HTTP ${response.status}`).replaceAll(settings.apiKey, '[redacted]');
    return { ok: false, status: response.status, code: data.error?.code ?? 'api_error', message };
  }
  return { ok: true, status: response.status, data };
}

export async function oxionModelStatus(settings, { probe = false, fetchImpl = fetch } = {}) {
  const catalog = await oxionRequest(settings, 'models', { fetchImpl });
  if (!catalog.ok) return catalog;
  const models = (catalog.data.data ?? []).map((model) => model.id);
  const result = { authenticated: true, model: settings.model, listed: models.includes(settings.model),
    claudeModels: models.filter((model) => /claude|haiku/i.test(model)) };
  if (probe) {
    const response = await oxionRequest(settings, 'chat/completions', { fetchImpl,
      body: { model: settings.model, messages: [{ role: 'user', content: 'Reply with OK only.' }], max_tokens: 4 } });
    result.available = response.ok;
    if (!response.ok) result.error = { status: response.status, code: response.code, message: response.message };
  }
  return result;
}
