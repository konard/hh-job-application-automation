/**
 * Tests for hh.ru's «поменяйте видимость резюме» notice on response forms. Whether it is rendered
 * is decided in the page (findShownNotice: a collapsed hidden-resume-warning block does not count)
 */
import { describe, test, assert } from 'test-anywhere';
import { PassThrough } from 'stream';
import { enableConfirmations } from '../src/confirmations.mjs';
import { isResumeHiddenNoticeShown, waitForVisibleResume } from '../src/resume-visibility.mjs';

/** The page says whether the notice is rendered */
const fakeCommander = (shown) => ({ safeEvaluate: async () => ({ value: shown }) });

describe('resume visibility notice', () => {
  test('is read from the page', async () => {
    assert.equal(await isResumeHiddenNoticeShown(fakeCommander(true)), true);
    assert.equal(await isResumeHiddenNoticeShown(fakeCommander(false)), false);
  });

  test('no notice: the form goes on without asking', async () => {
    assert.equal(await waitForVisibleResume(fakeCommander(false)), 'visible');
  });

  test('the user makes the resume visible, or skips the vacancy', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const visible = waitForVisibleResume(fakeCommander(true), { vacancyId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    input.write('y\n');
    assert.equal(await visible, 'visible');
    const skipped = waitForVisibleResume(fakeCommander(true), { vacancyId: 2 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    input.write('s\n');
    assert.equal(await skipped, 'skip');
  });
});
