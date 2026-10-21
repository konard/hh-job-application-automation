/**
 * The trace's screenshots: Chrome's capture of the window, never Playwright's clipped page.screenshot
 */
import { describe, test, assert } from 'test-anywhere';
import { windowSafePage } from '../src/tracing.mjs';

describe('trace screenshots', () => {
  test('taken without a clip, the rest of the page untouched', async () => {
    const sent = [];
    let opened = 0;
    let detached = 0;
    const page = {
      url: 'https://hh.ru/',
      screenshot: () => assert.fail('the clipped page.screenshot is not used'),
      evaluate(fn) {
        return fn(this.url);
      },
    };
    const { page: view, detach } = windowSafePage(page, async () => {
      opened++;
      return { send: async (method, params) => (sent.push([method, params]), { data: Buffer.from('png').toString('base64') }), detach: async () => detached++ };
    });
    assert.equal((await view.screenshot({ type: 'png' })).toString(), 'png');
    await view.screenshot();
    assert.deepEqual(sent, [['Page.captureScreenshot', { format: 'png' }], ['Page.captureScreenshot', { format: 'png' }]]);
    assert.equal(opened, 1);
    assert.equal(view.evaluate((url) => url), 'https://hh.ru/');
    assert.equal(view.url, 'https://hh.ru/');
    await detach();
    assert.equal(detached, 1);
  });

  test('a session that failed to open is opened again next time', async () => {
    let tries = 0;
    const { page: view } = windowSafePage({}, async () => {
      if (++tries === 1) {
        throw new Error('no session');
      }
      return { send: async () => ({ data: '' }), detach: async () => {} };
    });
    let failed = false;
    await view.screenshot().catch(() => (failed = true));
    assert.equal(failed, true);
    assert.equal((await view.screenshot()).length, 0);
    assert.equal(tries, 2);
  });
});
