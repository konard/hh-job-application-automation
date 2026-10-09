/**
 * Tests for stdin prompts: answers, and prompts withdrawn when the page changes
 */
import { PassThrough } from 'stream';
import { describe, test, assert } from 'test-anywhere';
import { enableConfirmations, waitForUser, withdrawPrompt } from '../src/confirmations.mjs';

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
