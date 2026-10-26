import { describe, test, assert } from 'test-anywhere';
import { HH_SESSION_PORTS, pageSignInState } from '../src/login.mjs';

const fakePage = (url, state) => ({ url: () => url, evaluate: async () => state });

describe('hh.ru login shared between windows', () => {
  test('a page tells whether it is signed in, without loading anything', async () => {
    assert.equal(await pageSignInState(fakePage('https://hh.ru/chat', 'in')), 'in');
    assert.equal(await pageSignInState(fakePage('https://hh.ru/applicant/resumes', 'out')), 'out');
    assert.equal(await pageSignInState(fakePage('https://hh.ru/account/login?backurl=%2F', 'in')), 'out');
  });

  test('a page that does not tell is left alone', async () => {
    assert.equal(await pageSignInState(fakePage('about:blank', 'out')), null);
    assert.equal(await pageSignInState(fakePage('https://linkedin.com/feed/', 'out')), null);
    assert.equal(await pageSignInState(fakePage('https://hh.ru/vacancy/1', null)), null);
    assert.equal(await pageSignInState({ url: () => 'https://hh.ru/', evaluate: async () => { throw new Error('closed'); } }), null);
  });

  test('every hh.ru window of the automation is watched', () => {
    for (const port of [9322, 9340, 9331, 9339, 9351, 9352]) {
      assert.ok(HH_SESSION_PORTS.includes(port));
    }
    assert.ok(!HH_SESSION_PORTS.includes(9350));
  });
});
