/** Native recorder integration with an isolated page; no signed-in browser or HH request. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createTracing } from '../../src/tracing.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hh-trace-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let recorder;
let commander;
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Diagnostic fixture</h1></body></html>' }));
  commander = makeBrowserCommander({ page, engine: 'playwright', enableNetworkTracking: false, enableNavigationManager: false });
  recorder = await createTracing({ commander, page, name: 'isolated-fixture', storage: { directory } });
  const folder = recorder.directory;
  assert.equal(path.dirname(folder), directory);
  await page.goto('https://trace-fixture.invalid');
  await page.evaluate(() => document.querySelector('h1').textContent = 'Updated diagnostic fixture');
  await recorder.checkpoint('changed page');
  await recorder.stop();
  for (const file of ['.hh-trace.json', 'trace.lino', 'network.lino', 'dom.lino', 'trace/manifest.json']) {
    assert.ok((await fs.stat(path.join(folder, file))).size > 0, `${file} was recorded`);
  }
  const dom = await fs.readFile(path.join(folder, 'dom.lino'), 'utf8');
  assert.ok(dom.includes('Diagnostic fixture'));
  assert.ok(dom.includes('Updated diagnostic fixture'));
  console.log('Trace integration passed: native bundle, Links Notation, DOM and network logs share private managed storage and stop cleanly.');
} finally {
  await recorder?.stop();
  await commander?.destroy();
  await browser.close();
  await fs.rm(directory, { recursive: true, force: true });
}
