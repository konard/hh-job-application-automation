/**
 * Unit tests for resume selection
 */

import { describe, test, assert } from 'test-anywhere';
import {
  parseUpdatedAt,
  chooseResume,
  pickResume,
  parseResumeState,
  resumeStateFromHtml,
  mergeResumeState,
  readResumes,
  latestResumeSearchUrl,
  describeChoice,
} from '../src/resumes.mjs';

const now = new Date(2026, 9, 9, 12, 0);

/** hh.ru's resume list state, shaped like the ResumeProfileFront-InitialState template */
const state = {
  latestResumeHash: 'aaa111',
  applicantResumes: [
    { title: [{ string: 'Senior Developer' }], _attributes: { hash: 'aaa111', updated: Date.UTC(2026, 9, 7, 11, 28, 26, 822), lastEditTime: Date.UTC(2026, 9, 7, 11, 36) } },
    { title: [{ string: 'Software Engineer' }], _attributes: { hash: 'bbb222', updated: Date.UTC(2026, 9, 8, 9, 0), lastEditTime: Date.UTC(2026, 9, 7, 11, 36) } },
    { title: [{ string: 'Old' }], _attributes: { hash: 'ccc333', updated: Date.UTC(2025, 0, 1) } },
  ],
};
const stateText = JSON.stringify(state);

describe('parseUpdatedAt()', () => {
  test('parses absolute dates with and without year', () => {
    assert.equal(parseUpdatedAt('Обновлено 5 октября 2026 в 14:30', now), new Date(2026, 9, 5, 14, 30).getTime());
    assert.equal(parseUpdatedAt('обновлено 3 мая', now), new Date(2026, 4, 3).getTime());
    assert.equal(parseUpdatedAt('Обновлено 1 марта 2025', now), new Date(2025, 2, 1).getTime());
  });

  test('parses the resume export date', () => {
    assert.equal(parseUpdatedAt('Резюме обновлено 7 октября 2026 в 14:28', now), new Date(2026, 9, 7, 14, 28).getTime());
  });

  test('parses relative dates', () => {
    assert.equal(parseUpdatedAt('Обновлено сегодня в 9:05', now), new Date(2026, 9, 9, 9, 5).getTime());
    assert.equal(parseUpdatedAt('Обновлено вчера в 23:10', now), new Date(2026, 9, 8, 23, 10).getTime());
    assert.equal(parseUpdatedAt('Обновлено 5 минут назад', now), now.getTime() - 5 * 60 * 1000);
    assert.equal(parseUpdatedAt('обновлено час назад', now), now.getTime() - 60 * 60 * 1000);
    assert.equal(parseUpdatedAt('Обновлено только что', now), now.getTime());
  });

  test('parses numeric dates and non-breaking spaces', () => {
    assert.equal(parseUpdatedAt('Обновлено 07.10.2026 14:28', now), new Date(2026, 9, 7, 14, 28).getTime());
    assert.equal(parseUpdatedAt('Обновлено 7 октября', now), new Date(2026, 9, 7).getTime());
  });

  test('a date without a year later than today is last year', () => {
    assert.equal(parseUpdatedAt('Обновлено 30 декабря', new Date(2027, 0, 5)), new Date(2026, 11, 30).getTime());
  });

  test('returns null without a date', () => {
    assert.equal(parseUpdatedAt('Поднять в поиске', now), null);
  });
});

