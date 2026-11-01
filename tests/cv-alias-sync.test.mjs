import { describe, test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { syncCvAliases, seedAliasSession, ensureCvAliasSync } from '../src/cv-alias-sync.mjs';

const makeResumes = () => ['ru', 'en'].map(language => ({ hash: language, cv: {
  language, about: `${language} biography.\n\n${language === 'ru' ? 'Технические навыки\nБазы данных' : 'Technical Skills\nDatabases'}:\nPostgreSQL`,
  jobs: ['A', 'B'].map((company, i) => ({ company, position: 'Developer', start: `202${i}-01`, end: `202${i + 1}-01`,
    description: `Owner narrative ${company}.\n\nTools:\nPostgreSQL` })),
} }));
const catalog = new Map([['PostgreSQL', ['PostgreSQL', 'Postgres', 'Postgre SQL']]]);

describe('reviewed alias updates across all CVs', () => {
  test('an existing draft is protected before session seeding could navigate it away', async () => {
    let seeded = false;
    expect(await seedAliasSession({}, { readForm: async () => ({ kind: 'about', about: 'Owner draft' }),
      seed: async () => { seeded = true; return true; } })).toBe(false);
    expect(seeded).toBe(false);
  });

  test('simultaneous application triggers start only one reviewer, and dead owners can be replaced', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alias-reviewer-'));
    let starts = 0;
    const options = { stateFile: path.join(directory, 'worker.json'), log: () => {},
      isAlive: pid => pid === 12345 && starts > 0,
      spawnChild: () => {
        starts++;
        const child = Object.assign(new EventEmitter(), { pid: 12345, unref: () => {} });
        globalThis.queueMicrotask(() => child.emit('spawn'));
        return child;
      } };
    try {
      const workers = await Promise.all([ensureCvAliasSync(options), ensureCvAliasSync(options)]);
      expect(starts).toBe(1);
      expect(workers.map(w => w.pid)).toEqual([12345, 12345]);
      await ensureCvAliasSync({ ...options, isAlive: () => false });
      expect(starts).toBe(2);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
  test('replans fresh saves, retains owner edits and includes aliases discovered while another draft waited', async () => {
    const resumes = makeResumes();
    const observed = [{ canonical: 'PostgreSQL', spelling: 'Postgres' }];
    let saved = 0;
    const seen = [];
    const result = await syncCvAliases({ catalog,
      readResumes: async () => globalThis.structuredClone(resumes),
      readObserved: async () => globalThis.structuredClone(observed),
      review: async change => {
        seen.push([change.resumeHash, change.kind]);
        const cv = resumes.find(r => r.hash === change.resumeHash).cv;
        if (change.kind === 'about') cv.about = change.fields.about;
        else cv.jobs.find(j => j.company === change.target.company).description = change.fields.description;
        if (++saved === 1) {
          cv.about = cv.about.replace('biography.', 'owner-edited biography.');
          observed.push({ canonical: 'PostgreSQL', spelling: 'Postgre SQL' });
        }
        return { saved: true };
      },
    });
    expect(result.saved).toBe(saved);
    expect(resumes[0].cv.about).toContain('owner-edited biography.');
    for (const { cv } of resumes) {
      expect(cv.about).toContain('PostgreSQL (Postgre SQL, Postgres)');
      for (const job of cv.jobs) {
        expect(job.description).toContain(`Owner narrative ${job.company}.`);
        expect(job.description).toContain('PostgreSQL (Postgre SQL, Postgres)');
      }
    }
    expect(seen).toContainEqual(['ru', 'update']);
    expect(seen).toContainEqual(['en', 'update']);
    const again = await syncCvAliases({ catalog, readResumes: async () => resumes,
      readObserved: async () => observed, review: async () => { throw new Error('No redundant edit'); } });
    expect(again.saved).toBe(0);
  });

  test('never advances from a cancelled or unverified Save', async () => {
    let reviewed = 0;
    await expect(syncCvAliases({ catalog, readResumes: async () => makeResumes(),
      readObserved: async () => [{ canonical: 'PostgreSQL', spelling: 'Postgres' }],
      review: async () => { reviewed++; return { saved: false }; },
    })).rejects.toThrow('not saved');
    expect(reviewed).toBe(1);
  });

  test('ambiguous position pairing blocks edits instead of guessing a counterpart', async () => {
    const resumes = makeResumes();
    resumes[1].cv.jobs[0].company = 'Unrelated employer';
    await expect(syncCvAliases({ catalog, readResumes: async () => resumes,
      readObserved: async () => [], review: async () => { throw new Error('No edit allowed'); },
    })).rejects.toThrow('paired unambiguously');
  });
});
