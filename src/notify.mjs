/**
 * A macOS alert when the run waits for you: a sound, and a notification with two buttons, «Show
 * browser» (the window that waits for you is brought to the front) and «Later» (shown again in 15
 * min). The notification is posted by a small app of the automation, «hh.ru automation», built
 * from src/notifier/notifier.swift into ~/.hh-automation/notifier on the first run (macOS asks once
 * to allow its notifications). When it cannot be shown (a Focus or Do Not Disturb is on, the app is
 * not allowed or not built yet) an alert window with the same buttons opens instead; its default
 * button is «Show browser», so a Return typed by mistake only brings the browser forward.
 *
 * No alert while the browser window that waits for you is the app in front: you are at it
 * already (it is checked again every 5 minutes). The sound is played directly, so it is heard
 * with a Focus on too. An alert not answered is shown again every 5 minutes; once the wait is
 * over it is taken away. Nothing is shown on other
 * systems, in tests, or with NOTIFY=0
 *
 * @module notify
 */

import { execFile, execFileSync, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const TITLE = 'hh.ru automation';
const SOUND = '/System/Library/Sounds/Glass.aiff';
/** Not answered: shown again this often */
const REMIND_MS = 5 * 60 * 1000;
/** Answered (Show browser or Later) while the run still waits: shown again after this long */
const LATER_MS = 15 * 60 * 1000;
/** The notification not posted by then (macOS still asks whether to allow it): the window instead */
const POST_TIMEOUT_MS = 10000;
const MAIN_PORT = 9322;
const FOCUS_FILE = path.join(homedir(), 'Library/DoNotDisturb/DB/Assertions.json');
const NOTIFIER_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notifier', 'notifier.swift');
const NOTIFIER_DIR = path.join(homedir(), '.hh-automation', 'notifier');
const NOTIFIER_APP = path.join(NOTIFIER_DIR, 'hh.ru automation.app');
const NOTIFIER_ID = 'com.github.konard.hh-job-application-automation.notifier';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** Alerts are on unless turned off with NOTIFY=0 (or false); never in tests or off macOS */
export const alertsEnabled = (env = process.env, platform = process.platform) =>
  platform === 'darwin' && env.NODE_ENV !== 'test' && !/^(0|false|no|off)$/i.test(env.NOTIFY ?? '');

/** Mute sound independently of visual alerts; standalone tools also honor the local .lenv. */
export function notificationSoundEnabled({ env = process.env, file = '.lenv' } = {}) {
  let value = env.NOTIFY_SOUND;
  if (value === undefined) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    value = text.match(/^NOTIFY_SOUND:[ \t]*([^\r\n]+)/m)?.[1].trim().replace(/^(['"`])(.*)\1$/, '$2');
  }
  return !/^(0|false|no|off)$/i.test(String(value ?? ''));
}

/**
 * Whether a Focus (or Do Not Disturb) is on, from the Focus assertions file
 * @param {Object} assertions - ~/Library/DoNotDisturb/DB/Assertions.json
 * @returns {boolean}
 */
export function focusActive(assertions) {
  return (assertions?.data ?? []).some((store) => {
    const ended = new Set((store.storeInvalidationRecords ?? []).map((record) => record.invalidationAssertion?.assertionUUID));
    return (store.storeAssertionRecords ?? []).some((record) => !ended.has(record.assertionUUID));
  });
}

/** A Focus on now; when it cannot be told, true (the window is used) */
function focusOn() {
  try {
    return focusActive(JSON.parse(fs.readFileSync(FOCUS_FILE, 'utf8')));
  } catch {
    return true;
  }
}

/** The text of every alert: short, what is needed is told in the terminal */
export const ALERT_TEXT = 'The job application automation needs your attention.';

/**
 * What the notification app printed: its pid, whether the notification is up, and the answer
 * @param {string} output
 * @returns {{pid: number|null, posted: boolean, failed: boolean, answer: string|null}}
 */
export function readNotifierOutput(output) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const pid = lines.map((line) => line.match(/^pid (\d+)$/)).find(Boolean);
  return {
    pid: pid ? Number(pid[1]) : null,
    posted: lines.includes('posted'),
    failed: lines.some((line) => /^(denied|error)\b/.test(line)),
    answer: lines.find((line) => /^(show|later|dismissed|timeout)$/.test(line)) ?? null,
  };
}

/** The alert window: its buttons, and the browser brought forward from it (the window is in front then) */
export const WINDOW_SCRIPT = `function run([title, message, pid]) {
  ObjC.import('AppKit');
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.activate();
  const reply = app.displayAlert(title, { message, buttons: ['Later', 'Show browser'], defaultButton: 'Show browser', givingUpAfter: 3600 });
  if (reply.gaveUp) return 'timeout';
  if (reply.buttonReturned !== 'Show browser') return 'later';
  const browser = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(pid));
  if (Number(pid) && browser) {
    $.NSApplication.sharedApplication.yieldActivationToApplication(browser);
    browser.activateFromApplicationOptions($.NSRunningApplication.currentApplication, $.NSApplicationActivateAllWindows);
  }
  return 'show';
}`;

const sourceHash = () => createHash('sha256').update(fs.readFileSync(NOTIFIER_SOURCE)).digest('hex');
const HASH_FILE = path.join(NOTIFIER_APP, 'Contents', 'Resources', 'source.sha256');
const exec = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 10 * 60 * 1000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

let notifierBuild = null;
// Whether the notification app is built, without waiting for it: until then the window is used
let notifierReady = false;

/**
 * Build the notification app (once; again when its source changes), in the background. Called
 * when a run starts, and by the first alert
 * @param {(message: string) => void} [log]
 * @returns {Promise<boolean>}
 */
export function prepareAlerts(log = console.log) {
  if (!alertsEnabled()) {
    return Promise.resolve(false);
  }
  notifierBuild ??= (async () => {
    const hash = sourceHash();
    if (fs.existsSync(HASH_FILE) && fs.readFileSync(HASH_FILE, 'utf8') === hash) {
      return true;
    }
    log('🔔 Building the notification app «hh.ru automation» (once, about a minute)...');
    const contents = path.join(NOTIFIER_APP, 'Contents');
    fs.rmSync(NOTIFIER_APP, { recursive: true, force: true });
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${NOTIFIER_ID}</string>
<key>CFBundleName</key><string>${TITLE}</string>
<key>CFBundleDisplayName</key><string>${TITLE}</string>
<key>CFBundleExecutable</key><string>notifier</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
`);
    await exec('nice', ['-n', '10', 'swiftc', '-O', '-o', path.join(contents, 'MacOS', 'notifier'), NOTIFIER_SOURCE]);
    await exec('codesign', ['-s', '-', '--force', NOTIFIER_APP]);
    await exec(LSREGISTER, ['-f', NOTIFIER_APP]);
    fs.writeFileSync(HASH_FILE, hash);
    log('🔔 The notification app is ready: allow its notifications when macOS asks (System Settings → Notifications → hh.ru automation; the «Alerts» style keeps them on screen)');
    return true;
  })().catch((error) => {
    log(`⚠️  The notification app could not be built (${error.message.split('\n')[0]}): alerts open a window instead`);
    return false;
  }).then((ready) => {
    notifierReady = ready;
    return ready;
  });
  return notifierBuild;
}

/** The pid of the browser listening on a port (its DevTools port) */
function browserPid(port) {
  try {
    return Number(execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 5000 }).split('\n')[0]) || null;
  } catch {
    return null;
  }
}

/** The pid of the app in front of the screen, or null */
function frontmostPid() {
  try {
    return Number(execFileSync('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier'],
      { encoding: 'utf8', timeout: 5000 }).trim()) || null;
  } catch {
    return null;
  }
}

/** Actual window use; unknown focus never authorizes background navigation. */
export async function browserWindowActive(page, {
  port = MAIN_PORT, platform = process.platform, browserProcess = browserPid, frontProcess = frontmostPid,
} = {}) {
  const state = await page.evaluate(() => ({ hidden: document.visibilityState === 'hidden', focused: document.hasFocus() }))
    .catch(() => null);
  if (state?.hidden) return false;
  if (platform === 'darwin') {
    const browser = browserProcess(port);
    const front = frontProcess();
    return browser && front ? browser === front : null;
  }
  return state?.focused ?? null;
}

/**
 * Whether the alert is needed: not while the browser that waits for you is the app in front (you
 * are at it already)
 * @param {number|null} browser - The browser's pid
 * @param {number|null} front - The pid of the app in front
 * @returns {boolean}
 */
export const alertNeeded = (browser, front) => !browser || browser !== front;

/**
 * The browser window on a port un-minimized and its tab shown (the app itself is brought forward
 * by the notification app or the window, which macOS lets do it right after your click)
 * @param {number} port
 */
export async function focusBrowser(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => !candidate.url().startsWith('about:')) ?? pages[0];
    if (!page) {
      return;
    }
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await page.bringToFront();
    await cdp.detach().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Notifications and windows still up: taken away when the run exits, so none outlives it */
const shown = new Set();
process.on('exit', () => shown.forEach((stop) => stop()));
const activeAlerts = new Map();
const alertHolds = new Map();
function alertsHeld(port) {
  const hold = alertHolds.get(port);
  if (hold?.until > Date.now()) return true;
  if (hold) alertHolds.delete(port);
  return false;
}

/** An account cooldown is not actionable. Dismiss existing reminders for that window too. */
export function silenceAlertsUntil({ port = MAIN_PORT, until }) {
  const hold = { until: Math.max(until, alertHolds.get(port)?.until ?? 0) };
  alertHolds.set(port, hold);
  const active = activeAlerts.get(port);
  active?.end();
  if (activeAlerts.get(port) === active) activeAlerts.delete(port);
  return () => { if (alertHolds.get(port) === hold) alertHolds.delete(port); };
}

function retainAlert(shared) {
  shared.users++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--shared.users === 0) {
      shared.end();
      if (activeAlerts.get(shared.port) === shared) activeAlerts.delete(shared.port);
    }
  };
}

/** The alert window; calls back with the answer. Returns what takes it away */
function openWindow({ text, pid, onAnswer, log = () => {} }) {
  let stopped = false;
  const child = spawn('osascript', ['-l', 'JavaScript', '-e', WINDOW_SCRIPT, TITLE, text, String(pid ?? 0)], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('spawn', () => log('🔔 Visual alert window started (Show browser / Later).'));
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.on('error', () => {});
  child.on('exit', () => !stopped && onAnswer(output.trim() || 'timeout'));
  return () => {
    stopped = true;
    if (child.exitCode === null) {
      child.kill();
    }
  };
}

/**
 * The notification of the app; calls back with the answer, or opens the window when it cannot be
 * shown. Returns what takes it away
 */
function postNotification({ text, pid, onAnswer, log }) {
  const out = path.join(NOTIFIER_DIR, 'answers', `${randomUUID()}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '');
  // Started by LaunchServices: macOS allows the app's notifications only then
  spawn('open', ['-n', '-g', '--stdout', out, '--stderr', '/dev/null', '-a', NOTIFIER_APP, '--args',
    '--title', TITLE, '--message', text, '--activate-pid', String(pid ?? 0), '--timeout', String(REMIND_MS / 1000 + 60)],
  { stdio: 'ignore' }).on('error', () => {});
  const started = Date.now();
  let state = readNotifierOutput('');
  let reported = false;
  let finished = false;
  let stopWindow = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    if (state.pid) {
      try {
        process.kill(state.pid, 'SIGTERM');
      } catch {
        // Already gone
      }
    }
    setTimeout(() => fs.rmSync(out, { force: true }), 2000).unref();
  };
  const poll = setInterval(() => {
    try {
      state = readNotifierOutput(fs.readFileSync(out, 'utf8'));
    } catch {
      // Read again next time
    }
    if (state.posted && !reported) {
      reported = true;
      log('🔔 Visual notification posted (Show browser / Later).');
    }
    if (state.answer) {
      finish();
      onAnswer(state.answer);
    } else if (state.failed || (!state.posted && Date.now() - started > POST_TIMEOUT_MS)) {
      finish();
      log(`🔔 The notification could not be shown (${state.failed ? 'not allowed' : 'no answer from macOS'}): an alert window instead`);
      stopWindow = openWindow({ text, pid, onAnswer });
    }
  }, 500);
  poll.unref();
  return () => {
    finish();
    stopWindow?.();
  };
}

/**
 * Tell the user the run waits for them (what is needed is told in the terminal)
 * @param {Object} [options]
 * @param {number} [options.delayMs=0] - Only when the wait still goes on after this long (a captcha the AI may read)
 * @param {number} [options.port=9322] - The DevTools port of the browser window that waits for you
 * @param {number} [options.remindMs] - Not answered: shown again this often
 * @param {(message: string) => void} [options.log]
 * @returns {() => void} Ends the alert: no more sound, the notification or window taken away
 */
export function alertUser({ delayMs = 0, port = MAIN_PORT, remindMs = REMIND_MS, message = ALERT_TEXT, log = console.log } = {}, runtime = {}) {
  const enabled = runtime.enabled ?? alertsEnabled;
  if (!enabled() || alertsHeld(port)) {
    return () => {};
  }
  if (activeAlerts.has(port)) return retainAlert(activeAlerts.get(port));
  (runtime.prepare ?? prepareAlerts)(log);
  const text = message;
  const later = runtime.setTimeout ?? setTimeout;
  const cancel = runtime.clearTimeout ?? clearTimeout;
  let ended = false;
  let stopShown = () => {};
  let timer = null;
  const schedule = (ms) => {
    cancel(timer);
    timer = later(show, ms);
    timer.unref?.();
  };
  const onAnswer = (answer) => {
    if (ended) {
      return;
    }
    if (answer === 'show') {
      log(`🔔 Show browser: the window on port ${port} is brought forward`);
      (runtime.focus ?? focusBrowser)(port).catch((error) => log(`⚠️  Could not bring the browser forward: ${error.message.split('\n')[0]}`));
    } else if (answer === 'later' || answer === 'dismissed') {
      log('🔔 Later: shown again in 15 min if the run still waits');
    }
    // Answered: again only if the wait is still on after a while; not answered: again at once
    schedule(answer === 'timeout' ? 0 : LATER_MS);
  };
  function show() {
    if (ended) {
      return;
    }
    stopShown();
    shown.delete(stopShown);
    const pid = (runtime.browserPid ?? browserPid)(port);
    // You are at the browser already: checked again at the next reminder
    if (!alertNeeded(pid, (runtime.frontmostPid ?? frontmostPid)())) {
      schedule(remindMs);
      return;
    }
    if ((runtime.soundEnabled ?? notificationSoundEnabled)()) {
      if (runtime.playSound) runtime.playSound();
      else spawn('afplay', [SOUND], { stdio: 'ignore' }).on('error', () => {}).unref();
    }
    const options = { text, pid, onAnswer, log };
    stopShown = (runtime.canPost ?? (() => notifierReady && !focusOn()))()
      ? (runtime.post ?? postNotification)(options) : (runtime.window ?? openWindow)(options);
    shown.add(stopShown);
    schedule(remindMs);
  }
  schedule(delayMs);
  const shared = { port, users: 0, end: () => {
    if (ended) return;
    ended = true;
    cancel(timer);
    stopShown();
    shown.delete(stopShown);
  } };
  activeAlerts.set(port, shared);
  return retainAlert(shared);
}

const attention = new WeakMap();

/** A detached worker must still notify while a form waits. Deduplicate repeated page handlers. */
export function alertUntilDone(owner, { port = MAIN_PORT, getUrl = () => owner.getUrl?.() ?? owner.url(),
  isDone = async () => false, alert = alertUser, pollMs = 1000, message,
  every = setInterval, cancel = clearInterval } = {}) {
  if (alertsHeld(port)) { attention.get(owner)?.stop(); return () => {}; }
  if (alert === alertUser && !alertsEnabled()) return () => {};
  const url = getUrl();
  const previous = attention.get(owner);
  if (previous?.url === url) return previous.stop;
  previous?.stop();
  const end = alert({ port, ...(message ? { message } : {}) });
  let ended = false;
  let checking = false;
  let timer;
  const stop = () => {
    if (ended) return;
    ended = true;
    cancel(timer);
    end();
    attention.delete(owner);
  };
  timer = every(async () => {
    if (checking || ended) return;
    checking = true;
    try { if (alertsHeld(port) || getUrl() !== url || await isDone()) stop(); }
    catch { stop(); }
    finally { checking = false; }
  }, pollMs);
  timer.unref?.();
  attention.set(owner, { url, stop });
  return stop;
}
