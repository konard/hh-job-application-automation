/** One reviewed workplace change, shared by CV import and experience edit/sync. */
import fs from 'fs/promises';
import path from 'path';
import { exportSavedCvs, writeCvSnapshots, publishCvSnapshots } from './cv-store.mjs';
import { prepareHhCvChange, observeHhCvSaves, verifyHhSavedForm } from './hh-cv-editor.mjs';

async function afterSave(argv, form) {
  const resumes = await exportSavedCvs({ port: argv.hhPort });
  const verified = verifyHhSavedForm(form, resumes);
  if (!verified) {
    console.log('↪️  Save not confirmed by the export; the position remains pending.');
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
async function waitForBrowserSave(page, argv) {
  console.log('Review this position and click Save in the browser. No automatic Save or navigation.');
  let resolve;
  const saved = new Promise((done) => { resolve = done; });
  const stop = await observeHhCvSaves(page, {
    onSaved: async (form) => {
      const verified = await afterSave(argv, form);
      if (verified) {
        resolve(form);
      }
      return verified;
    },
  });
  try {
    return await saved;
  } finally {
    stop();
  }
}

export async function reviewHhCvChange(page, change, argv, resumeHash) {
  const prepared = await prepareHhCvChange(page, change, { resumeHash, port: argv.hhPort });
  const directory = path.join(process.cwd(), 'logs', 'experience', 'cv-edits');
  await fs.mkdir(directory, { recursive: true });
  const checkpoint = path.join(directory, `${Date.now()}.json`);
  await fs.writeFile(checkpoint, `${JSON.stringify({ resumeHash, change, ...prepared, status: 'awaiting_user_save' }, null, 2)}\n`);
  prepared.notes.forEach((note) => console.log(`ℹ️  ${note}`));
  if (argv.manualSave !== false) {
    const saved = await waitForBrowserSave(page, argv);
    await fs.writeFile(checkpoint, `${JSON.stringify({ resumeHash, change, ...prepared, saved, status: 'saved_by_user' }, null, 2)}\n`);
    console.log('💾 Saved by you; fresh exports retain your exact changes.');
    if (prepared.followup) {
      const followup = checkpoint.replace(/\.json$/, '.next.json');
      await fs.writeFile(followup, `${JSON.stringify(prepared.followup, null, 2)}\n`);
      console.log(`Next reviewed step: bun run cv -- edit ${followup} --resume ${resumeHash}`);
    }
    return true;
  }
  return false;
}
