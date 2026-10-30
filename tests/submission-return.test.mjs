import { describe, test, assert } from 'test-anywhere';
import { checkAndRedirectIfNeeded } from '../src/page-handlers.mjs';
import { registerPageTriggers } from '../src/page-triggers.mjs';

const VACANCY = 'https://hh.ru/vacancy/139011384';
const FORM = 'https://hh.ru/applicant/vacancy_response?vacancyId=139011384';
const SEARCH = 'https://hh.ru/search/vacancy?resume=ru&page=1';

function fixture({ submitted = true, clicked = false } = {}) {
  const state = { url: VACANCY, gotos: [], callbacks: 0 };
  const actions = new Map();
  const commander = {
    getUrl: () => state.url,
    evaluate: async () => false,
    safeEvaluate: async ({ operationName }) => ({ value: operationName === 'apply click listener' || submitted }),
    checkAndClearFlag: async () => clicked,
    goto: async ({ url }) => { state.gotos.push(url); state.url = url; },
    pageTrigger: (action) => { actions.set(action.name, action); return () => {}; },
    onUrlChange: (handler) => { state.onUrlChange = handler; },
  };
  return { state, commander, actions };
}

describe('leaving a confirmed application', () => {
  test('an already-counted native Send returns to search instead of repeatedly detecting success', async () => {
    const { state, commander } = fixture();
    const onApplicationSent = async () => { state.callbacks++; return false; };
    for (let i = 0; i < 4; i++) {
      const handled = await checkAndRedirectIfNeeded({ commander, isOnVacancyPageFromResponse: true, returnUrl: SEARCH, onApplicationSent });
      assert.equal(handled, i === 0);
    }
    assert.equal(state.callbacks, 1, 'The same sent application must not be repeatedly processed');
    assert.deepEqual(state.gotos, [SEARCH]);
  });

  test('an Apply click without confirmation cannot count or leave the vacancy', async () => {
    const { state, commander } = fixture({ submitted: false, clicked: true });
    assert.equal(await checkAndRedirectIfNeeded({ commander, isOnVacancyPageFromResponse: true, returnUrl: SEARCH,
      onApplicationSent: async () => assert.fail('Not confirmed') }), false);
    assert.deepEqual(state.gotos, []);
  });

  test('a callback that already navigated never causes a second navigation or overwrites a new form', async () => {
    for (const next of [SEARCH, 'https://hh.ru/applicant/vacancy_response?vacancyId=777']) {
      const { state, commander } = fixture();
      assert.equal(await checkAndRedirectIfNeeded({ commander, isOnVacancyPageFromResponse: true, returnUrl: SEARCH,
        onApplicationSent: async () => { state.url = next; return false; } }), true);
      assert.equal(state.url, next);
      assert.deepEqual(state.gotos, []);
    }
  });

  test('the native vacancy-page trigger also leaves an already-counted confirmation exactly once', async () => {
    const { state, commander, actions } = fixture();
    const cleanup = registerPageTriggers({ commander, getReturnUrl: () => SEARCH,
      onApplicationSubmitted: async () => { state.callbacks++; return false; } });
    state.onUrlChange({ previousUrl: SEARCH, newUrl: FORM });
    const action = () => actions.get('vacancy-page').action({ url: VACANCY, isStopped: () => false, wait: async () => {} });
    try {
      await action();
      await action();
      assert.equal(state.callbacks, 1);
      assert.deepEqual(state.gotos, [SEARCH]);
    } finally { cleanup(); }
  });

  test('the page trigger preserves another form opened during the success callback', async () => {
    const { state, commander, actions } = fixture();
    const next = 'https://hh.ru/applicant/vacancy_response?vacancyId=777';
    const cleanup = registerPageTriggers({ commander, getReturnUrl: () => SEARCH,
      onApplicationSubmitted: async () => { state.url = next; return false; } });
    state.onUrlChange({ previousUrl: SEARCH, newUrl: FORM });
    try {
      await actions.get('vacancy-page').action({ url: VACANCY, isStopped: () => false, wait: async () => {} });
      assert.equal(state.url, next);
      assert.deepEqual(state.gotos, []);
    } finally { cleanup(); }
  });
});
