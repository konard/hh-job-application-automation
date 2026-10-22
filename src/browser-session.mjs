/**
 * Automation browser session, optionally kept open between script runs.
 *
 * The browser is Chrome for Testing (Playwright's, `npx playwright install chromium`), an app of
 * its own: the installed Google Chrome stays the user's. Started from the Google Chrome app, the
 * automation window would be the one macOS brings up at a click on Chrome in the Dock, and a tab
 * the user opens there would be closed as an extra one. A profile Google Chrome used before keeps
 * its logins: its cookies are read by Google Chrome without a window (headless) and set in Chrome
 * for Testing once, in memory, never written out. Chrome for Testing never asks for the keychain
 * (`--use-mock-keychain`).
 *
 * Chrome for Testing is started detached on a fixed remote debugging port and
 * attached to with browser-commander. By default it is closed when the script exits.
 * With `keepOpen` it stays running: the next run (within the idle timeout) attaches
 * to it instead of starting a new one, so the hh.ru session, the open tab and its
 * cache stay warm and hh.ru sees no extra logins or page loads. A detached watchdog
 * closes it once it has not been used for the idle timeout.
 *
 * One tab: before attaching, every tab but the automation tab is closed (raw CDP, so the
 * kept tab is chosen by URL: the remembered tab, else an hh.ru form, else an hh.ru page),
 * the engine attaches to exactly that target (browser-commander `targetId`, `singleTab`),
 * and tabs opened later are closed too.
 *
 * Kept here although browser-commander 0.28.0 has `connectOrLaunch()` (detached browser,
 * idle watchdog, remembered target): under Bun on macOS it throws EPERM before launching
 * (its default-profile check calls `realpathSync` on ~/Library/Safari), it refuses a browser
 * already running on the port without its own metadata (the kept-open browsers started by
 * earlier versions of this script), a closed remembered tab makes it throw (and leaks the
 * connection), and it does not close tabs opened later. The launch switches, profile
 * preferences and the target selection do come from browser-commander.
 *
 * @module browser-session
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import {
  connectBrowser,
  prepareUserDataDir,
  resolveLaunchExecutable,
  resolveRestrictions,
} from 'browser-commander';
import { withFileLock } from './helpers/mutex.mjs';
import { log } from './logging.mjs';

/**
 * Launch switches and profile preferences: no "Continue where you left off" infobar or
 * crash-restore bubble (`SessionRestoreInfobar` merged into one `--disable-features`), no
 * Translate bubble (`translate.enabled: false` written to the profile)
 */
export const LAUNCH_SETTINGS = Object.freeze(resolveRestrictions(['no-crash-restore', 'no-translate']));
const STARTUP_TIMEOUT_MS = 30000;
const USAGE_MARK_INTERVAL_MS = 60000;
const WATCHDOG_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-watchdog.mjs');

