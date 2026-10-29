/** Passive observer of the existing editor. It never opens, fills, closes or saves a form. */
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import { observeHhCvSaves, readHhCvForm, verifyHhSavedForm } from './hh-cv-editor.mjs';
import { exportSavedCvs, publishCvSnapshots, writeCvSnapshots } from './cv-store.mjs';
import { alertUntilDone } from './notify.mjs';

export async function runCvWatch({ hhPort = 9351, out = 'examples', publish = false, once = false, stateFile = 'logs/experience/cv-watch.json' } = {}) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${hhPort}`);
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => /hh\.ru\/(resume|profile\/edit\/experience)/.test(candidate.url()));
  if (!page) {
    await browser.close();
    throw new Error(`No existing HH.ru CV editor on port ${hhPort}; no page was changed`);
  }
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  let lastSaved = await fs.readFile(`${path.dirname(stateFile)}/cv-last-saved.json`, 'utf8').then(JSON.parse).catch(() => null);
  let stopped = false;
  let queue = Promise.resolve();
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const snapshot = async () => {
    const resumes = await exportSavedCvs({ port: hhPort });
    const files = await writeCvSnapshots(resumes, path.resolve(out));
    if (publish) {
      await publishCvSnapshots(files);
    }
    return resumes;
  };
  const stopObserver = await observeHhCvSaves(page, {
    onAttempt: async (form) => {
      await fs.writeFile(`${path.dirname(stateFile)}/cv-last-save-attempt.json`, `${JSON.stringify({ at: new Date().toISOString(), form, verificationPending: true }, null, 2)}\n`);
    },
    onSaved: async (form) => {
      queue = queue.catch(() => {}).then(async () => {
        const resumes = await snapshot();
        const verified = verifyHhSavedForm(form, resumes);
        if (!verified) {
          console.log('CV changed on the page, but this Save could not be confirmed in the export; snapshots reflect saved data only.');
          return false;
        }
        const company = form.kind === 'about' ? 'About me' : form.company;
        const title = form.kind === 'about' ? resumes.find((resume) => resume.hash === form.resumeHash)?.cv.title : form.title;
        lastSaved = { at: new Date().toISOString(), kind: form.kind ?? 'workplace', resumeHash: form.resumeHash, company, title, url: form.url, verified: true };
        await fs.writeFile(`${path.dirname(stateFile)}/cv-last-saved.json`, `${JSON.stringify({ ...lastSaved, form }, null, 2)}\n`);
        await fs.writeFile(`${path.dirname(stateFile)}/cv-last-save-attempt.json`, `${JSON.stringify({ at: lastSaved.at, form, verificationPending: false, verified: true }, null, 2)}\n`);
        console.log(`Saved and exported: ${company} / ${title}. Your exact edits were retained.`);
        if (once) {
          done();
        }
        return true;
      });
      return queue;
    },
    onError: (error) => console.error('CV watch:', error.message.split('\n')[0]),
  });
  const onStop = () => { stopped = true; done(); };
  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);
  let timer;
  let endAlert = () => {};
  const poll = async () => {
    try {
      const form = await readHhCvForm(page);
      if (form) endAlert = alertUntilDone(page, { port: hhPort, isDone: async () => !await readHhCvForm(page) });
      else endAlert();
      const lastActivity = await page.evaluate(() => window.__hhCvObserver?.lastActivity ?? null);
      await fs.writeFile(stateFile, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), url: page.url(), formOpen: Boolean(form),
        kind: form?.kind ?? (form ? 'workplace' : null), resumeHash: form?.resumeHash,
        company: form?.kind === 'about' ? 'About me' : form?.company ?? null, title: form?.title ?? null, lastActivity, lastSaved, passive: true }, null, 2)}\n`);
    } catch (error) {
      console.error('CV watch:', error.message.split('\n')[0]);
    }
    if (!stopped) {
      timer = setTimeout(poll, 2000);
    }
  };
  try {
    console.log(`Watching HH.ru CV edits on port ${hhPort}; no clicks or navigation. Saved snapshots → ${out}`);
    await poll();
    await finished;
    stopped = true;
    clearTimeout(timer);
    await queue;
  } finally {
    endAlert();
    stopObserver();
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
    await browser.close(); // CDP disconnect; the person's browser remains open.
  }
}
