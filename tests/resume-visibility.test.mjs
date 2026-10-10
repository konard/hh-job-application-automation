/**
 * Tests for hh.ru's «поменяйте видимость резюме» notice on response forms
 */
import { describe, test, assert } from 'test-anywhere';
import { PassThrough } from 'stream';
import { enableConfirmations } from '../src/confirmations.mjs';
import { isResumeHiddenNoticeShown, waitForVisibleResume } from '../src/resume-visibility.mjs';

const NOTICE = 'Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно всем работодателям»';

/** Runs the in-page function on the given text, as the page would */
function fakeCommander(text) {
  globalThis.document = { body: { innerText: text }, querySelector: () => ({ innerText: text }) };
  return { safeEvaluate: async ({ fn, args }) => ({ value: fn(...args) }) };
}

describe('resume visibility notice', () => {
  test('is found in the form text, whatever the case', async () => {
    assert.equal(await isResumeHiddenNoticeShown(fakeCommander(NOTICE.toUpperCase())), true);
    assert.equal(await isResumeHiddenNoticeShown(fakeCommander('Откликнуться')), false);
  });

  test('no notice: the form goes on', async () => {
    assert.equal(await waitForVisibleResume(fakeCommander('Откликнуться')), 'visible');
  });

  test('the user makes the resume visible, or skips the vacancy', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const visible = waitForVisibleResume(fakeCommander(NOTICE), { vacancyId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    input.write('y\n');
    assert.equal(await visible, 'visible');
    const skipped = waitForVisibleResume(fakeCommander(NOTICE), { vacancyId: 2 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    input.write('s\n');
    assert.equal(await skipped, 'skip');
  });
});
