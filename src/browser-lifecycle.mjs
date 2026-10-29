/** Private lifecycle evidence: a closed page does not establish who closed it. */
import fs from 'node:fs';
import path from 'node:path';

export const BROWSER_LIFECYCLE_FILE = path.join(process.cwd(), 'logs', 'browser-lifecycle.jsonl');

export function lifecycleUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}${url.pathname}` : url.protocol;
  } catch { return ''; }
}

/** Logging must never prevent an application, shutdown, or browser release. */
export function recordBrowserLifecycle(event, details = {}, file = BROWSER_LIFECYCLE_FILE) {
  if (process.env.NODE_ENV === 'test' && file === BROWSER_LIFECYCLE_FILE) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const safe = { ...details, ...(details.url ? { url: lifecycleUrl(details.url) } : {}) };
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...safe }) + '\n', { mode: 0o600 });
  } catch { /* Diagnostics must not change the browser's lifecycle. */ }
}

/** Record crashes, target loss and disconnects separately; observe without closing any target. */
export async function watchBrowserLifecycle({ browser, page, port, targetId, engine = 'playwright', record = recordBrowserLifecycle }) {
  const listeners = [];
  const on = (emitter, event, listener) => {
    if (!emitter?.on) return;
    emitter.on(event, listener);
    listeners.push(() => emitter.off(event, listener));
  };
  let crashed = false;
  let disconnected = false;
  let url = page.url();
  const context = engine === 'playwright' ? page.context() : null;
  const note = (event, details = {}) => record(event, { port, targetId, url: lifecycleUrl(url), ...details });
  on(page, 'framenavigated', (frame) => { if (frame === page.mainFrame()) url = frame.url(); });
  on(page, 'crash', () => { crashed = true; note('page_crashed'); });
  on(browser, 'disconnected', () => { disconnected = true; note('browser_disconnected'); });
  on(context, 'close', () => note('context_closed', { disconnected }));
  on(page, 'close', () => note('page_closed', { crashed, disconnected, browserConnected: Boolean(browser.isConnected?.()) }));
  let cdp;
  try {
    cdp = engine === 'puppeteer' ? await browser.target().createCDPSession() : await browser.newBrowserCDPSession();
    on(cdp, 'Target.targetDestroyed', (event) => {
      if (event.targetId === targetId) note('target_destroyed');
    });
    on(cdp, 'Target.targetCrashed', (event) => {
      if (event.targetId === targetId) {
        crashed = true;
        note('target_crashed', { status: event.status, errorCode: event.errorCode });
      }
    });
    await cdp.send('Target.setDiscoverTargets', { discover: true });
  } catch (error) {
    note('lifecycle_monitor_partial', { error: String(error.message).split('\n')[0] });
  }
  note('session_attached');
  return async () => {
    listeners.forEach((remove) => remove());
    await cdp?.detach().catch(() => {});
  };
}
