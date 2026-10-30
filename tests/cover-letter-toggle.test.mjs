import { describe, test, assert } from 'test-anywhere';
import { prepareCoverLetterTextarea } from '../src/vacancy-response.mjs';
import { SELECTORS } from '../src/hh-selectors.mjs';

/** A form whose letter toggle opens the field only after the given number of clicks */
function fakeForm({ opensOnClick }) {
  let clicks = 0;
  const open = () => clicks >= opensOnClick;
  const has = (selector) => (selector === SELECTORS.coverLetterToggle ? !open() : selector === SELECTORS.coverLetterTextareaPopup && open());
  return {
    clicks: () => clicks,
    commander: {
      count: async ({ selector }) => (has(selector) ? 1 : 0),
      isVisible: async ({ selector }) => has(selector),
      findToggleButton: async ({ dataQaSelectors }) => (dataQaSelectors?.includes(SELECTORS.coverLetterToggle) && !open() ? SELECTORS.coverLetterToggle : null),
      clickButton: async () => { clicks += 1; },
      wait: async () => {},
      waitForSelector: async ({ selector }) => { if (!has(selector)) throw new Error('timeout'); return true; },
    },
  };
}

describe('cover letter toggle', () => {
  test('a click lost on a page still loading is made again', async () => {
    const form = fakeForm({ opensOnClick: 2 });
    assert.equal(await prepareCoverLetterTextarea({ commander: form.commander }), SELECTORS.coverLetterTextareaPopup);
    assert.equal(form.clicks(), 2);
  });

  test('the toggle is clicked once when it opens the field', async () => {
    const form = fakeForm({ opensOnClick: 1 });
    assert.equal(await prepareCoverLetterTextarea({ commander: form.commander }), SELECTORS.coverLetterTextareaPopup);
    assert.equal(form.clicks(), 1);
  });

  test('a delayed inline expansion is awaited without clicking the toggle again', async () => {
    const form = fakeForm({ opensOnClick: 1 });
    let ready = false;
    const options = [];
    form.commander.isVisible = async ({ selector }) => ready && selector === SELECTORS.coverLetterTextareaPopup;
    form.commander.clickButton = async (value) => { options.push(value); };
    form.commander.count = async ({ selector }) => Number(selector === SELECTORS.coverLetterToggle ||
      (ready && selector === SELECTORS.coverLetterTextareaPopup));
    form.commander.wait = async () => { ready = true; };
    form.commander.waitForSelector = async ({ selector }) => {
      if (!ready || selector !== SELECTORS.coverLetterTextareaPopup) throw new Error('not ready');
    };
    assert.equal(await prepareCoverLetterTextarea({ commander: form.commander }), SELECTORS.coverLetterTextareaPopup);
    assert.equal(options.length, 1);
    assert.equal(options[0].waitForNavigation, false);
    assert.equal(options[0].scrollIntoView, true);
  });

  test('a toggle that never opens is clicked at most three times', async () => {
    const form = fakeForm({ opensOnClick: 99 });
    assert.equal(await prepareCoverLetterTextarea({ commander: form.commander }), null);
    assert.equal(form.clicks(), 3);
  });
});
