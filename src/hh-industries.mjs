/** The complete official company-industry tree, independent of the virtualized HH chooser. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INDUSTRY_DIRECTORY = path.join(os.homedir(), '.hh-automation', 'dictionaries');
const localeOf = value => /^en/i.test(value ?? '') ? 'EN' : 'RU';

export function flattenIndustryTree(tree) {
  if (!Array.isArray(tree) || !tree.length) throw new Error('Invalid HH industry tree');
  const entries = [];
  const seen = new Set();
  for (const group of tree) {
    if (!/^\d+$/.test(group.id) || !group.name || typeof group.name !== 'string' || !Array.isArray(group.industries) || seen.has(group.id)) throw new Error('Invalid industry group');
    seen.add(group.id);
    entries.push({ id: group.id, name: group.name, path: [group.name], selectable: false });
    for (const item of group.industries) {
      if (!new RegExp(`^${group.id}\\.\\d+$`).test(item.id) || !item.name || typeof item.name !== 'string' || seen.has(item.id)) throw new Error('Invalid or duplicate industry ID');
      seen.add(item.id);
      entries.push({ id: item.id, uiId: item.id.split('.').at(-1), name: item.name,
        parentId: group.id, path: [group.name, item.name], selectable: true });
    }
  }
  return entries;
}

export async function loadHhIndustryTree({ locale = 'RU', directory = INDUSTRY_DIRECTORY,
  refresh = false, fetcher = globalThis.fetch, now = Date.now, maxAgeMs = 86400000 } = {}) {
  locale = localeOf(locale);
  const file = path.join(directory, `industries.${locale.toLowerCase()}.json`);
  const cached = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  if (!refresh && cached?.locale === locale && now() - cached.fetchedAt < maxAgeMs) {
    flattenIndustryTree(cached.tree);
    return cached.tree;
  }
  const url = `https://api.hh.ru/industries?locale=${locale}`;
  const response = await fetcher(url, { headers: {
    'HH-User-Agent': 'hh-job-application-automation/1.0 (https://github.com/konard/hh-job-application-automation)',
  }, signal: globalThis.AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HH industry directory: HTTP ${response.status}`);
  const tree = await response.json();
  flattenIndustryTree(tree);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ locale, fetchedAt: now(), source: url, tree }, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
  return tree;
}

export function resolveIndustry(selection, tree) {
  const entries = flattenIndustryTree(tree);
  const id = typeof selection === 'object' ? selection.id : /^\d+(?:\.\d+)?$/.test(selection) ? selection : null;
  const requestedPath = typeof selection === 'object' ? selection.path : typeof selection === 'string' && selection.includes(' > ') ? selection.split(' > ') : null;
  const matches = entries.filter(item => id ? item.id === id : requestedPath
    ? JSON.stringify(item.path) === JSON.stringify(requestedPath) : item.name === selection);
  if (matches.length !== 1 || !matches[0].selectable) throw new Error(`No unique selectable HH industry: ${JSON.stringify(selection)}`);
  return matches[0];
}

/** Commas inside labels are part of their names; match the longest complete directory label. */
export function industryNamesInText(text, tree) {
  let remaining = String(text ?? '').replace(/^(?:Company's field of activity|Сфера деятельности компании|Сфера деятельности)/i, '')
    .replace(/(?:and more|и ещ[её])\s*\d+\s*$/i, '').replace(/\s+/g, ' ').trim();
  const names = [...new Set(flattenIndustryTree(tree).filter(i => i.selectable).map(i => i.name))].sort((a, b) => b.length - a.length);
  const selected = [];
  while (remaining) {
    const name = names.find(name => remaining === name || remaining.startsWith(`${name}, `));
    if (!name) throw new Error(`Cannot identify selected HH industry: ${remaining}`);
    selected.push(name);
    remaining = remaining.slice(name.length).replace(/^,\s*/, '');
  }
  return selected;
}

/** Select stable leaf IDs, even when most of the tree is not mounted in the DOM. */
export async function selectHhIndustryReferences(page, selections, { tree = null } = {}) {
  const locale = await page.locator('html').getAttribute('lang');
  tree ??= await loadHhIndustryTree({ locale });
  const entries = selections.map(item => resolveIndustry(item, tree));
  if (entries.length > 5 || new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Select at most five distinct industries');
  const trigger = page.locator('[data-qa="trigger-root"]').filter({ hasText: /field of activity|сфера деятельности/i }).first();
  const selectedText = async () => {
    const values = trigger.locator('[data-qa="trigger-values-wrapper"]');
    return await values.count() ? await values.textContent() : await trigger.textContent();
  };
  const previous = industryNamesInText(await selectedText(), tree);
  const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-qa="tree-selector-search-input"]') }).last();
  if (!await dialog.isVisible().catch(() => false)) await trigger.click();
  await dialog.waitFor({ state: 'visible' });
  const reset = dialog.getByRole('button', { name: /^(reset|сбросить)$/i });
  // HH Reset restores the original selections; it does not empty the selection.
  if (await reset.isEnabled()) await reset.click();
  const choose = async (entry, checked) => {
    await dialog.locator('[data-qa="tree-selector-search-input"]').fill(entry.name);
    const item = dialog.locator(`[data-qa~="tree-selector-item-text-${entry.uiId}"]`);
    await item.waitFor({ state: 'visible', timeout: 15000 });
    await item.scrollIntoViewIfNeeded();
    const checkbox = dialog.locator(`input[data-qa~="tree-selector-input-${entry.uiId}"]`);
    if (await checkbox.isChecked() !== checked) await item.click();
    await page.waitForFunction(({ id, checked }) => document.querySelector(`input[data-qa~="tree-selector-input-${id}"]`)?.checked === checked,
      { id: entry.uiId, checked }, { timeout: 5000 });
  };
  const wanted = new Set(entries.map(i => i.id));
  for (const name of previous) {
    for (const entry of flattenIndustryTree(tree).filter(i => i.selectable && i.name === name && !wanted.has(i.id))) await choose(entry, false);
  }
  for (const entry of entries) await choose(entry, true);
  // Chooser Save applies local form fields only; the workplace Save remains the owner's.
  await dialog.getByRole('button', { name: /^(save|сохранить)$/i }).click();
  await dialog.waitFor({ state: 'hidden' });
  const actual = industryNamesInText(await selectedText(), tree).sort();
  if (JSON.stringify(actual) !== JSON.stringify(entries.map(i => i.name).sort())) throw new Error('Workplace industry selection does not exactly match the requested activities');
  return entries;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const locale = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : 'RU';
  loadHhIndustryTree({ locale, refresh: args.includes('--refresh') }).then(tree => {
    if (args.includes('--json')) console.log(JSON.stringify(tree, null, 2));
    else console.log(JSON.stringify({ locale: localeOf(locale), groups: tree.length,
      industries: flattenIndustryTree(tree).filter(item => item.selectable).length, directory: INDUSTRY_DIRECTORY }));
  }).catch(error => { console.error(error.message); process.exit(1); });
}
