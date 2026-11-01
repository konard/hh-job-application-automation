import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { flattenIndustryTree, resolveIndustry, loadHhIndustryTree, industryNamesInText } from '../src/hh-industries.mjs';

const tree = [
  { id: '7', name: 'Internet', industries: [{ id: '7.541', name: 'Internet Company' }, { id: '7.542', name: 'Shared' }] },
  { id: '49', name: 'Services', industries: [{ id: '49.404', name: 'Car Hire' }, { id: '49.405', name: 'Shared' }] },
];
test('selected labels are parsed exactly without splitting commas inside an industry name', () => {
  const directory = [...tree, { id: '99', name: 'Other', industries: [{ id: '99.100', name: 'Internet Company (Search, Entertainment)' }] }];
  expect(industryNamesInText('Internet Company (Search, Entertainment), Car Hire', directory)).toEqual(['Internet Company (Search, Entertainment)', 'Car Hire']);
  expect(industryNamesInText('', directory)).toEqual([]);
  expect(() => industryNamesInText('Unknown activity', directory)).toThrow('Cannot identify');
});
test('full IDs and paths select any leaf, including ambiguous names; groups cannot be selected', () => {
  expect(flattenIndustryTree(tree)).toHaveLength(6);
  expect(resolveIndustry({ id: '49.404' }, tree)).toMatchObject({ uiId: '404', parentId: '49' });
  expect(resolveIndustry('Internet Company', tree).id).toBe('7.541');
  expect(resolveIndustry({ path: ['Services', 'Shared'] }, tree).id).toBe('49.405');
  expect(() => resolveIndustry('Shared', tree)).toThrow('unique');
  expect(() => resolveIndustry('7', tree)).toThrow('selectable');
  expect(() => flattenIndustryTree([...tree, tree[0]])).toThrow('Invalid');
});
test('complete localized dictionary is validated and cached, rather than DOM-visible branches', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hh-industries-'));
  const urls = [];
  const options = { directory, now: () => 100000, fetcher: async url => {
    urls.push(url);
    return { ok: true, json: async () => tree };
  } };
  try {
    expect(await loadHhIndustryTree({ ...options, locale: 'en' })).toEqual(tree);
    expect(await loadHhIndustryTree({ ...options, locale: 'EN' })).toEqual(tree);
    expect(urls).toEqual(['https://api.hh.ru/industries?locale=EN']);
    await loadHhIndustryTree({ ...options, locale: 'RU' });
    expect(urls).toHaveLength(2);
    await expect(loadHhIndustryTree({ ...options, refresh: true, fetcher: async () => ({ ok: true, json: async () => [] }) })).rejects.toThrow('Invalid');
    expect((await fs.readdir(directory)).sort()).toEqual(['industries.en.json', 'industries.ru.json']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
