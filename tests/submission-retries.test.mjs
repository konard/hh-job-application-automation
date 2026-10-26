import { describe, test, expect } from 'bun:test';
import { createSubmissionRetries, deferFailedSubmission, isPassingError, SUBMISSION_RETRY_MS } from '../src/submission-retries.mjs';
import { waitForButtonsAfterNavigation } from '../src/vacancies.mjs';

const formUrl = 'https://hh.ru/applicant/vacancy_response?vacancyId=138848764&startedWithQuestion=false';
const searchUrl = 'https://hh.ru/search/vacancy?resume=1';

describe('five-hour application retries in RAM', () => {
  test('nothing is due before five hours; repeated observations keep the original deadline', () => {
    let now = 1000;
    const retries = createSubmissionRetries({ now: () => now });
    const entry = retries.defer('138848764', { url: formUrl });
    expect(entry.until).toBe(1000 + 5 * 60 * 60 * 1000);
    now += 60 * 1000;
    expect(retries.defer('138848764').until).toBe(entry.until);
    now = entry.until - 1;
    expect(retries.nextDue()).toBeNull();
    expect(retries.takeDue()).toBeNull();
    expect(retries.ids()).toEqual(['138848764']);
    now += 1;
    expect(retries.takeDue()).toEqual(entry);
    expect(retries.ids()).toEqual([]);
    expect(retries.takeDue()).toBeNull();
    expect(retries.defer('138848764').until).toBe(now + SUBMISSION_RETRY_MS);
    // Another process has a fresh Map; no skip file or external state is used.
    expect(createSubmissionRetries().ids()).toEqual([]);
  });

  test('due vacancies are returned in deadline order and successful ones can be forgotten', () => {
    let now = 0;
    const retries = createSubmissionRetries({ now: () => now });
    retries.defer('1');
    now += 100;
    retries.defer('2');
    retries.defer('3');
    retries.forget('2');
    now += SUBMISSION_RETRY_MS;
    expect(retries.takeDue().vacancyId).toBe('1');
    expect(retries.takeDue().vacancyId).toBe('3');
    expect(retries.nextDue()).toBeNull();
  });

  test('limits, captchas, rate limits and field validation are not generic submission failures', () => {
    for (const error of [null, { code: 'letter-required', text: 'Enter a cover letter' },
      { code: 'captcha', text: 'An error occurred' }, { code: 'unknown', text: 'Too many requests' },
      { code: 'negotiations-limit-exceeded', text: 'Лимит откликов' }]) expect(isPassingError(error)).toBe(false);
  });

  test('answers are saved before leaving a failed full form, including overlapping checks', async () => {
    const calls = [];
    let url = formUrl;
    const retries = createSubmissionRetries({ now: () => 1000 });
    const commander = {
      getUrl: () => url,
      safeEvaluate: async () => ({ value: { code: 'unknown', text: 'An error occurred, please try again' } }),
      goto: async ({ url: next }) => { calls.push('leave'); url = next; },
    };
    const options = { commander, retries, returnUrl: searchUrl, saveAnswers: async () => { calls.push('saved'); } };
    expect(await Promise.all([deferFailedSubmission(options), deferFailedSubmission(options)])).toEqual([true, true]);
    expect(calls).toEqual(['saved', 'leave']);
    expect(retries.get('138848764')).toMatchObject({ url: formUrl, until: 1000 + SUBMISSION_RETRY_MS });
    expect(url).toBe(searchUrl);
  });

  test('a failed save keeps the form and does not silently lose answers', async () => {
    const retries = createSubmissionRetries();
    let left = false;
    const commander = {
      getUrl: () => formUrl,
      safeEvaluate: async () => ({ value: { code: 'unknown', text: 'An error occurred' } }),
      goto: async () => { left = true; },
    };
    await expect(deferFailedSubmission({ commander, retries, returnUrl: searchUrl,
      saveAnswers: async () => { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(left).toBe(false);
    expect(retries.ids()).toEqual([]);
  });

  test('an existing failed form can be deferred before the startup search URL is known', async () => {
    let destination;
    const commander = { getUrl: () => formUrl,
      safeEvaluate: async () => ({ value: { code: 'unknown', text: 'An error occurred' } }),
      goto: async ({ url }) => { expect(url).toMatch(/^https:\/\/hh\.ru\/search\/vacancy/); destination = url; } };
    expect(await deferFailedSubmission({ commander, retries: createSubmissionRetries(), returnUrl: '', saveAnswers: async () => {} })).toBe(true);
    expect(destination).toBe('https://hh.ru/search/vacancy?from=resumelist');
  });

  test('a resolved error during saving is not deferred', async () => {
    let error = { code: 'unknown', text: 'An error occurred' };
    const retries = createSubmissionRetries();
    const commander = { getUrl: () => formUrl, safeEvaluate: async () => ({ value: error }), goto: async () => { throw new Error('must stay'); } };
    expect(await deferFailedSubmission({ commander, retries, returnUrl: searchUrl,
      saveAnswers: async () => { error = null; } })).toBe(false);
    expect(retries.ids()).toEqual([]);
  });

  test('an empty search page wakes up for a due retry', async () => {
    const commander = { getUrl: () => searchUrl, safeEvaluate: async ({ defaultValue }) => ({ value: defaultValue }),
      count: async () => 0, evaluate: async () => null };
    expect(await waitForButtonsAfterNavigation({ commander, pageClosedByUser: () => false, retryDue: () => true }))
      .toEqual({ status: 'retry_due' });
  });
});
