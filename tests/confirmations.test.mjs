/**
 * Tests for stdin prompts: answers, and prompts withdrawn when the page changes
 */
import { PassThrough } from 'stream';
import { describe, test, assert } from 'test-anywhere';
import { askUser, enableConfirmations, waitForUser, withdrawPrompt } from '../src/confirmations.mjs';

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
