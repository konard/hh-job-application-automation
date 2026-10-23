/**
 * A macOS alert when the run waits for you: a sound and a standard notification. When the
 * notification would not show (a Focus or Do Not Disturb is on, or notifications of Script Editor,
 * which posts them for osascript, are not allowed) an alert window is opened instead. The sound is
 * played directly, so it is heard with a Focus on too, and repeats every few minutes while the run
 * still waits; the window closes by itself once the wait is over. Only files are read to tell
 * (nothing asks for permission). Nothing is shown on other systems, in tests, or with NOTIFY=0
 *
 * @module notify
 */

import { execFileSync, spawn } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const TITLE = 'hh.ru automation';
const SOUND = '/System/Library/Sounds/Glass.aiff';
const REMIND_MS = 5 * 60 * 1000;
/** The app macOS shows osascript notifications from */
const SENDER = 'com.apple.ScriptEditor2';
const FOCUS_FILE = join(homedir(), 'Library/DoNotDisturb/DB/Assertions.json');
const NOTIFICATION_PREFS = join(homedir(), 'Library/Preferences/com.apple.ncprefs.plist');

/** Alerts are on unless turned off with NOTIFY=0 (or false); never in tests or off macOS */
export const alertsEnabled = (env = process.env, platform = process.platform) =>
  platform === 'darwin' && env.NODE_ENV !== 'test' && !/^(0|false|no|off)$/i.test(env.NOTIFY ?? '');

/**
 * A string as an AppleScript literal
 * @param {string} text
 * @returns {string}
 */
export const appleScriptString = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The AppleScript lines of an alert: the notification (kept in Notification Center) and the window */
export function alertScripts(message, title = TITLE) {
  const text = String(message).replace(/\s+/g, ' ').trim().slice(0, 300);
  return {
    notification: `display notification ${appleScriptString(text)} with title ${appleScriptString(title)}`,
    window: `display alert ${appleScriptString(title)} message ${appleScriptString(text)} giving up after 3600`,
  };
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

/**
 * Whether an app's notifications are allowed, from the notification settings (as XML)
 * @param {string} prefsXml - com.apple.ncprefs.plist converted to XML
 * @param {string} [bundleId]
 * @returns {boolean} False when the app was never allowed (no auth entry) or is turned off
 */
export function senderAllowed(prefsXml, bundleId = SENDER) {
  const app = prefsXml.split(/\n\t\t<dict>/).find((entry) => entry.includes(`<string>${bundleId}</string>`));
  if (!app) {
    return false;
  }
  const own = app.replace(/<key>src<\/key>\s*<array>[\s\S]*?<\/array>/, '');
  const auth = own.match(/<key>auth<\/key>\s*<integer>(\d+)<\/integer>/);
  return Boolean(auth && Number(auth[1]) > 0);
}

/** Whether a standard notification shows now; when it cannot be told, false (the window is used) */
export function notificationShows() {
  try {
    if (focusActive(JSON.parse(readFileSync(FOCUS_FILE, 'utf8')))) {
      return false;
    }
    const prefs = execFileSync('plutil', ['-convert', 'xml1', '-o', '-', NOTIFICATION_PREFS], { encoding: 'utf8', timeout: 5000 });
    return senderAllowed(prefs);
  } catch {
    return false;
  }
}

/** Alert windows still open: closed when the run exits, so none outlives it */
const openWindows = new Set();
process.on('exit', () => openWindows.forEach((window) => window.kill()));

const run = (command, args) => {
  const child = spawn(command, args, { stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return child;
};

/**
 * Tell the user the run waits for them
 * @param {string} message - What is needed («Answer the open question(s) in the browser»)
 * @param {Object} [options]
 * @param {number} [options.delayMs=0] - Only when the wait still goes on after this long (a captcha the AI may read)
 * @param {number} [options.remindMs] - The sound again this often while the run waits
 * @returns {() => void} Ends the alert: no more sound, the window (if any) closed
 */
export function alertUser(message, { delayMs = 0, remindMs = REMIND_MS } = {}) {
  if (!alertsEnabled()) {
    return () => {};
  }
  let window = null;
  let reminder = null;
  const show = () => {
    const scripts = alertScripts(message);
    const notify = () => {
      run('afplay', [SOUND]);
      run('osascript', ['-e', scripts.notification]);
    };
    if (notificationShows()) {
      notify();
      reminder = setInterval(notify, remindMs);
    } else {
      run('afplay', [SOUND]);
      window = run('osascript', ['-e', scripts.window]);
      openWindows.add(window);
      window.on('exit', () => openWindows.delete(window));
      reminder = setInterval(() => run('afplay', [SOUND]), remindMs);
    }
    reminder.unref();
  };
  const timer = setTimeout(show, delayMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
    clearInterval(reminder);
    if (window && window.exitCode === null) {
      window.kill();
    }
  };
}
