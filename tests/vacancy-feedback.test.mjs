import { describe, test, expect } from 'bun:test';
import { observeVacancyFeedback } from '../src/vacancy-feedback.mjs';

function fixture(run, { visible = true, otherSelected = false, hostname = 'hh.ru', present = true } = {}) {
  const before = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  let clicks = 0, closes = 0, disconnected = 0, observe = () => {}, shown = present;
  const option = { checked: false, click() { this.checked = true; clicks += 1; } };
  const other = { checked: otherSelected };
  const dialog = {
    getClientRects: () => visible ? [{}] : [],
    querySelector: () => option,
    querySelectorAll: () => [option, other],
  };
  const close = { closest: () => dialog, isConnected: true, click: () => { closes += 1; } };
  try {
    globalThis.window = { location: { hostname } };
    globalThis.document = { documentElement: {}, querySelector: () => shown ? close : null };
    globalThis.MutationObserver = class {
      constructor(callback) { observe = callback; }
      observe() {}
      disconnect() { disconnected += 1; }
    };
    window.MutationObserver = globalThis.MutationObserver;
    run({ mutate: () => observe(), show: () => { shown = true; }, stats: () => ({ clicks, closes, disconnected }) });
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

describe('viewed-vacancy feedback', () => {
  test('defaults to Maybe Later, closes only this survey, and does not answer twice', () => fixture(({ mutate, stats }) => {
    observeVacancyFeedback();
    mutate();
    expect(stats()).toMatchObject({ clicks: 1, closes: 1 });
  }));

  test('also answers a survey that arrives while the application is waiting', () => fixture(({ show, mutate, stats }) => {
    observeVacancyFeedback();
    expect(stats().clicks).toBe(0);
    show(); mutate();
    expect(stats()).toMatchObject({ clicks: 1, closes: 1 });
  }, { present: false }));

  test('disabled mode makes no selection and disconnects an existing observer', () => fixture(({ stats }) => {
    observeVacancyFeedback();
    observeVacancyFeedback(false);
    expect(stats().disconnected).toBe(1);
    expect(window.__hhVacancyFeedback).toBeUndefined();
    observeVacancyFeedback(false);
    expect(stats().clicks).toBe(1);
  }));

  test('starting disabled leaves the prompt unanswered', () => fixture(({ mutate, stats }) => {
    observeVacancyFeedback(false); mutate();
    expect(stats()).toMatchObject({ clicks: 0, closes: 0 });
  }));

  test('hidden surveys, other sites and user-selected reasons stay untouched', () => {
    for (const options of [{ visible: false }, { hostname: 'other.example' }, { otherSelected: true }]) {
      fixture(({ mutate, stats }) => { observeVacancyFeedback(); mutate(); expect(stats().clicks).toBe(0); }, options);
    }
  });
});
