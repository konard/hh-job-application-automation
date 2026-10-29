/** Observe actual target/browser closure in an isolated browser, without a user profile. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { watchBrowserLifecycle } from '../../src/browser-lifecycle.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let stop;
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<textarea>My draft</textarea>' }));
  await page.goto('https://lifecycle.test/form?token=private');
  const session = await page.context().newCDPSession(page);
  const { targetInfo } = await session.send('Target.getTargetInfo');
  await session.detach();
  const events = [];
  stop = await watchBrowserLifecycle({ browser, page, port: 0, targetId: targetInfo.targetId,
    record: (event, data) => events.push({ event, ...data }) });
  assert.equal(await page.locator('textarea').inputValue(), 'My draft');
  assert.equal(browser.isConnected(), true);
  await page.close();
  for (let n = 0; n < 20 && !events.some(e => e.event === 'target_destroyed'); n++) await new Promise(r => setTimeout(r, 50));
  const closed = events.find(e => e.event === 'page_closed');
  assert.equal(closed.browserConnected, true);
  assert.equal(closed.crashed, false);
  assert.equal(events.some(e => e.event === 'target_destroyed'), true);
  await browser.close();
  assert.equal(events.some(e => e.event === 'browser_disconnected'), true);
  assert.equal(JSON.stringify(events).includes('private'), false);
  console.log('Lifecycle checks passed: a lost tab is distinguished from a browser disconnect; observation preserves drafts and omits URL secrets.');
} finally {
  await stop?.();
  await browser.close();
}
