#!/usr/bin/env bun
/** Reviewed alias maintenance across every saved CV; the owner clicks every final Save. */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { withFileLock } from './helpers/mutex.mjs';
import { exportSavedCvs, writeCvSnapshots, publishCvSnapshots } from './cv-store.mjs';
import { planCvTechnologySync } from './cv-technologies.mjs';
import { reviewCvSequence, reviewHhCvChange } from './cv-review.mjs';
import { readHhCvForm, observeHhCvSaves, verifyHhSavedForm } from './hh-cv-editor.mjs';
import { loadTechnologyAliases, observedTechnologyNames } from './vacancy-analysis.mjs';
import { createVacancyCache } from './vacancy-cache.mjs';
import { openSlot } from './browser-slots.mjs';
import { seedHhSession } from './login.mjs';
import { createCvEditQueue } from './cv-edit-queue.mjs';
import { parseMonthYear } from './experience.mjs';
import { alertUser } from './notify.mjs';

/** Called only after a passive Save has been verified against fresh exports. */
export function requestedEditsForSavedForm(form, requests) {
  const start = parseMonthYear(`${form.startMonth} ${form.startYear}`);
  const end = form.current ? null : parseMonthYear(`${form.endMonth} ${form.endYear}`);
  return requests.filter(change => form.resumes?.some(r => r.checked && r.hash === change.resumeHash) &&
    form.company === change.target.company && start === change.target.start && end === change.target.end);
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

/** Re-export and replan after each reviewed step, retaining edits the owner made at Save. */
export async function syncCvAliases({ readResumes, readObserved, catalog, review, onPlan = async () => {},
  readRequests = async () => [], onRequestedSaved = async () => {} }) {
  let saved = 0;
  for (;;) {
    const resumes = await readResumes();
    const observed = await readObserved();
    const plan = planCvTechnologySync(resumes, catalog, { observed });
    const requests = await readRequests();
    plan.changes = [...requests, ...plan.changes];
    await onPlan(plan);
    if (plan.unmatched.length) throw new Error('CV positions cannot be paired unambiguously; alias review paused');
    if (!plan.changes.length) return { saved, resumes, observed };
    const steps = await reviewCvSequence([plan.changes[0]], review);
    if (requests[0]) await onRequestedSaved(requests[0]);
    saved += steps.length;
  }
}

/** Adopt an existing owner draft by observation only; do not overwrite or navigate it. */
export async function waitForExistingAliasDraft(page, { readResumes, writeSnapshots, port = 9352 }) {
  let resolve;
  const saved = new Promise(done => { resolve = done; });
  const stop = await observeHhCvSaves(page, { onSaved: async (form) => {
    const resumes = await readResumes();
    if (!verifyHhSavedForm(form, resumes)) return false;
    await writeSnapshots(resumes);
    resolve(form);
    return true;
  } });
  const endAlert = alertUser({ port });
  try { return await saved; } finally { endAlert(); stop(); }
}

export async function seedAliasSession(page, { fromPort = 9322, readForm = readHhCvForm, seed = seedHhSession } = {}) {
  if (await readForm(page)) return false;
  if (!await seed({ page, fromPort })) throw new Error('CV slot requires manual sign-in');
  return true;
}

const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

/** Only one detached alias reviewer may own a CV slot, across application restarts. */
export async function ensureCvAliasSync({ fromPort = 9322, port = 9352, publish = false, log = console.log,
  stateFile = path.resolve(`logs/experience/alias-sync-${port}.json`), spawnChild = spawn, isAlive = alive } = {}) {
  return withFileLock(stateFile, async () => {
    const previous = await fs.readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null);
    if (isAlive(previous?.pid)) return { running: true, pid: previous.pid };
    const logfile = stateFile.replace(/\.json$/, '.log');
    const fd = fsSync.openSync(logfile, 'a');
    try {
      const child = spawnChild(process.execPath, [fileURLToPath(import.meta.url), '--hh-port', String(port),
        '--from-port', String(fromPort), '--state-file', stateFile, ...(publish ? ['--publish'] : [])],
      { cwd: process.cwd(), env: process.env, detached: true, stdio: ['ignore', fd, fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      await writeJson(stateFile, { pid: child.pid, port, at: new Date().toISOString(), status: 'starting' });
      log(`📝 CV alias reviewer started in slot ${port}: both languages, About and position lists; each Save remains yours.`);
      return { running: true, pid: child.pid, logfile };
    } finally { fsSync.closeSync(fd); }
  });
}

async function main(args) {
  const options = { port: 9352, fromPort: 9322, publish: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hh-port') options.port = Number(args[++i]);
    else if (args[i] === '--from-port') options.fromPort = Number(args[++i]);
    else if (args[i] === '--state-file') options.stateFile = args[++i];
    else if (args[i] === '--publish') options.publish = true;
    else throw new Error(`Unknown alias sync option: ${args[i]}`);
  }
  const stateFile = options.stateFile ?? `logs/experience/alias-sync-${options.port}.json`;
  const writeState = async (status, extra = {}) => {
    await writeJson(stateFile, { pid: process.pid, port: options.port, at: new Date().toISOString(), status, ...extra });
  };
  const session = await openSlot({ name: 'resume-alias-slot', port: options.port });
  try {
    const page = session.page;
    await seedAliasSession(page, { fromPort: options.fromPort });
    const catalog = await loadTechnologyAliases();
    const editQueue = createCvEditQueue();
    const readResumes = () => exportSavedCvs({ port: options.port });
    const readObserved = async () => observedTechnologyNames(await createVacancyCache().all(), catalog);
    const writeSnapshots = async (resumes) => {
      const files = await writeCvSnapshots(resumes, 'examples');
      if (options.publish) await publishCvSnapshots(files);
    };
    const signature = async (observed) => {
      observed ??= await readObserved();
      const examples = (await fs.readdir('examples')).filter(file => /^cv\..*\.lino$/.test(file)).sort();
      const contents = await Promise.all(examples.map(file => fs.readFile(path.join('examples', file), 'utf8')));
      return createHash('sha256').update(JSON.stringify(observed.map(({ canonical, spelling }) => [canonical, spelling]).sort()) +
        contents.join('\n') + JSON.stringify(await editQueue.pending())).digest('hex');
    };
    let checked = null;
    for (;;) {
      if (await readHhCvForm(page)) {
        await writeState('awaiting_existing_user_save');
        const savedForm = await waitForExistingAliasDraft(page, { readResumes, writeSnapshots, port: options.port });
        for (const request of requestedEditsForSavedForm(savedForm, await editQueue.pending())) await editQueue.complete(request.requestId);
        checked = null;
      }
      if (await signature() !== checked) {
        const result = await syncCvAliases({ readResumes, readObserved, catalog,
          readRequests: () => editQueue.pending(), onRequestedSaved: change => editQueue.complete(change.requestId),
          onPlan: async (plan) => {
            await writeJson(stateFile.replace(/\.json$/, '.plan.json'), plan);
            await writeState(plan.changes.length ? 'awaiting_user_save' : 'up_to_date', {
              pending: plan.changes.length, next: plan.changes[0] ? { kind: plan.changes[0].kind,
                resumeHash: plan.changes[0].resumeHash, company: plan.changes[0].target.company } : null });
          },
          review: (change) => reviewHhCvChange(page, change, { hhPort: options.port, manualSave: true,
            snapshotsOut: path.resolve('examples'), publish: options.publish, stateFile }, change.resumeHash),
        });
        await writeSnapshots(result.resumes);
        checked = await signature(result.observed);
        await writeState('up_to_date', { pending: 0 });
      }
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  } finally { await session.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error('CV alias sync:', error.message.split('\n')[0]); process.exit(1); });
}