describe('parseResumeState()', () => {
  test('reads hash, title, update time and the latest flag', () => {
    const parsed = parseResumeState(stateText);
    assert.equal(parsed.latestHash, 'aaa111');
    assert.deepEqual(parsed.resumes[0], { hash: 'aaa111', title: 'Senior Developer', updatedAt: state.applicantResumes[0]._attributes.updated, latest: true });
    assert.equal(parsed.resumes[2].updatedAt, Date.UTC(2025, 0, 1));
  });

  test('reads HTML-escaped state and ignores other templates', () => {
    assert.equal(parseResumeState(stateText.replace(/"/g, '&quot;')).resumes.length, 3);
    assert.equal(parseResumeState('{"other":1}'), null);
    assert.equal(parseResumeState('{"applicantResumes": broken'), null);
    assert.equal(parseResumeState(null), null);
  });

  test('finds the state in a fetched page', () => {
    const html = `<html><template class="CareerPlatformFront-InitialState">{"a":1}</template><template style="display: none" class="ResumeProfileFront-InitialState">${stateText}</template></html>`;
    assert.equal(resumeStateFromHtml(html), stateText);
    assert.equal(resumeStateFromHtml('<html></html>'), null);
  });
});

describe('pickResume()', () => {
  test('picks the most recently updated resume from hh.ru state and says why', () => {
    const choice = pickResume(parseResumeState(stateText).resumes);
    assert.equal(choice.resume.hash, 'bbb222');
    assert.ok(choice.reason.startsWith('updated 2026-10-'));
    assert.ok(choice.reason.includes('the latest of 3'));
    assert.ok(describeChoice(choice, 3).includes('"Software Engineer" of 3'));
  });

  test('picks the most recently updated resume from visible dates', () => {
    const resumes = [
      { hash: 'a', updatedText: 'Обновлено 1 октября 2026' },
      { hash: 'b', updatedText: 'Обновлено 7 октября 2026' },
    ];
    assert.equal(chooseResume(resumes, { now }).hash, 'b');
  });

  test('equal dates keep the list order', () => {
    assert.equal(chooseResume([{ hash: 'a', updatedAt: 5 }, { hash: 'b', updatedAt: 5 }]).hash, 'a');
  });

  test("uses hh.ru's latest resume when no dates are known", () => {
    const choice = pickResume([{ hash: 'a' }, { hash: 'b', latest: true }]);
    assert.equal(choice.resume.hash, 'b');
    assert.ok(choice.reason.includes('latest'));
  });

  test('keeps hh.ru order when no dates are shown', () => {
    const choice = pickResume([{ hash: 'a', updatedText: null }, { hash: 'b', updatedText: null }]);
    assert.equal(choice.resume.hash, 'a');
    assert.ok(choice.reason.includes('list order'));
  });

  test('returns undefined for no resumes', () => {
    assert.equal(chooseResume([]), undefined);
  });
});

describe('readResumes()', () => {
  test('merges the cards of the page with the dates of the state', async () => {
    const commander = {
      evaluate: async () => ({
        listed: [
          { hash: 'aaa111', title: 'Senior Developer', searchUrl: 'https://hh.ru/search/vacancy?resume=aaa111', updatedText: null },
          { hash: 'bbb222', title: 'Software Engineer', searchUrl: 'https://hh.ru/search/vacancy?resume=bbb222', updatedText: null },
        ],
        stateText,
      }),
    };
    const resumes = await readResumes(commander);
    assert.equal(resumes[1].updatedAt, Date.UTC(2026, 9, 8, 9, 0));
    assert.equal(resumes[0].latest, true);
    assert.equal(chooseResume(resumes).searchUrl, 'https://hh.ru/search/vacancy?resume=bbb222');
  });

  test('without state the cards are used as they are', () => {
    const listed = [{ hash: 'a', updatedText: null }];
    assert.equal(mergeResumeState(listed, null), listed);
  });
});

describe('latestResumeSearchUrl()', () => {
  const page = `<template class="ResumeProfileFront-InitialState">${stateText}</template>`;

  test('switches the resume of an open search page and keeps its filters', async () => {
    const url = await latestResumeSearchUrl({ evaluate: async () => page }, 'https://hh.ru/search/vacancy?resume=aaa111&from=resumelist&work_format=REMOTE');
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('resume'), 'bbb222');
    assert.equal(parsed.searchParams.get('work_format'), 'REMOTE');
  });

  test('keeps the URL when it already shows the latest resume or the list cannot be read', async () => {
    const latest = 'https://hh.ru/search/vacancy?resume=bbb222&from=resumelist';
    assert.equal(await latestResumeSearchUrl({ evaluate: async () => page }, latest), latest);
    const other = 'https://hh.ru/search/vacancy?resume=aaa111';
    assert.equal(await latestResumeSearchUrl({ evaluate: async () => null }, other), other);
    assert.equal(await latestResumeSearchUrl({ evaluate: async () => { throw new Error('closed'); } }, other), other);
  });
});
