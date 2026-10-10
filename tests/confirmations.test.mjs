/**
 * Tests for stdin prompts: answers, and prompts withdrawn when the page changes
 */
import { PassThrough } from 'stream';
import { describe, test, assert } from 'test-anywhere';
import {
  askUser, decideSend, disableConfirmations, enableConfirmations, waitForUser, withConfirmations, withdrawPrompt,
} from '../src/confirmations.mjs';
import { SELECTORS } from '../src/hh-selectors.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('waitForUser', () => {
  test('y confirms', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const answer = waitForUser('Send?');
    input.write('y\n');
    assert.equal(await answer, true);
  });

  test('a withdrawn prompt returns false and does not take the next answer', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const stale = waitForUser('Send the first form?');
    await tick();
    withdrawPrompt();
    assert.equal(await stale, false);

    let staleAnswered = false;
    stale.then(() => {
      staleAnswered = true;
    });
    const next = waitForUser('Send the second form?');
    input.write('y\n');
    assert.equal(await next, true);
    assert.equal(staleAnswered, true); // resolved earlier, with false
  });

  test('withdrawing reaches every waiting prompt', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const first = waitForUser('First?');
    const second = waitForUser('Second?');
    await tick();
    withdrawPrompt();
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
  });
});

describe('askUser', () => {
  test('s skips when skipping is offered', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const answer = askUser('Answer the open questions', { skip: 'skip this vacancy' });
    input.write('s\n');
    assert.equal(await answer, 'skip');
  });

  test('s is ignored when skipping is not offered', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const answer = askUser('Send?');
    input.write('s\ny\n');
    assert.equal(await answer, 'continue');
  });

  test('a withdrawn prompt says so', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const answer = askUser('Answer the open questions', { skip: 'skip this vacancy' });
    await tick();
    withdrawPrompt();
    assert.equal(await answer, 'withdrawn');
  });
});

describe('answers typed for a withdrawn prompt', () => {
  test('do not confirm the next prompt', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const first = waitForUser('Send the first form?');
    await tick();
    withdrawPrompt(); // the form was sent in the browser
    assert.equal(await first, false);
    input.write('y\n'); // the answer to the first form arrives late
    await tick();

    let confirmed = false;
    const next = waitForUser('Send the second form?').then((answer) => {
      confirmed = answer;
    });
    await tick();
    assert.equal(confirmed, false);
    input.write('y\n'); // a fresh answer to the second form
    await next;
    assert.equal(confirmed, true);
  });
});

describe('sending a form with questions', () => {
  /** Full form with questions; records clicks */
  const fakeForm = () => {
    const clicks = [];
    return {
      clicks,
      getUrl: () => 'https://hh.ru/applicant/vacancy_response?vacancyId=1',
      evaluate: async () => true,
      wait: async () => {},
      clickButton: async (options) => clicks.push(options),
    };
  };

  test('asks first', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const form = fakeForm();
    const click = withConfirmations(form).clickButton({ selector: SELECTORS.submitButtonLetter });
    await tick();
    assert.deepEqual(form.clicks, []);
    input.write('y\n');
    await click;
    assert.equal(form.clicks.length, 1);
  });

  test('is sent right away when every answer is exact, without passing the flag on', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['send'], onStop: () => {}, input });
    const form = fakeForm();
    await withConfirmations(form).clickButton({ selector: SELECTORS.submitButtonLetter, autoSend: true });
    assert.deepEqual(form.clicks, [{ selector: SELECTORS.submitButtonLetter }]);
  });
});

describe('decideSend: the exact-answer rule in every --confirm mode', () => {
  test('unattended (--confirm none): only a form without questions or with exact answers is sent', async () => {
    disableConfirmations();
    assert.equal(await decideSend({ hasQuestions: false, autoSend: false }), 'send');
    assert.equal(await decideSend({ hasQuestions: true, autoSend: true }), 'send');
    assert.equal(await decideSend({ hasQuestions: true, autoSend: false }), 'wait');
    // Only the explicit --auto-submit-vacancy-response-form sends it
    assert.equal(await decideSend({ hasQuestions: true, autoSend: false, autoSubmit: true }), 'send');
  });

  test('with --confirm send the send click itself asks', async () => {
    enableConfirmations({ steps: ['send'], onStop: () => {}, input: new PassThrough() });
    assert.equal(await decideSend({ hasQuestions: true, autoSend: false }), 'send');
    disableConfirmations();
  });

  test('without it, a form with a non-exact answer is asked about here', async () => {
    const input = new PassThrough();
    enableConfirmations({ steps: ['answers'], onStop: () => {}, input });
    const decision = decideSend({ hasQuestions: true, autoSend: false, autoSubmit: true, skip: 'skip this vacancy' });
    await tick();
    input.write('s\n');
    assert.equal(await decision, 'skip');
    disableConfirmations();
  });
});
