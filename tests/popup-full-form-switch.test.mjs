/**
 * hh.ru may open the application popup and switch to the full form seconds later (vacancies
 * with questions). The popup steps must stop there instead of waiting for popup elements.
 */
import { describe, test, assert } from 'test-anywhere';
import { processModalApplication } from '../src/vacancies.mjs';

const SEARCH_URL = 'https://hh.ru/search/vacancy?resume=1';
const FULL_FORM_URL = 'https://hh.ru/applicant/vacancy_response?vacancyId=138276367&startedWithQuestion=false';

/** Commander on the popup; the URL switches to the full form after the given action */
function fakeCommander({ switchAfter = null } = {}) {
  let url = SEARCH_URL;
  const actions = [];
  const act = (name, result) => async () => {
    actions.push(name);
    if (name === switchAfter) {
      url = FULL_FORM_URL;
    }
    return result;
  };
  return {
    actions,
    engine: 'playwright',
    getUrl: () => url,
    count: async () => 0,
    isVisible: async () => false,
    evaluate: async () => null,
    safeEvaluate: async () => ({ value: null }),
    findByText: async () => null,
    clickButton: act('clickButton', { clicked: true }),
    fillTextArea: async () => {
      actions.push('fillTextArea');
      throw Object.assign(new Error('waitFor: Timeout 5000ms exceeded.'), { name: 'TimeoutError' });
    },
    wait: async () => {},
  };
}

describe('popup replaced by the full application form', () => {
  test('nothing is done on the full form', async () => {
    const commander = fakeCommander();
    commander.getUrl = () => FULL_FORM_URL;
    const result = await processModalApplication({ commander, MESSAGE: 'Здравствуйте' });
    assert.deepEqual(result, { success: false, reason: 'full_form_opened' });
    assert.deepEqual(commander.actions, []);
  });

  test('a switch after the cover letter toggle stops before typing', async () => {
    const commander = fakeCommander({ switchAfter: 'clickButton' });
    // The toggle is found, so it is clicked; then hh.ru switches to the full form
    commander.findToggleButton = async () => '[data-qa="vacancy-response-letter-toggle"]';
    const result = await processModalApplication({ commander, MESSAGE: 'Здравствуйте' });
    assert.deepEqual(result, { success: false, reason: 'full_form_opened' });
    assert.ok(!commander.actions.includes('fillTextArea'));
  });
});
