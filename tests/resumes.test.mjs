/**
 * Unit tests for resume selection
 */

import { describe, test, assert } from 'test-anywhere';
import { parseUpdatedAt, chooseResume } from '../src/resumes.mjs';

const now = new Date(2026, 9, 9, 12, 0);

describe('parseUpdatedAt()', () => {
  test('parses absolute dates with and without year', () => {
    assert.equal(parseUpdatedAt('Обновлено 5 октября 2026 в 14:30', now), new Date(2026, 9, 5, 14, 30).getTime());
    assert.equal(parseUpdatedAt('обновлено 3 мая', now), new Date(2026, 4, 3).getTime());
    assert.equal(parseUpdatedAt('Обновлено 1 марта 2025', now), new Date(2025, 2, 1).getTime());
  });

  test('parses relative dates', () => {
    assert.equal(parseUpdatedAt('Обновлено сегодня в 9:05', now), new Date(2026, 9, 9, 9, 5).getTime());
    assert.equal(parseUpdatedAt('Обновлено вчера в 23:10', now), new Date(2026, 9, 8, 23, 10).getTime());
  });

  test('returns null without a date', () => {
    assert.equal(parseUpdatedAt('Поднять в поиске', now), null);
  });
});

describe('chooseResume()', () => {
  test('picks the most recently updated resume', () => {
    const resumes = [
      { hash: 'a', updatedText: 'Обновлено 1 октября 2026' },
      { hash: 'b', updatedText: 'Обновлено 7 октября 2026' },
    ];
    assert.equal(chooseResume(resumes).hash, 'b');
  });

  test('keeps hh.ru order when no dates are shown', () => {
    assert.equal(chooseResume([{ hash: 'a', updatedText: null }, { hash: 'b', updatedText: null }]).hash, 'a');
  });

  test('returns undefined for no resumes', () => {
    assert.equal(chooseResume([]), undefined);
  });
});
