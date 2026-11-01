import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { flattenHhAreas, hhAreaNames, loadHhAreaTree } from '../src/hh-areas.mjs';
import { verifyHhSavedCvForm } from '../src/hh-cv-editor.mjs';

const ru = [{ id: '113', name: 'Россия', areas: [{ id: '1', name: 'Москва', areas: [] }] }];
const en = [{ id: '113', name: 'Russia', areas: [{ id: '1', name: 'Moscow', areas: [] }] }];

describe('localized HH workplace areas', () => {
  test('stable IDs distinguish a translated city from a different country', () => {
    const names = hhAreaNames([ru, [...en, { id: '112', name: 'India', areas: [] }]]);
    expect(names.identity('Москва')).toBe(names.identity('Moscow'));
    expect(names.identity('Moscow')).not.toBe(names.identity('India'));
    expect(names.localize('Москва', 1)).toBe('Moscow');
    expect(names.localize('Moscow', 0)).toBe('Москва');
  });
  test('duplicate place names and malformed dictionaries are rejected', () => {
    const duplicates = [{ id: '2', name: 'Same City', areas: [] }, { id: '3', name: 'Same City', areas: [] }];
    expect(() => hhAreaNames([duplicates, duplicates]).localize('Same City', 1)).toThrow('No unique');
    expect(() => flattenHhAreas([ru[0], ru[0]])).toThrow('duplicate');
    expect(() => flattenHhAreas([{ id: '1', name: 'City' }])).toThrow('Invalid');
  });
  test('one verified Save can have English UI labels and a Russian exported city', async () => {
    const form = { company: 'Example', title: 'Developer', startMonth: 'Май', startYear: '2026', current: true,
      description: 'Owner text.', area: 'Moscow', website: 'https://example.test', metadataEditable: true,
      resumes: [{ hash: 'ru', checked: true }] };
    const resumes = [{ hash: 'ru', cv: { jobs: [{ company: 'Example', position: 'Developer', start: '2026-05',
      end: null, description: form.description, area: 'Москва', website: 'example.test' }] } }];
    let reads = 0;
    const options = { readAreaNames: async () => { reads++; return hhAreaNames([ru, en]); } };
    expect(await verifyHhSavedCvForm(form, resumes, options)).toBe(true);
    expect(reads).toBe(1);
    expect(await verifyHhSavedCvForm({ ...form, area: 'India' }, resumes, options)).toBe(false);
    reads = 0;
    expect(await verifyHhSavedCvForm({ ...form, description: 'Unsaved text.' }, resumes, options)).toBe(false);
    expect(reads).toBe(0);
  });
  test('validated localized dictionaries are cached privately and HTTP failures are not cached', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hh-areas-'));
    let calls = 0;
    const options = { directory, locale: 'EN', now: () => 1000,
      fetcher: async url => { expect(url).toEndWith('?locale=EN'); calls++; return { ok: true, json: async () => en }; } };
    try {
      expect(await loadHhAreaTree(options)).toEqual(en);
      expect(await loadHhAreaTree(options)).toEqual(en);
      expect(calls).toBe(1);
      await expect(loadHhAreaTree({ ...options, now: () => 90000000,
        fetcher: async () => ({ ok: false, status: 503 }) })).rejects.toThrow('HTTP 503');
      expect(await loadHhAreaTree(options)).toEqual(en);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  test('translated activity labels verify the exact saved industry IDs, including removals', async () => {
    const form = { company: 'Game', title: 'Developer', startMonth: 'May', startYear: '2026', current: true,
      description: 'Game development.', area: 'Moscow', website: 'example.test', metadataEditable: true,
      metadataLocale: 'EN', industryText: 'Software Development', resumes: [{ hash: 'ru', checked: true }] };
    const job = { company: 'Game', position: 'Developer', start: '2026-05', end: null, description: form.description,
      area: 'Москва', website: 'example.test', industries: [{ id: '7.540', name: 'Разработка программного обеспечения', parent: 'ИТ' }] };
    const resumes = [{ hash: 'ru', cv: { jobs: [job] } }];
    const options = { readAreaNames: async () => hhAreaNames([ru, en]), readIndustryTree: async ({ locale }) => {
      expect(locale).toBe('EN');
      return [{ id: '7', name: 'IT', industries: [{ id: '7.540', name: 'Software Development' }] }];
    } };
    expect(await verifyHhSavedCvForm(form, resumes, options)).toBe(true);
    job.industries.push({ id: '49.406', name: 'Игорный бизнес' });
    expect(await verifyHhSavedCvForm(form, resumes, options)).toBe(false);
    job.industries = [];
    expect(await verifyHhSavedCvForm({ ...form, industryText: '' }, resumes, options)).toBe(true);
  });
});
