/**
 * Debug recording with browser-commander traces
 *
 * - `trace/` - browser-commander trace bundle in continuous mode: DOM snapshot per
 *   checkpoint plus every DOM mutation, interactions, navigations, console messages,
 *   page errors and failed requests
 * - `trace.lino` - Links Notation export of that trace, written while recording
 *   (timeline, including console and page errors, and checkpoints)
 * - `network.lino` - document/XHR/fetch requests and responses with headers and bodies
 *   (`trace-network.mjs`). Kept: browser-commander 0.28's network capture redacts far less.
 * - `dom.lino` - DOM snapshots after every load and the bundle's DOM mutations as links
 *   (`trace-dom.mjs`). Kept: browser-commander 0.28's `links.dom` export is unredacted and
 *   re-reads the whole bundle on every 500 ms mutation drain.
 *
 * A checkpoint's screenshot is Chrome's own capture of what the window shows, not Playwright's
 * page.screenshot (`windowSafePage`).
 *
 * @module tracing
 */

import fs from 'fs';
import path from 'path';
import { createCdpSession } from 'browser-commander';
import { log } from './logging.mjs';
import { recordNetwork } from './trace-network.mjs';
import { recordDom } from './trace-dom.mjs';

/**
 * Trace options passed to browser-commander's startTrace
 *
 * - hidden inputs hold CSRF tokens, so their values are redacted like passwords
 * - a day-long run writes more than the default 256 MB, after which every checkpoint and
 *   mutation batch is dropped (browser-commander #148)
 * - open shadow roots are captured again: 0.28 copies them without `innerHTML`, which hh.ru's
 *   Trusted Types policy rejected (#140)
 * - not used: its network capture (redacts only cookie/authorization headers and a few query
 *   parameters, not form/JSON fields or tokens in bodies, and stores response bodies base64),
 *   `links.dom` (unredacted, re-reads the whole bundle on every drain), `limits.rotate` (deletes
 *   the oldest segments, moves the bundle) and `gzip` (compresses the mutation files before
 *   dom.lino has read the last ones)
 */
export const TRACE_OPTIONS = Object.freeze({
  mode: 'continuous',
  privacy: { redactSelectors: ['input[type=hidden]', 'input[name*=xsrf]', 'input[name*=csrf]', 'input[name*=token]'] },
  limits: { maxBundleBytes: 1024 * 1024 * 1024 },
});

const STOP_FLUSH_MS = 15000;

/**
 * The page as the trace recorder sees it, its screenshots taken by Chrome without a clip.
 * Playwright's page.screenshot passes the viewport as a clip, and Chrome emulates that size
 * while it captures: a window resized at that moment kept drawing the page at its old size, the
 * rest of it blank, until the page was reloaded (2 of 8 drags; none without the clip;
 * browser-commander #180)
 * @param {Object} page - Raw engine page
 * @param {() => Promise<{send: Function, detach: Function}>} openSession - Its CDP session
 * @returns {{page: Object, detach: () => Promise<void>}}
 */
export function windowSafePage(page, openSession) {
  let session = null;
  const screenshot = async () => {
    session ??= openSession().catch((error) => {
      session = null;
      throw error;
    });
    const { data } = await (await session).send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(data, 'base64');
  };
  const view = new Proxy(page, {
    get: (target, key) => {
      if (key === 'screenshot') {
        return screenshot;
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const detach = async () => {
    const opened = session;
    session = null;
    await (await opened?.catch(() => null))?.detach().catch(() => {});
  };
  return { page: view, detach };
}

// The application run's own trace (startTracing/checkpoint/stopTracing)
let current = null;

const report = (what) => (error) => log.debug(() => `${what} log error: ${error.message}`);

/**
 * An append-only Links Notation file; late writes after the end are dropped, not thrown
 * @param {string} file
 * @returns {{stream: fs.WriteStream, write: (text: string) => void}}
 */
function openLog(file) {
  const stream = fs.createWriteStream(file, { flags: 'a' });
  stream.on('error', report(path.basename(file)));
  return { stream, write: (text) => !stream.writableEnded && stream.write(text) };
}

/**
 * Record one page into logs/traces/<time>[-<name>]: trace bundle, trace.lino, network.lino and
 * dom.lino. Several pages can be recorded at once, each into its own directory
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance of the page
 * @param {Object} options.page - Raw engine page
 * @param {string} [options.name] - Added to the directory name (e.g. form-slot-4)
 * @returns {Promise<{directory: string, checkpoint: (name: string) => Promise<void>, stop: () => Promise<void>}>}
 */
export async function createTracing({ commander, page, name = '' }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(process.cwd(), 'logs', 'traces', name ? `${stamp}-${name}` : stamp);
  fs.mkdirSync(directory, { recursive: true });

  // The network log starts first, so the requests of the initial checkpoint are in it
  const network = openLog(path.join(directory, 'network.lino'));
  const networkRecorder = recordNetwork({ page, write: network.write, onError: report('Network') });

  const traced = windowSafePage(page, () => createCdpSession(page, { engine: commander.engine }));
  const trace = await commander.startTrace({
    ...TRACE_OPTIONS,
    page: traced.page,
    output: path.join(directory, 'trace'),
    links: { output: path.join(directory, 'trace.lino') },
  });

  const dom = openLog(path.join(directory, 'dom.lino'));
  const domRecorder = recordDom({ page, bundle: trace.path, write: dom.write, onError: report('DOM') });
  let stopped = false;
  return {
    directory,
    /** Name the current page state in the trace (DOM snapshot + screenshot) */
    checkpoint: async (label) => {
      if (stopped) {
        return;
      }
      await trace.checkpoint(label).catch((error) => log.debug(() => `Trace checkpoint failed: ${error.message}`));
      // The checkpoint completed the previous interval's mutations; they are converted in the background
      void domRecorder.convertMutations();
    },
    /** Finish the trace so the bundle and its Links Notation exports are complete */
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      networkRecorder.detach();
      domRecorder.detach();
      await trace.stop().catch((error) => log.debug(() => `Trace stop failed: ${error.message}`));
      await traced.detach();
      domRecorder.convertMutations({ final: true });
      await Promise.all([networkRecorder.flush(), domRecorder.flush(STOP_FLUSH_MS)]);
      await Promise.all([network.stream, dom.stream].map((stream) => new Promise((resolve) => stream.end(resolve))));
    },
  };
}

/**
 * Start recording the application run's page into logs/traces/<timestamp>
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.page - Raw engine page
 * @returns {Promise<string>} Trace directory
 */
export async function startTracing({ commander, page }) {
  current = await createTracing({ commander, page });
  console.log(`🎥 Recording trace to ${current.directory}`);
  return current.directory;
}

/**
 * Name the current page state in the run's trace (DOM snapshot + screenshot)
 * @param {string} name
 */
export async function checkpoint(name) {
  await current?.checkpoint(name);
}

/**
 * Finish the run's trace so the bundle and its Links Notation exports are complete
 */
export async function stopTracing() {
  const tracing = current;
  current = null;
  await tracing?.stop();
}
