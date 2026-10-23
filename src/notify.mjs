/**
 * A macOS alert when the run waits for you: a sound, a notification and an alert window. The sound
 * is played and the window opened directly, not through Notification Center, so both show with Do
 * Not Disturb or a Focus on. The sound repeats every few minutes while the run still waits, and the
 * window closes by itself once the wait is over. Nothing is shown on other systems, in tests, or
 * with NOTIFY=0
 *
 * @module notify
 */

import { spawn } from 'child_process';

const TITLE = 'hh.ru automation';
const SOUND = '/System/Library/Sounds/Glass.aiff';
const REMIND_MS = 5 * 60 * 1000;

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
 * @returns {() => void} Ends the alert: no more sound, the window closed
 */
export function alertUser(message, { delayMs = 0, remindMs = REMIND_MS } = {}) {
  if (!alertsEnabled()) {
    return () => {};
  }
  let window = null;
  let reminder = null;
  const show = () => {
    const scripts = alertScripts(message);
    run('afplay', [SOUND]);
    run('osascript', ['-e', scripts.notification]);
    window = run('osascript', ['-e', scripts.window]);
    openWindows.add(window);
    window.on('exit', () => openWindows.delete(window));
    reminder = setInterval(() => run('afplay', [SOUND]), remindMs);
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
