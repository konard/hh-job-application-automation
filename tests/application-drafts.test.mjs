import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { completeApplicationDraft, readApplicationDraft, writeApplicationDraft } from '../src/application-drafts.mjs';

test('private drafts preserve all fields atomically, avoid unchanged writes, and retain recovery data after success', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'application-drafts-'));
  try {
    const draft = { vacancyId: '123', url: 'https://hh.ru/applicant/vacancy_response?vacancyId=123', requiresReview: true,
      capturedAt: 'first', fields: [{ name: 'answer', value: 'Full final answer' }, { name: 'letter', value: 'My letter' },
        { name: 'choice', value: 'open', checked: true }, { name: 'choice_text', value: 'Custom answer' }] };
    const { file } = await writeApplicationDraft(draft, directory);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await readApplicationDraft('123', directory)).toEqual(draft);
    expect((await writeApplicationDraft({ ...draft, capturedAt: 'later' }, directory)).written).toBe(false);
    await completeApplicationDraft('123', directory);
    expect(await readApplicationDraft('123', directory)).toMatchObject({ requiresReview: false, fields: draft.fields });
    expect(await fs.readdir(directory)).toEqual(['123.json']);
    expect(await readApplicationDraft('999', directory)).toBeNull();
    await expect(readApplicationDraft('../bad', directory)).rejects.toThrow('vacancy ID');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