const endpoint = (port) => `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lastUsedFile = (userDataDir) => path.join(userDataDir, 'hh-automation-last-used');
const tabFile = (userDataDir) => path.join(userDataDir, 'hh-automation-tab');
const HH_URL = /^https:\/\/([\w-]+\.)?hh\.ru\//;
/** Which browser the profile is for: «chrome-for-testing» once moved from Google Chrome */
const browserFile = (userDataDir) => path.join(userDataDir, 'hh-automation-browser');
const OWN_BROWSER = 'chrome-for-testing';
/** Taken by the process starting a profile's browser, so two never start one on it at once */
const launchLockFile = (userDataDir) => path.join(userDataDir, 'hh-automation-launch');
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
 * Whether a browser answers on the debugging port
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isBrowserRunning(port) {
  return fetch(`${endpoint(port)}/json/version`, { signal: globalThis.AbortSignal.timeout(3000) }).then((response) => response.ok, () => false);
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
 * The automation's own browser: Chrome for Testing, never the user's Google Chrome
 * @returns {string}
 */
export function automationExecutable() {
  const executable = chromium.executablePath();
  if (!executable || !fs.existsSync(executable)) {
    throw new Error('Chrome for Testing is not installed (the automation does not use your Google Chrome): run `npx playwright install chromium`');
  }
  return executable;
}

/**
 * Whether a profile is still Google Chrome's: used before the automation had a browser of its own
 * @param {string} userDataDir
 * @returns {boolean}
 */
export function isGoogleChromeProfile(userDataDir) {
  let mark = null;
  try {
    mark = fs.readFileSync(browserFile(userDataDir), 'utf8').trim();
  } catch {
    // Not marked
  }
  return mark !== OWN_BROWSER && fs.existsSync(path.join(userDataDir, 'Default', 'Cookies'));
}

/**
 * Send CDP commands to a browser's own target, one after another
 * @param {number} port
 * @param {Array<[string, Object?]>} commands
 * @returns {Promise<Object[]>} Their results
 */
async function browserCommands(port, commands) {
  const version = await fetch(`${endpoint(port)}/json/version`).then((response) => response.json());
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`the browser on port ${port} did not answer`));
    setTimeout(socket.onerror, 10000);
  });
  const results = [];
  try {
    for (const [id, [method, params = {}]] of commands.entries()) {
      results.push(await new Promise((resolve, reject) => {
        const onMessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.id === id) {
            socket.removeEventListener('message', onMessage);
            return message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result);
          }
        };
        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({ id, method, params }));
      }));
    }
  } finally {
    socket.close();
  }
  return results;
}

/**
 * Wait until a browser answers on a port
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function waitForBrowser(port) {
  for (const deadline = Date.now() + STARTUP_TIMEOUT_MS; Date.now() < deadline; await sleep(250)) {
    if (await isBrowserRunning(port)) {
      return true;
    }
  }
  return false;
}

/**
 * The cookies of a Google Chrome profile, read by Google Chrome without a window (it alone can
 * decrypt them, with the keychain access it already has); kept in memory only
 * @param {string} userDataDir
 * @returns {Promise<Object[]>}
 */
async function googleChromeCookies(userDataDir) {
  const executablePath = await resolveLaunchExecutable({ engine: 'playwright', channel: 'chrome' });
  for (let attempt = 1; ; attempt++) {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        executablePath, headless: true, timeout: STARTUP_TIMEOUT_MS,
        // Its own keychain entry decrypts the cookies: the mock one would read none
        ignoreDefaultArgs: ['--use-mock-keychain'],
      });
      try {
        return await context.cookies();
      } finally {
        await context.close().catch(() => {});
      }
    } catch (error) {
      if (attempt >= 2) {
        throw new Error(`The logins of ${userDataDir} could not be read from Google Chrome: ${error.message.split('\n')[0]}`);
      }
      await sleep(2000);
    }
  }
}

/**
 * A cookie as Storage.setCookies takes it
 * @param {Object} cookie - Of Storage.getCookies
 * @returns {Object}
 */
export const cookieParam = ({ name, value, domain, path: cookiePath, secure, httpOnly, sameSite, expires, session, priority, sourceScheme, sourcePort, partitionKey }) => ({
  name, value, domain, path: cookiePath, secure, httpOnly,
  ...(sameSite ? { sameSite } : {}),
  ...(session || !(expires > 0) ? {} : { expires }),
  ...(priority ? { priority } : {}),
  ...(sourceScheme ? { sourceScheme } : {}),
  ...(sourcePort > 0 ? { sourcePort } : {}),
  ...(partitionKey ? { partitionKey } : {}),
});

/**
 * Move a Google Chrome profile to Chrome for Testing, its logins kept: the cookies read before the
 * launch are set in the started browser, and the profile is marked as moved
 * @param {Object} options
 * @param {number} options.port - Chrome for Testing's
 * @param {string} options.userDataDir
 * @param {Object[]} options.cookies
 */
async function moveCookies({ port, userDataDir, cookies }) {
  try {
    await browserCommands(port, [['Storage.setCookies', { cookies: cookies.map(cookieParam) }]]);
  } catch {
    // A partitioned cookie in a shape this version does not take: the others still go
    await browserCommands(port, [['Storage.setCookies', { cookies: cookies.filter((cookie) => !cookie.partitionKey).map(cookieParam) }]]);
  }
  fs.writeFileSync(browserFile(userDataDir), OWN_BROWSER);
  const hh = cookies.filter((cookie) => /(?:^|\.)hh\.ru$/.test(cookie.domain)).length;
  console.log(`🔀 ${path.basename(userDataDir)} moved from Google Chrome to Chrome for Testing: ${cookies.length} cookies kept (${hh} of hh.ru)`);
}

/**
 * Start Chrome for Testing on a profile unless a browser runs on the port; a Google Chrome profile
 * is moved first, its logins kept (a Google Chrome still running on it is closed)
 * @param {Object} options
 * @param {string} options.userDataDir
 * @param {number} options.port
 * @returns {Promise<boolean>} Whether a running browser is reused
 */
async function startBrowser({ userDataDir, port }) {
  const moving = isGoogleChromeProfile(userDataDir);
  if (moving && await isBrowserRunning(port)) {
    await closeBrowser(port);
    for (const deadline = Date.now() + STARTUP_TIMEOUT_MS; Date.now() < deadline && await isBrowserRunning(port);) {
      await sleep(250);
    }
    await sleep(1000);
  }
  if (await isBrowserRunning(port)) {
    console.log(`♻️  Reusing the running browser on port ${port}`);
    return true;
  }
  const executable = automationExecutable();
  const cookies = moving ? await googleChromeCookies(userDataDir) : null;
  await prepareUserDataDir(userDataDir, { preferences: LAUNCH_SETTINGS.preferences });
  // --use-mock-keychain: the macOS keychain is never asked («wants to access key Chromium Safe
  // Storage»), the profile's cookies are encrypted with a key of its own. --test-type=gpu: no
  // «Chrome for Testing is only for automated testing» bar (the one value of the switch that
  // hides it, chrome/browser/ui/startup/infobar_utils.cc). --restore-last-session: the session
  // cookies are kept like «Continue where you left off» keeps them (hh.ru's login is one of them);
  // without it a browser closed normally starts logged out of hh.ru
  const args = [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, '--no-first-run', '--use-mock-keychain',
    '--test-type=gpu', '--restore-last-session', ...LAUNCH_SETTINGS.args];
  spawn(executable, args, { detached: true, stdio: 'ignore' }).unref();
  console.log(`🚀 Started Chrome for Testing on port ${port} (profile: ${userDataDir})`);
  if (!(await waitForBrowser(port))) {
    throw new Error(`Chrome for Testing did not start on port ${port}`);
  }
  if (cookies) {
    await moveCookies({ port, userDataDir, cookies });
  }
  return false;
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
 * The tab to keep: the one the automation used last, else an hh.ru form, else an hh.ru page,
 * else the first one
 * @param {Array<{id: string, url: string}>} tabs - Page targets of /json/list
 * @param {string|null} rememberedId
 * @returns {{id: string, url: string}|null}
 */
export function chooseTab(tabs, rememberedId) {
  return tabs.find((tab) => tab.id === rememberedId) ??
    tabs.find((tab) => HH_URL.test(tab.url) && tab.url.includes('/applicant/vacancy_response')) ??
    tabs.find((tab) => HH_URL.test(tab.url)) ??
    tabs[0] ??
    null;
}

/**
 * Close every tab but the automation tab (raw CDP endpoints, before the engine attaches)
 * @param {Object} options
 * @param {number} options.port
 * @param {string} options.userDataDir
 * @returns {Promise<{id: string, url: string}|null>} The kept tab
 */
export async function keepSingleTab({ port, userDataDir }) {
  const tabs = (await fetch(`${endpoint(port)}/json/list`).then((response) => response.json()))
    .filter((target) => target.type === 'page');
  let rememberedId = null;
  try {
    rememberedId = fs.readFileSync(tabFile(userDataDir), 'utf8').trim();
  } catch {
    // No tab recorded yet
  }
  // The user closed the last window: the browser keeps running without a page, and nothing can
  // attach to it until a tab is open again
  if (tabs.length === 0) {
    const opened = await fetch(`${endpoint(port)}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
    console.log(`🗂️  The browser on port ${port} had no window open: opened one`);
    fs.writeFileSync(tabFile(userDataDir), opened.id);
    return opened;
  }
  const kept = chooseTab(tabs, rememberedId);
  for (const tab of tabs.filter((item) => item !== kept)) {
    await fetch(`${endpoint(port)}/json/close/${tab.id}`);
    console.log(`🗂️  Closed an extra tab, the automation uses one: ${tab.url}`);
  }
  if (kept) {
    fs.writeFileSync(tabFile(userDataDir), kept.id);
  }
  return kept;
}

