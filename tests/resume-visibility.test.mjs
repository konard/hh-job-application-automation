/**
 * Tests for hh.ru's «поменяйте видимость резюме» notice on response forms. Whether it is rendered
 * is decided in the page (findShownNotice: a collapsed hidden-resume-warning block does not count)
 */
import { describe, test, assert } from 'test-anywhere';
import { isResumeHiddenNoticeShown, resumeVisibility } from '../src/resume-visibility.mjs';

/** The page says whether the notice is rendered */
const fakeCommander = (shown) => ({ safeEvaluate: async () => ({ value: shown }) });

describe('resume visibility notice', () => {
  test('is read from the page', async () => {
    assert.equal(await isResumeHiddenNoticeShown(fakeCommander(true)), true);
    assert.equal(await isResumeHiddenNoticeShown(fakeCommander(false)), false);
  });

  test('no notice: the form goes on', async () => {
    assert.equal(await resumeVisibility(fakeCommander(false)), 'visible');
  });

  test('the notice: the vacancy is skipped without asking', async () => {
    assert.equal(await resumeVisibility(fakeCommander(true), { vacancyId: 2 }), 'skip');
  });
});
