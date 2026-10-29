/** One reviewed workplace change, shared by CV import and experience edit/sync. */
import fs from 'fs/promises';
import path from 'path';
import { exportSavedCvs, writeCvSnapshots, publishCvSnapshots } from './cv-store.mjs';
import { prepareHhCvChange, observeHhCvSaves, verifyHhSavedForm, readHhCvForm } from './hh-cv-editor.mjs';
import { normalizeText } from './cv.mjs';
import { alertUser } from './notify.mjs';

/** A closed form is insufficient: require HH.ru's Save return, changed export and matching saved page. */
export function verifiedAboutSaveReturn({ url, resumeHash, change, cv, renderedAbout }) {
  if (change.kind !== 'about' || typeof change.target?.about !== 'string' || !cv) return null;
  const location = new URL(url);
  if (location.pathname !== `/resume/${resumeHash}` || location.searchParams.get('hhtmFrom') !== 'resume_partial_edit') return null;
  const compact = (text) => normalizeText(text).replace(/\s+/g, ' ');
  if (compact(cv.about) === compact(change.target.about) || !compact(renderedAbout).includes(compact(cv.about))) return null;
  return { kind: 'about', resumeHash, url, about: cv.about };
}

/** Resume an earlier detected Save after an export/network failure, retaining exact owner edits. */
async function recoverAboutSave(page, change, argv, resumeHash, directory) {
  if (change.kind !== 'about' || await readHhCvForm(page)) return null;
  const url = new URL(page.url());
  if (url.pathname !== `/resume/${resumeHash}` || url.searchParams.get('hhtmFrom') !== 'resume_partial_edit') return null;
  const renderedAbout = await page.locator('[data-qa="resume-about-card"]').textContent().catch(() => '');
  if (!renderedAbout) return null;
  const resumes = await exportSavedCvs({ port: argv.hhPort });
  const saved = verifiedAboutSaveReturn({ url: url.href, resumeHash, change, cv: resumes.find((resume) => resume.hash === resumeHash)?.cv, renderedAbout });
  if (!saved) return null;
  if (argv.snapshotsOut) {
    const files = await writeCvSnapshots(resumes, argv.snapshotsOut);
    if (argv.publish) await publishCvSnapshots(files);
  }
  const watchDirectory = path.dirname(argv.stateFile ?? 'logs/experience/cv-watch.json');
  await fs.mkdir(watchDirectory, { recursive: true });
  await fs.writeFile(path.join(watchDirectory, 'cv-last-saved.json'), `${JSON.stringify({ at: new Date().toISOString(), kind: 'about',
    resumeHash, company: 'About me', title: resumes.find((resume) => resume.hash === resumeHash).cv.title,
    url: saved.url, verified: true, recovered: true, form: saved }, null, 2)}\n`);
  let checkpoint;
  for (const file of await fs.readdir(directory)) {
    if (!/^\d+\.json$/.test(file)) continue;
    const location = path.join(directory, file);
    const pending = await fs.readFile(location, 'utf8').then(JSON.parse).catch(() => null);
    if (!pending) continue;
    if (['awaiting_user_save', 'verifying_user_save'].includes(pending.status) && pending.resumeHash === resumeHash &&
      pending.change?.kind === 'about' && pending.change.fields.about === change.fields.about) {
      await fs.writeFile(location, `${JSON.stringify({ ...pending, saved, status: 'saved_by_user', recovered: true }, null, 2)}\n`);
      checkpoint = location;
    }
  }
  console.log('💾 Earlier About Save verified from fresh exports; your edits were retained.');
  return { saved: true, followup: null, checkpoint };
}

async function afterSave(argv, form) {
  const resumes = await exportSavedCvs({ port: argv.hhPort });
  const verified = verifyHhSavedForm(form, resumes);
  if (!verified) {
    console.log('↪️  Save not confirmed by the export; the CV change remains pending.');
    return false;
  }
  if (argv.snapshotsOut) {
    const files = await writeCvSnapshots(resumes, argv.snapshotsOut);
    if (argv.publish) {
      await publishCvSnapshots(files);
    }
  }
  return true;
}

