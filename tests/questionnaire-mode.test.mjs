import { describe, test, expect } from 'bun:test';
import { createQuestionnaireMode, skipQuestionnaireForNow } from '../src/questionnaire-mode.mjs';
import { createConfig } from '../src/config.mjs';

const mode = (enabled = true) => createQuestionnaireMode({ enabled, log: () => {} });

describe('optional no-questions mode', () => {
  test('normal runs include questionnaires; only --no-questions enables the optional mode', () => {
    const saved = process.argv;
    try {
      for (const args of [[], ['--no-questions'], ['--questions']]) {
        process.argv = [saved[0], 'apply.mjs', '--message', 'Hello', ...args];
        expect(createConfig().questions).toBe(!args.includes('--no-questions'));
      }
    } finally { process.argv = saved; }
    expect(mode(false).enabled).toBe(false);
  });

  test('RAM skips stay queued while away and become eligible on resume, including across repeated toggles', () => {
    const state = mode();
    state.remember('123', { url: 'https://hh.ru/search/vacancy' });
    expect(state.takeNext()).toBeNull();
    state.setEnabled(false);
    expect(state.takeNext()).toMatchObject({ vacancyId: '123', url: expect.stringContaining('vacancyId=123') });
    state.setEnabled(true);
    state.remember('456');
    expect(state.takeNext()).toBeNull();
    expect(mode(false).ids()).toEqual([]); // A new process/controller inherits no skips.
    state.setEnabled(false);
    expect(state.takeNext().vacancyId).toBe('456');
    expect(state.takeNext()).toBeNull();
  });

  test('only an explicit controlled reload handoff retains the mode and queue', () => {
    const old = mode();
    old.remember('123');
    const normalStart = mode(false);
    expect(normalStart.ids()).toEqual([]);
    expect(normalStart.enabled).toBe(false);
    normalStart.restore(old.snapshot());
    expect(normalStart.ids()).toEqual(['123']);
    expect(normalStart.enabled).toBe(true);
    expect(() => normalStart.restore({ enabled: true, entries: [{ vacancyId: '123', url: 'file:///bad' }] })).toThrow('Invalid');
    expect(normalStart.ids()).toEqual(['123']);
  });

  const fixture = (questions = [{ question: 'Your experience?', currentValue: 'My actual answer' }]) => {
    const calls = [];
    const state = mode();
    let url = 'https://hh.ru/applicant/vacancy_response?vacancyId=999700001';
    const options = { mode: state, vacancyId: '999700001',
      commander: { getUrl: () => url, evaluate: async () => questions },
      readDraft: async () => null,
      saveAnswers: async () => { calls.push('answers'); },
      saveDraft: async () => { calls.push('backup'); },
      leave: async () => { calls.push('leave'); },
    };
    return { options, calls, state, navigate: () => { url = 'https://hh.ru/chat'; } };
  };

  test('all questionnaires, including completely answered ones, save first and skip only in RAM', async () => {
    const f = fixture();
    expect(await skipQuestionnaireForNow(f.options)).toBe(true);
    expect(f.calls).toEqual(['answers', 'backup', 'leave']);
    expect(f.state.ids()).toEqual(['999700001']);
  });

  test('cover-letter-only applications continue normally', async () => {
    const f = fixture([]);
    expect(await skipQuestionnaireForNow(f.options)).toBe(false);
    expect(f.calls).toEqual([]);
    expect(f.state.ids()).toEqual([]);
  });

  test('saving failures and user navigation keep answers safe and never navigate to another vacancy', async () => {
    const f = fixture();
    f.options.saveDraft = async () => { throw new Error('disk full'); };
    await expect(skipQuestionnaireForNow(f.options)).rejects.toThrow('disk full');
    expect(f.calls).toEqual(['answers']);
    expect(f.state.ids()).toEqual([]);
    f.options.saveAnswers = async () => f.navigate();
    expect(await skipQuestionnaireForNow(f.options)).toBe(false);
    expect(f.state.ids()).toEqual([]);
  });

  test('earlier submission errors still require review when questionnaires are revisited', async () => {
    const f = fixture();
    const previous = { vacancyId: f.options.vacancyId, requiresReview: true, error: { code: 'validation', text: 'Review' } };
    f.options.readDraft = async () => previous;
    let preserved;
    f.options.writeDraft = async (draft) => { preserved = draft; };
    expect(await skipQuestionnaireForNow(f.options)).toBe(true);
    expect(preserved).toMatchObject(previous);
  });
});
