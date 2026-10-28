/** Passive observer of the existing editor. It never opens, fills, closes or saves a form. */
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import { observeHhCvSaves, readHhExperienceForm, verifyHhSavedForm } from './hh-cv-editor.mjs';
import { exportSavedCvs, publishCvSnapshots, writeCvSnapshots } from './cv-store.mjs';

export async function runCvWatch({ hhPort = 9351, out = 'examples', publish = false, once = false, stateFile = 'logs/experience/cv-watch.json' } = {}) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${hhPort}`);
  const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => /hh\.ru\/(resume|profile\/edit\/experience)/.test(candidate.url()));
  if (!page) {
    await browser.close();
    throw new Error(`No existing HH.ru CV editor on port ${hhPort}; no page was changed`);
  }
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  let lastSaved = null;
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
    onSaved: async (form) => {
      queue = queue.catch(() => {}).then(async () => {
        const resumes = await snapshot();
        const verified = verifyHhSavedForm(form, resumes);
        if (!verified) {
          console.log('CV changed on the page, but this Save could not be confirmed in the export; snapshots reflect saved data only.');
          return false;
        }
        lastSaved = { at: new Date().toISOString(), company: form.company, title: form.title, url: form.url, verified: true };
        await fs.writeFile(`${path.dirname(stateFile)}/cv-last-saved.json`, `${JSON.stringify({ ...lastSaved, form }, null, 2)}\n`);
        console.log(`Saved and exported: ${form.company} / ${form.title}. Your exact edits were retained.`);
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
  const poll = async () => {
    try {
      const form = await readHhExperienceForm(page);
      const lastActivity = await page.evaluate(() => window.__hhCvObserver?.lastActivity ?? null);
      await fs.writeFile(stateFile, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), url: page.url(), formOpen: Boolean(form),
        company: form?.company ?? null, title: form?.title ?? null, lastActivity, lastSaved, passive: true }, null, 2)}\n`);
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
    stopObserver();
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
    await browser.close(); // CDP disconnect; the person's browser remains open.
  }
}
