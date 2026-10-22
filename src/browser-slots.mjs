/**
 * Browser slots: separate Chrome instances for work the user reviews side by side (prefilled
 * external forms, chat answers), apart from the single-tab hh.ru automation browser. A slot has
 * its own profile and port and stays open after the script exits.
 *
 * @module browser-slots
 */

import os from 'os';
import path from 'path';
import { makeBrowserCommander } from 'browser-commander';
import { connectOrLaunchBrowser } from './browser-session.mjs';
import { createTracing } from './tracing.mjs';

/**
 * The profile directory of a slot: ~/.hh-automation/<name>
 * @param {string} name
 * @returns {string}
 */
export const slotDir = (name) => path.join(os.homedir(), '.hh-automation', name);

/** Recording is on unless turned off with TRACE=0 (or false) */
export const tracingEnabled = (env = process.env) => !/^(0|false|no|off)$/i.test(env.TRACE ?? '');

/**
 * Open (or attach to) a slot. Its window is recorded by default (DOM snapshot and changes, field
 * values, network) into logs/traces/<time>-<name>, until the session is released
 * @param {Object} options
 * @param {string} options.name - Profile name: ~/.hh-automation/<name>
 * @param {number} options.port - Remote debugging port
 * @param {number} [options.keepOpenHours=24] - Close the slot after this many unused hours
 * @param {boolean} [options.trace] - Record the window (default: on, TRACE=0 turns it off)
 * @returns {Promise<{page: Object, release: Function, traceDirectory: string|null}>}
 */
export async function openSlot({ name, port, keepOpenHours = 24, trace = tracingEnabled() }) {
  const session = await connectOrLaunchBrowser({
    engine: 'playwright',
    userDataDir: slotDir(name),
    port,
    keepOpen: true,
    idleTimeoutMinutes: keepOpenHours * 60,
    singleTab: true,
  });
  if (!trace) {
    return { ...session, traceDirectory: null };
  }
  const commander = makeBrowserCommander({ page: session.page, enableNetworkTracking: false });
  const tracing = await createTracing({ commander, page: session.page, name })
    .catch((error) => console.log(`⚠️  ${name} is not recorded: ${error.message.split('\n')[0]}`));
  return {
    ...session,
    traceDirectory: tracing?.directory ?? null,
    release: async (...args) => {
      await tracing?.stop().catch(() => {});
      await commander.destroy?.().catch?.(() => {});
      return session.release(...args);
    },
  };
}
