import { describe, test, assert } from 'test-anywhere';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lifecycleUrl, recordBrowserLifecycle, watchBrowserLifecycle } from '../src/browser-lifecycle.mjs';

function fixture() {
  const browser = new EventEmitter(), page = new EventEmitter(), context = new EventEmitter(), cdp = new EventEmitter();
  const events = [], commands = [];
  let connected = true;
  browser.isConnected = () => connected;
  browser.newBrowserCDPSession = async () => cdp;
  page.url = () => 'https://hh.ru/applicant/vacancy_response?vacancyId=123&token=private';
  page.context = () => context;
  cdp.send = async (method) => commands.push(method);
  cdp.detach = async () => commands.push('detach');
  return { browser, page, context, cdp, events, commands,
    options: { browser, page, port: 9322, targetId: 'main', record: (event, data) => events.push({ event, ...data }) },
    disconnect: () => { connected = false; browser.emit('disconnected'); } };
}

describe('browser lifecycle evidence', () => {
  test('target loss while the browser remains connected does not imply a user close', async () => {
    const f = fixture();
    const stop = await watchBrowserLifecycle(f.options);
    f.cdp.emit('Target.targetDestroyed', { targetId: 'other' });
    f.cdp.emit('Target.targetDestroyed', { targetId: 'main' });
    f.page.emit('close');
    assert.deepEqual(f.events.map(e => e.event), ['session_attached', 'target_destroyed', 'page_closed']);
    assert.equal(f.events.at(-1).browserConnected, true);
    assert.equal(f.events.at(-1).crashed, false);
    assert.equal(f.events.at(-1).disconnected, false);
    assert.equal(JSON.stringify(f.events).includes('private'), false);
    assert.deepEqual(f.commands, ['Target.setDiscoverTargets'], 'Observation must not close or navigate a page');
    await stop();
    const count = f.events.length;
    f.page.emit('close'); f.browser.emit('disconnected');
    assert.equal(f.events.length, count, 'Release removes monitoring listeners');
  });

  test('crash details and disconnect survive through page closure', async () => {
    const f = fixture();
    const stop = await watchBrowserLifecycle(f.options);
    f.cdp.emit('Target.targetCrashed', { targetId: 'main', status: 'crashed', errorCode: 9 });
    f.page.emit('crash'); f.disconnect(); f.context.emit('close'); f.page.emit('close');
    assert.equal(f.events.find(e => e.event === 'target_crashed').errorCode, 9);
    assert.equal(f.events.at(-1).crashed, true);
    assert.equal(f.events.at(-1).disconnected, true);
    assert.equal(f.events.at(-1).browserConnected, false);
    await stop();
  });

  test('a failed CDP observer leaves page monitoring and the browser usable', async () => {
    const f = fixture();
    f.browser.newBrowserCDPSession = async () => { throw new Error('CDP unavailable'); };
    const stop = await watchBrowserLifecycle(f.options);
    f.page.emit('close');
    assert.equal(f.events[0].event, 'lifecycle_monitor_partial');
    assert.equal(f.events.at(-1).event, 'page_closed');
    assert.deepEqual(f.commands, []);
    await stop();
  });

  test('local lifecycle records omit credentials, query strings and fragments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-lifecycle-'));
    try {
      const file = path.join(dir, 'events.jsonl');
      recordBrowserLifecycle('target_close_requested', { reason: 'new_tab_policy', url: 'https://user:secret@hh.ru/vacancy/123?token=private#private' }, file);
      const event = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(event.reason, 'new_tab_policy');
      assert.equal(event.url, 'https://hh.ru/vacancy/123');
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      recordBrowserLifecycle('worker_shutdown', {}, dir); // An unwritable log must not interrupt shutdown.
      assert.equal(lifecycleUrl('data:text/html,private'), 'data:');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
