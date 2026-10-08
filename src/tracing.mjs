/**
 * Debug recording with browser-commander traces
 *
 * - `trace/` - browser-commander trace bundle in continuous mode: DOM snapshot per
 *   checkpoint plus every DOM mutation, interactions, navigations and console
 * - `trace.lino` - Links Notation export of that trace, written while recording
 * - `network.lino` - Links Notation log of document/XHR/fetch responses.
 *   Workaround: browser-commander traces record only failed requests.
 *
 * @module tracing
 */

import fs from 'fs';
import path from 'path';
import { Link, formatLinks } from 'links-notation';
import { log } from './logging.mjs';

const RECORDED_RESOURCE_TYPES = new Set(['document', 'xhr', 'fetch']);

let trace = null;

const field = (name, value) => new Link(name, [new Link(String(value))]);

/**
 * Append one response to the network log
 */
function recordResponse(stream, response) {
  const request = response.request();
  if (!RECORDED_RESOURCE_TYPES.has(request.resourceType())) {
    return;
  }
  const link = new Link('response', [
    field('at', new Date().toISOString()),
    field('method', request.method()),
    field('status', response.status()),
    field('type', request.resourceType()),
    field('contentType', (response.headers()['content-type'] ?? '').split(';')[0] || '-'),
    field('url', response.url()),
  ]);
  stream.write(`${formatLinks([link])}\n`);
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

  trace = await commander.startTrace({
    output: path.join(directory, 'trace'),
    mode: 'continuous',
    links: { output: path.join(directory, 'trace.lino') },
  });

  const network = fs.createWriteStream(path.join(directory, 'network.lino'), { flags: 'a' });
  page.on('response', (response) => {
    try {
      recordResponse(network, response);
    } catch (error) {
      log.debug(() => `Network log error: ${error.message}`);
    }
  });

  console.log(`🎥 Recording trace to ${directory}`);
  return directory;
}

/**
 * Name the current page state in the trace (DOM snapshot + screenshot)
 * @param {string} name
 */
export async function checkpoint(name) {
  await trace?.checkpoint(name).catch((error) => log.debug(() => `Trace checkpoint failed: ${error.message}`));
}

/**
 * Finish the trace so the bundle and its Links Notation export are complete
 */
export async function stopTracing() {
  const current = trace;
  trace = null;
  await current?.stop().catch((error) => log.debug(() => `Trace stop failed: ${error.message}`));
}
