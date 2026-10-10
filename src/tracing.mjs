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
 * @module tracing
 */

import fs from 'fs';
import path from 'path';
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

let trace = null;
let recorders = {};
let streams = [];

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
 * Start recording into logs/traces/<timestamp>
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.page - Raw engine page
 * @returns {Promise<string>} Trace directory
 */
export async function startTracing({ commander, page }) {
  const directory = path.join(process.cwd(), 'logs', 'traces', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(directory, { recursive: true });

  // The network log starts first, so the requests of the initial checkpoint are in it
  const network = openLog(path.join(directory, 'network.lino'));
  const networkRecorder = recordNetwork({ page, write: network.write, onError: report('Network') });

  trace = await commander.startTrace({
    ...TRACE_OPTIONS,
    output: path.join(directory, 'trace'),
    links: { output: path.join(directory, 'trace.lino') },
  });

  const dom = openLog(path.join(directory, 'dom.lino'));
  const domRecorder = recordDom({ page, bundle: trace.path, write: dom.write, onError: report('DOM') });

  recorders = { network: networkRecorder, dom: domRecorder };
  streams = [network.stream, dom.stream];
  console.log(`🎥 Recording trace to ${directory}`);
  return directory;
}

/**
 * Name the current page state in the trace (DOM snapshot + screenshot)
 * @param {string} name
 */
export async function checkpoint(name) {
  await trace?.checkpoint(name).catch((error) => log.debug(() => `Trace checkpoint failed: ${error.message}`));
  // The checkpoint completed the previous interval's mutations; they are converted in the background
  void recorders.dom?.convertMutations();
}

/**
 * Finish the trace so the bundle and its Links Notation exports are complete
 */
export async function stopTracing() {
  const current = trace;
  const { network, dom } = recorders;
  const open = streams;
  trace = null;
  recorders = {};
  streams = [];
  network?.detach();
  dom?.detach();
  await current?.stop().catch((error) => log.debug(() => `Trace stop failed: ${error.message}`));
  dom?.convertMutations({ final: true });
  await Promise.all([network?.flush(), dom?.flush(STOP_FLUSH_MS)]);
  await Promise.all(open.map((stream) => new Promise((resolve) => stream.end(resolve))));
}