/**
 * Close tabs opened while the automation runs, so it never works in more than one
 * @param {Object} session - { browser, page } of connectBrowser
 * @param {string} engine
 */
function closeNewTabs({ browser, page }, engine) {
  const close = async (newPage) => {
    if (!newPage || newPage === page) {
      return;
    }
    const url = newPage.url();
    await newPage.close().catch(() => {});
    console.log(`🗂️  Closed a new tab, the automation uses one: ${url}`);
  };
  if (engine === 'puppeteer') {
    browser.on('targetcreated', async (target) => target.type() === 'page' && close(await target.page()));
  } else {
    page.context().on('page', close);
  }
}

/**
 * connectBrowser options: attach to the kept tab itself, not to whichever tab the engine lists
 * first, and close any tab that appeared since it was chosen
 * @param {Object} options
 * @param {string} options.engine
 * @param {number} options.port
 * @param {{id: string}|null} options.kept - The tab keepSingleTab kept
 * @param {boolean} options.singleTab
 * @returns {Object}
 */
export function attachOptions({ engine, port, kept, singleTab }) {
  return {
    engine,
    cdpEndpoint: endpoint(port),
    ...(singleTab && kept ? { targetId: kept.id, singleTab: true } : {}),
  };
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
 * @param {boolean} [options.singleTab=true] - Keep the browser to the one automation tab
 * @returns {Promise<{browser: Object, page: Object, reused: boolean, release: () => Promise<void>}>}
 */
export async function connectOrLaunchBrowser({
  engine, userDataDir, port, keepOpen, idleTimeoutMinutes, singleTab = true,
}) {
  // One process starts the browser of a profile: the run and its chat processor may both open the
  // chat slot at once, and a profile is moved from Google Chrome only once
  let reused = await withFileLock(launchLockFile(userDataDir), () => startBrowser({ userDataDir, port }),
    { timeoutMs: 2 * STARTUP_TIMEOUT_MS + 30000, staleMs: 2 * STARTUP_TIMEOUT_MS + 30000 });

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
      const kept = singleTab ? await keepSingleTab({ port, userDataDir }) : null;
      const session = await connectBrowser(attachOptions({ engine, port, kept, singleTab }));
      if (singleTab) {
        closeNewTabs(session, engine);
      }
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
