#!/usr/bin/env bun

/**
 * Detached idle watchdog for a kept-open automation browser.
 * Closes the browser once it has not been used for the idle timeout, and exits
 * as soon as the browser is gone.
 *
 * Usage: browser-watchdog.mjs <port> <userDataDir> <idleTimeoutMs>
 */

import fs from 'fs';
import { browserIdleMs, closeBrowser, isBrowserRunning, watchdogPidFile } from './browser-session.mjs';
import { recordBrowserLifecycle } from './browser-lifecycle.mjs';

const [port, userDataDir, idleTimeoutMs] = process.argv.slice(2);
const CHECK_INTERVAL_MS = 60000;

fs.writeFileSync(watchdogPidFile(userDataDir), String(process.pid));

while (await isBrowserRunning(port)) {
  let idleMs = 0;
  try {
    idleMs = browserIdleMs(userDataDir);
  } catch {
    // No usage mark yet
  }
  if (idleMs > Number(idleTimeoutMs)) {
    recordBrowserLifecycle('idle_timeout', { port: Number(port), idleMs, idleTimeoutMs: Number(idleTimeoutMs) });
    await closeBrowser(port, { reason: 'idle_timeout' });
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
}
