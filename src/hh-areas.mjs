/** Stable HH area identities across the localized city/region names used by CVs and the UI. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { INDUSTRY_DIRECTORY } from './hh-industries.mjs';

export function flattenHhAreas(tree) {
  if (!Array.isArray(tree) || !tree.length) throw new Error('Invalid HH area tree');
  const result = [];
  const seen = new Set();
  const visit = node => {
    if (!/^\d+$/.test(node.id) || typeof node.name !== 'string' || !node.name || !Array.isArray(node.areas) || seen.has(node.id)) {
      throw new Error('Invalid or duplicate HH area');
    }
    seen.add(node.id);
    result.push({ id: node.id, name: node.name });
    node.areas.forEach(visit);
  };
  tree.forEach(visit);
  return result;
}

export async function loadHhAreaTree({ locale = 'RU', directory = INDUSTRY_DIRECTORY,
  fetcher = globalThis.fetch, now = Date.now, maxAgeMs = 86400000 } = {}) {
  locale = /^en/i.test(locale) ? 'EN' : 'RU';
  const file = path.join(directory, `areas.${locale.toLowerCase()}.json`);
  const cached = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  if (cached?.locale === locale && now() - cached.fetchedAt < maxAgeMs) {
    flattenHhAreas(cached.tree);
    return cached.tree;
  }
  const response = await fetcher(`https://api.hh.ru/areas?locale=${locale}`, {
    headers: { 'HH-User-Agent': 'hh-job-application-automation/1.0 (https://github.com/konard/hh-job-application-automation)' },
    signal: globalThis.AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HH area directory: HTTP ${response.status}`);
  const tree = await response.json();
  flattenHhAreas(tree);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ locale, fetchedAt: now(), tree }), { mode: 0o600 });
  await fs.rename(temporary, file);
  return tree;
}

const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Ambiguous duplicate city names never imply a match or a guessed destination. */
export function hhAreaNames(trees) {
  const entries = trees.map(flattenHhAreas);
  const ids = new Map();
  for (const list of entries) for (const area of list) {
    const matches = ids.get(key(area.name)) ?? new Set();
    matches.add(area.id);
    ids.set(key(area.name), matches);
  }
  const uniqueId = name => {
    const matches = ids.get(key(name));
    return matches?.size === 1 ? [...matches][0] : null;
  };
  return {
    identity: name => uniqueId(name) ? `area:${uniqueId(name)}` : `name:${key(name)}`,
    localize: (name, index) => {
      const id = uniqueId(name);
      const target = id && entries[index]?.find(area => area.id === id);
      if (!target) throw new Error(`No unique HH city or region: ${name}`);
      return target.name;
    },
  };
}

export async function loadHhAreaNames() {
  return hhAreaNames(await Promise.all(['RU', 'EN'].map(locale => loadHhAreaTree({ locale }))));
}
