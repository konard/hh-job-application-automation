import { describe, test, expect } from 'bun:test';
import { processModalApplication } from '../src/vacancies.mjs';
import { clickButtonWhenReady } from '../src/helpers/page-helpers.mjs';
import { SELECTORS } from '../src/hh-selectors.mjs';

const letter = 'Здравствуйте! Мой опыт подходит для этой вакансии.';
const failed = { status: 'failed', dispatched: false, clicked: false, reason: 'button covered by feedback overlay' };
const dispatched = { status: 'unverified', dispatched: true, clicked: true };

function fixture({ blockedToggles = 0, noToggleEffect = false, fillFails = false, initialText = '', blockedSends = 0 } = {}) {
  const state = { open: Boolean(initialText), text: initialText, toggles: 0, fills: 0, sends: 0, delivered: 0 };
  const commander = {
    engine: 'playwright',
    getUrl: () => 'https://hh.ru/search/vacancy?resume=1',
    count: async ({ selector }) => selector === SELECTORS.submitButtonPopup ? 1
      : selector.includes('textarea') && state.open ? 1 : 0,
    isVisible: async () => state.open,
    isEnabled: async () => true,
    findToggleButton: async () => SELECTORS.addCoverLetterButton,
    safeEvaluate: async ({ operationName, defaultValue }) => ({
      value: operationName === 'responded vacancy check' ? state.delivered > 0 : defaultValue ?? false,
    }),
    evaluate: async ({ args }) => args?.[0] === SELECTORS.coverLetterTextareaPopup ? state.open ? state.text : null
      : args?.[0] === SELECTORS.applicationForm ? { totalCount: 0, unansweredCount: 0 } : [],
    fillTextArea: async ({ text }) => {
      state.fills += 1;
      if (fillFails || state.text) return { filled: false };
      state.text = text;
      return { filled: true, verified: true };
    },
    clickButton: async ({ selector }) => {
      if (selector === SELECTORS.addCoverLetterButton) {
        state.toggles += 1;
        if (state.toggles <= blockedToggles) return failed;
        if (!noToggleEffect) state.open = true;
        return dispatched;
      }
      if (selector === SELECTORS.submitButtonPopup) {
        state.sends += 1;
        if (state.sends <= blockedSends) return failed;
        state.delivered += 1;
        return dispatched;
      }
    },
    wait: async () => {},
  };
  return { state, run: () => processModalApplication({ commander, MESSAGE: letter, vacancyId: '123' }) };
}

describe('recovering blocked application popup actions', () => {
  test('a blocked toggle is retried; the field is filled before a single real submit', async () => {
    const { state, run } = fixture({ blockedToggles: 1, blockedSends: 1 });
    expect(await run()).toEqual({ success: true });
    expect(state).toMatchObject({ text: letter, toggles: 2, fills: 1, sends: 2, delivered: 1 });
  });

  test('a cover-letter field that never opens is not mistaken for an existing filled field', async () => {
    for (const options of [{ blockedToggles: 10 }, { noToggleEffect: true }]) {
      const { state, run } = fixture(options);
      expect(await run()).toEqual({ success: false, reason: 'cover_letter_unavailable' });
      expect(state).toMatchObject({ toggles: 3, fills: 0, sends: 0, delivered: 0 });
    }
  });

  test('a silent failed fill or a partial saved letter cannot reach submit', async () => {
    for (const options of [{ fillFails: true }, { initialText: letter.slice(0, 15) }]) {
      const { state, run } = fixture(options);
      expect(await run()).toEqual({ success: false, reason: 'cover_letter_unverified' });
      expect(state.sends).toBe(0);
    }
  });

  test('the user’s different cover letter remains untouched', async () => {
    const { state, run } = fixture({ initialText: 'Мой собственный текст для этой компании.' });
    expect(await run()).toEqual({ success: true });
    expect(state.text).toBe('Мой собственный текст для этой компании.');
    expect(state.delivered).toBe(1);
  });

  test('an unavailable submit button does not produce a false clicked/sent result', async () => {
    const { state, run } = fixture({ blockedSends: 10 });
    expect(await run()).toEqual({ success: false, reason: 'submit_not_clicked' });
    expect(state).toMatchObject({ sends: 3, delivered: 0 });
  });

  test('an uncertain dispatched send is never clicked again', async () => {
    let clicks = 0;
    expect(await clickButtonWhenReady({ clickButton: async () => { clicks += 1; return dispatched; } }, {})).toBe(dispatched);
    expect(clicks).toBe(1);
  });

  test('a navigation interrupt cannot retry a submit on a different form', async () => {
    let clicks = 0, url = 'https://hh.ru/search/vacancy';
    const result = await clickButtonWhenReady({
      getUrl: () => url,
      clickButton: async () => { clicks += 1; url = 'https://hh.ru/applicant/vacancy_response?vacancyId=123'; return { ...failed, navigated: true }; },
    }, {});
    expect(result.dispatched).toBe(false);
    expect(clicks).toBe(1);
  });
});