/** User input is captured at Save, including edits made after the app prefilled the draft. */
async function waitForBrowserSave(page, argv, checkpoint, pending) {
  console.log('Review this CV change and click Save in the browser. No automatic Save or navigation.');
  let resolve;
  const saved = new Promise((done) => { resolve = done; });
  const stop = await observeHhCvSaves(page, {
    onAttempt: async (form) => {
      await fs.writeFile(checkpoint, `${JSON.stringify({ ...pending, attemptedSave: form, status: 'verifying_user_save' }, null, 2)}\n`);
    },
    onError: (error) => console.error('CV verification retry:', error.message.split('\n')[0]),
    onSaved: async (form) => {
      const verified = await afterSave(argv, form);
      if (verified) {
        resolve(form);
      }
      return verified;
    },
  });
  const endAlert = alertUser({ port: argv.hhPort });
  try {
    return await saved;
  } finally {
    endAlert();
    stop();
  }
}

export async function reviewHhCvChange(page, change, argv, resumeHash) {
  const directory = path.join(process.cwd(), 'logs', 'experience', 'cv-edits');
  await fs.mkdir(directory, { recursive: true });
  const recovered = await recoverAboutSave(page, change, argv, resumeHash, directory);
  if (recovered) return recovered;
  const prepared = await prepareHhCvChange(page, change, { resumeHash, port: argv.hhPort });
  const checkpoint = path.join(directory, `${Date.now()}.json`);
  await fs.writeFile(checkpoint, `${JSON.stringify({ resumeHash, change, ...prepared, status: 'awaiting_user_save' }, null, 2)}\n`);
  prepared.notes.forEach((note) => console.log(`ℹ️  ${note}`));
  if (argv.manualSave !== false) {
    const saved = await waitForBrowserSave(page, argv, checkpoint, { resumeHash, change, ...prepared });
    await fs.writeFile(checkpoint, `${JSON.stringify({ resumeHash, change, ...prepared, saved, status: 'saved_by_user' }, null, 2)}\n`);
    console.log('💾 Saved by you; fresh exports retain your exact changes.');
    if (prepared.followup) {
      const followup = checkpoint.replace(/\.json$/, '.next.json');
      await fs.writeFile(followup, `${JSON.stringify(prepared.followup, null, 2)}\n`);
      console.log(`Next reviewed step: bun run cv -- edit ${followup} --resume ${resumeHash}`);
    }
    return { saved: true, followup: prepared.followup, checkpoint };
  }
  return false;
}

/** Continue only after a verified user save, never from an idle or merely closed browser. */
export async function waitForSavedCvCheckpoint(file, { intervalMs = 1000 } = {}) {
  for (;;) {
    const state = await fs.readFile(file, 'utf8').then(JSON.parse).catch((error) => {
      if (error instanceof SyntaxError) {
        return null; // another process is finishing an atomic-sized checkpoint write
      }
      throw error;
    });
    if (state?.status === 'saved_by_user') {
      return state;
    }
    if (state?.status?.startsWith('discarded') || state?.status === 'cancelled') {
      throw new Error('The preceding CV edit was cancelled; sequence not continued');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Each review promise resolves only after Save was verified. Copies add their deselection step. */
export async function reviewCvSequence(changes, review) {
  const queue = [...changes];
  const saved = [];
  while (queue.length > 0) {
    const change = queue.shift();
    const result = await review(change);
    if (!result?.saved) {
      throw new Error('CV review was not saved; remaining positions left untouched');
    }
    saved.push(change);
    if (result.followup) {
      queue.unshift({ ...result.followup, ...(change.resumeHash ? { resumeHash: change.resumeHash } : {}) });
    }
  }
  return saved;
}
