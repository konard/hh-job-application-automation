/**
 * Automation browser session, optionally kept open between script runs.
 *
 * The installed Chrome is started detached on a fixed remote debugging port and
 * attached to with browser-commander. By default it is closed when the script exits.
 * With `keepOpen` it stays running: the next run (within the idle timeout) attaches
 * to it instead of starting a new one, so the hh.ru session, the open tab and its
 * cache stay warm and hh.ru sees no extra logins or page loads. A detached watchdog
 * closes it once it has not been used for the idle timeout.
 *
 * Workaround: browser-commander kills the browser it launched when the controlling
 * process exits and has no idle timeout, so the detached start is done here with its
 * launch helpers.
 *
 * @module browser-session
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  connectBrowser,
  prepareUserDataDir,
  resolveLaunchExecutable,
  resolveRestrictions,
} from 'browser-commander';
import { log } from './logging.mjs';

const LAUNCH_RESTRICTIONS = ['no-crash-restore', 'no-translate'];
// Workarounds for panels browser-commander's restrictions leave visible:
// the "Continue where you left off" infobar, and the Translate bubble that
// --disable-features=Translate no longer hides
const EXTRA_DISABLED_FEATURES = ['SessionRestoreInfobar'];
const PROFILE_PREFERENCES = { translate: { enabled: false } };
const STARTUP_TIMEOUT_MS = 30000;
const USAGE_MARK_INTERVAL_MS = 60000;
const WATCHDOG_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-watchdog.mjs');

const endpoint = (port) => `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lastUsedFile = (userDataDir) => path.join(userDataDir, 'hh-automation-last-used');
export const watchdogPidFile = (userDataDir) => path.join(userDataDir, 'hh-automation-watchdog.pid');

/**
 * Whether the idle watchdog of this profile is running
 * @param {string} userDataDir
 * @returns {boolean}
 */
function isWatchdogRunning(userDataDir) {
  try {
    process.kill(Number(fs.readFileSync(watchdogPidFile(userDataDir), 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Restriction switches with the extra disabled features merged in: Chrome reads only the
 * last --disable-features switch
 * @returns {string[]}
 */
function launchSwitches() {
  const isFeatureSwitch = (arg) => arg.startsWith('--disable-features=');
  const { args } = resolveRestrictions(LAUNCH_RESTRICTIONS);
  const features = [...args.filter(isFeatureSwitch).flatMap((arg) => arg.split('=')[1].split(',')), ...EXTRA_DISABLED_FEATURES];
  return [...args.filter((arg) => !isFeatureSwitch(arg)), `--disable-features=${features.join(',')}`];
}

/**
 * Whether a browser answers on the debugging port
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isBrowserRunning(port) {
  return fetch(`${endpoint(port)}/json/version`).then((response) => response.ok, () => false);
}

/**
 * Close the browser listening on the debugging port (CDP Browser.close)
 * @param {number} port
 */
export async function closeBrowser(port) {
  const version = await fetch(`${endpoint(port)}/json/version`).then((response) => response.json()).catch(() => null);
  if (!version?.webSocketDebuggerUrl) {
    return;
  }
  await new Promise((resolve) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    socket.onmessage = socket.onclose = socket.onerror = resolve;
    setTimeout(resolve, 5000);
  });
}

/**
 * Record that the browser is in use (read by the idle watchdog)
 * @param {string} userDataDir
 */
export function markBrowserUsed(userDataDir) {
  fs.writeFileSync(lastUsedFile(userDataDir), String(Date.now()));
}

/**
 * Milliseconds since the browser was last used
 * @param {string} userDataDir
 * @returns {number}
 */
export function browserIdleMs(userDataDir) {
  const lastUsed = Number(fs.readFileSync(lastUsedFile(userDataDir), 'utf8'));
  return Number.isFinite(lastUsed) ? Date.now() - lastUsed : Infinity;
}

/**
 * Attach to the automation browser, starting it first when it is not running
 *
 * @param {Object} options
 * @param {string} options.engine - 'playwright' or 'puppeteer'
 * @param {string} options.userDataDir - Dedicated automation profile
 * @param {number} options.port - Remote debugging port
 * @param {boolean} options.keepOpen - Keep the browser running after the script exits
 * @param {number} options.idleTimeoutMinutes - Close a kept-open browser after this much idle time
 * @returns {Promise<{browser: Object, page: Object, reused: boolean, release: () => Promise<void>}>}
 */
export async function connectOrLaunchBrowser({ engine, userDataDir, port, keepOpen, idleTimeoutMinutes }) {
  let reused = await isBrowserRunning(port);

  if (reused) {
    console.log(`♻️  Reusing the running browser on port ${port}`);
  } else {
    await prepareUserDataDir(userDataDir, { preferences: PROFILE_PREFERENCES });
    const executable = await resolveLaunchExecutable({ engine });
    const args = [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, ...launchSwitches()];
    spawn(executable, args, { detached: true, stdio: 'ignore' }).unref();
    console.log(`🚀 Started browser on port ${port} (profile: ${userDataDir})`);
  }

  markBrowserUsed(userDataDir);
  if (keepOpen && !isWatchdogRunning(userDataDir)) {
    spawn(process.execPath, [WATCHDOG_SCRIPT, String(port), userDataDir, String(idleTimeoutMinutes * 60000)], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    log.debug(() => `Idle watchdog closes the browser after ${idleTimeoutMinutes} unused minute(s)`);
  }
  const usageTimer = setInterval(() => markBrowserUsed(userDataDir), USAGE_MARK_INTERVAL_MS);
  usageTimer.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const session = await connectBrowser({ engine, cdpEndpoint: endpoint(port) });
      return {
        ...session,
        reused,
        release: async () => {
          clearInterval(usageTimer);
          markBrowserUsed(userDataDir);
          if (!keepOpen) {
            await closeBrowser(port);
          }
        },
      };
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`Could not attach to the browser on port ${port}: ${error.message}`);
      }
      reused = false;
      await sleep(500);
    }
  }
}
