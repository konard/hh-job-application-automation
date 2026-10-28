import { describe, test, assert } from 'test-anywhere';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { reviewCvSequence, waitForSavedCvCheckpoint } from '../src/cv-review.mjs';

describe('reviewed CV sequence', () => {
  test('waits for a verified Save, then deselects the original before the next position', async () => {
    const calls = [];
    let save;
    const firstSave = new Promise((resolve) => { save = resolve; });
    const pending = reviewCvSequence([{ kind: 'copy' }, { kind: 'update' }], async (change) => {
      calls.push(change.kind);
      if (change.kind === 'copy') {
        await firstSave;
        return { saved: true, followup: { kind: 'detach' } };
      }
      return { saved: true };
    });
    assert.deepEqual(calls, ['copy']);
    save();
    await pending;
    assert.deepEqual(calls, ['copy', 'detach', 'update']);
  });
  test('an unsaved review cannot advance to another position', async () => {
    const calls = [];
    let error;
    try {
      await reviewCvSequence([{ kind: 'copy' }, { kind: 'update' }], async (change) => {
        calls.push(change.kind);
        return { saved: false };
      });
    } catch (caught) { error = caught; }
    assert.ok(error);
    assert.deepEqual(calls, ['copy']);
  });
  test('an idle/closed marker does not count as a Save', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-review-'));
    const file = path.join(directory, 'checkpoint.json');
    try {
      await fs.writeFile(file, JSON.stringify({ status: 'awaiting_user_save', formOpen: false }));
      let resolved = false;
      const pending = waitForSavedCvCheckpoint(file, { intervalMs: 5 }).then(() => { resolved = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(resolved, false);
      await fs.writeFile(file, JSON.stringify({ status: 'saved_by_user' }));
      await pending;
      assert.equal(resolved, true);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
