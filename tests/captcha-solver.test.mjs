/**
 * Tests for the captcha prefill: answer cleanup, combining two guesses, the Luna model choice,
 * and that the field is only filled while empty and never sent
 */
import { describe, test, assert } from 'test-anywhere';
import {
  cleanAnswer, combineAnswers, createCaptchaPrefill, latestLunaModel, solveCaptchaImage,
} from '../src/captcha-solver.mjs';
import { waitWhileCaptcha } from '../src/captcha.mjs';

describe('cleanAnswer', () => {
  test('keeps the text of the last line, without quotes or a final period', () => {
    assert.equal(cleanAnswer('Here it is:\n"x7kQp".\n'), 'x7kQp');
  });

  test('Cyrillic captchas are answers too', () => {
    assert.equal(cleanAnswer('жук42'), 'жук42');
  });

  test('a refusal or an explanation is no answer', () => {
    assert.equal(cleanAnswer('I can’t help solve CAPTCHAs.'), null);
    assert.equal(cleanAnswer('The text is unclear'), null);
  });

  test('an empty reply is no answer', () => {
    assert.equal(cleanAnswer('  \n'), null);
    assert.equal(cleanAnswer(null), null);
  });
});

describe('combineAnswers', () => {
  test('the same answer is prefilled once', () => {
    assert.equal(combineAnswers(['x7kQp', 'X7KQP']), 'x7kQp');
  });

  test('different answers are both prefilled, Haiku first', () => {
    assert.equal(combineAnswers(['x7kQp', 'x7kOp']), 'x7kQp|x7kOp');
  });

  test('a failed reader leaves the other answer', () => {
    assert.equal(combineAnswers([null, 'x7kOp']), 'x7kOp');
    assert.equal(combineAnswers([null, null]), null);
  });
});

describe('latestLunaModel', () => {
  test('picks the newest Luna version', () => {
    const catalog = JSON.stringify({ models: [
      { slug: 'gpt-5.6-luna' }, { slug: 'gpt-6.1-sol' }, { slug: 'gpt-6-luna' }, { slug: 'gpt-5.10-luna' },
    ] });
    assert.equal(latestLunaModel(catalog), 'gpt-6-luna');
  });

  test('6.1 is newer than 6', () => {
    assert.equal(latestLunaModel('"slug":"gpt-6-luna" "slug":"gpt-6.1-luna"'), 'gpt-6.1-luna');
  });

  test('no Luna in the catalog', () => {
    assert.equal(latestLunaModel('"slug":"gpt-6.1-sol"'), null);
  });
});

describe('solveCaptchaImage', () => {
  test('asks both readers about the same image file', async () => {
    const seen = [];
    const reader = (answer) => async (dir) => {
      seen.push(dir);
      return answer;
    };
    const result = await solveCaptchaImage(Buffer.from('png'), { claude: reader('ab12'), codex: reader('ab13') });
    assert.equal(result.text, 'ab12|ab13');
    assert.equal(seen[0], seen[1]);
  });
});

/** Commander and page with one captcha image and its answer field */
function fakeCaptchaPage({ src = 'https://hh.ru/captcha?key=1', value = '', focused = false } = {}) {
  const form = { src, value, focused };
  const fills = [];
  const commander = {
    form,
    fills,
    safeEvaluate: async () => ({ value: { ...form } }),
    fillTextArea: async ({ text, checkEmpty }) => {
      fills.push({ text, checkEmpty });
      form.value = text;
      return { filled: true };
    },
  };
  const page = { $$: async () => [{ boundingBox: async () => ({ width: 100 }), screenshot: async () => Buffer.from('png') }] };
  return { commander, page };
}

describe('createCaptchaPrefill', () => {
  test('types the guess into the empty field and does nothing else', async () => {
    const { commander, page } = fakeCaptchaPage();
    const prefill = createCaptchaPrefill({ page, solve: async () => ({ haiku: 'ab12', luna: 'ab13', model: 'gpt-6-luna', text: 'ab12|ab13' }) });
    await prefill(commander);
    assert.deepEqual(commander.fills, [{ text: 'ab12|ab13', checkEmpty: true }]);
    assert.deepEqual(Object.keys(commander).filter((key) => /click|press|submit|goto/i.test(key)), []);
  });

  test('each captcha image is read once', async () => {
    const { commander, page } = fakeCaptchaPage();
    let solved = 0;
    const prefill = createCaptchaPrefill({ page, solve: async () => ({ text: `guess${++solved}` }) });
    await prefill(commander);
    commander.form.value = '';
    await prefill(commander);
    assert.equal(solved, 1);
    commander.form.src = 'https://hh.ru/captcha?key=2';
    await prefill(commander);
    assert.equal(solved, 2);
  });

  test('what the user types is left alone', async () => {
    for (const form of [{ value: 'my answer' }, { focused: true }]) {
      const { commander, page } = fakeCaptchaPage(form);
      const prefill = createCaptchaPrefill({ page, solve: async () => ({ text: 'ab12' }) });
      await prefill(commander);
      assert.deepEqual(commander.fills, []);
    }
  });

  test('typing during the guess cancels the prefill', async () => {
    const { commander, page } = fakeCaptchaPage();
    const prefill = createCaptchaPrefill({ page, solve: async () => {
      commander.form.focused = true;
      return { text: 'ab12' };
    } });
    await prefill(commander);
    assert.deepEqual(commander.fills, []);
  });
});

describe('waitWhileCaptcha with a prefill', () => {
  test('the prefill runs while the captcha is shown and does not hold the wait', async () => {
    let left = 3;
    const commander = { getUrl: () => 'https://hh.ru/search/vacancy', safeEvaluate: async () => ({ value: left-- > 0 }) };
    let calls = 0;
    const solved = await waitWhileCaptcha(commander, { pollMs: 1, onCaptcha: () => {
      calls++;
      return new Promise(() => {});
    } });
    assert.equal(solved, true);
    assert.ok(calls >= 1);
  });
});
