/**
 * The DOM of a traced page and its changes in Links Notation (dom.lino)
 *
 * browser-commander's trace bundle holds the DOM (checkpoints/*.html) and every change to it
 * (mutations/*.ndjson), but its Links Notation export only points at those files. This module
 * writes them as links:
 *
 * - `(snapshot: …)` - the serialized DOM after every page load, read with `page.content()`,
 *   which only reads the document: no script, attribute or marker is added to the page, and
 *   nothing is assigned to a Trusted Types sink
 * - `(mutations: …)` - every DOM mutation batch of the bundle, converted when a checkpoint
 *   or the end of the trace has written it
 *
 * Values of hidden and password inputs and credentials in embedded state are redacted;
 * snapshots and the mutations of one interval are capped with a truncation marker.
 *
 * @module trace-dom
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { formatLinks, Link } from 'links-notation';
import { cappedField, capText, field, group, redactHtml, redactText, REDACTED } from './trace-redaction.mjs';

/** A snapshot longer than this is cut (hh.ru pages are about 3 MB, most of it embedded state) */
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
/** One interval's mutations (between two checkpoints) are cut after this many bytes of links */
export const MAX_MUTATION_BYTES_PER_INTERVAL = 16 * 1024 * 1024;
/** Each text in a mutation record (node HTML, attribute values) */
const MAX_VALUE_BYTES = 4000;
const FLUSH_TIMEOUT_MS = 5000;

/**
 * One DOM snapshot as a link
 * @param {Object} snapshot
 * @param {string} snapshot.at - ISO time
 * @param {string} snapshot.reason - What triggered it (start, load)
 * @param {string} snapshot.url
 * @param {string} snapshot.html
 * @param {number} [maxBytes]
 * @returns {Link}
 */
export function snapshotLink({ at, reason, url, html }, maxBytes = MAX_SNAPSHOT_BYTES) {
  return new Link('snapshot', [
    field('at', at),
    field('reason', reason),
    field('url', url),
    field('bytes', Buffer.byteLength(html)),
    ...cappedField('html', redactHtml(html), maxBytes),
  ]);
}

const isSecretElement = (described) => /^<input\b[^>]*\btype\s*=\s*["']?(?:hidden|password)\b/i.test(described?.html ?? '');

const value = (text) => (typeof text === 'string' ? capText(redactText(text), MAX_VALUE_BYTES).text : text);

function nodeLink(name, node) {
  if (!node) {
    return null;
  }
  return group(name, [
    field('type', node.type),
    field('tag', node.tag),
    field('id', node.id),
    field('path', node.path),
    field('index', node.index),
    field('text', value(node.text)),
    field('html', typeof node.html === 'string' ? capText(redactHtml(node.html), MAX_VALUE_BYTES).text : null),
  ]);
}

/**
 * One mutation record as a link. Attribute and state changes name their element by path only;
 * added and removed nodes keep their (capped, redacted) HTML.
 * @param {Object} record - A record of a browser-commander mutation batch
 * @returns {Link}
 */
export function mutationRecordLink(record) {
  const secret = isSecretElement(record.target);
  const change = (text) => (secret && text !== null && text !== undefined ? REDACTED : value(text));
  const target = record.target ?? {};
  switch (record.kind) {
  case 'attributes':
    return group('attributes', [field('path', target.path), field('attribute', record.attribute),
      field('before', change(record.before)), field('after', change(record.after))]);
  case 'characterData':
    return group('text', [field('path', target.path), field('before', value(record.before)), field('after', value(record.after))]);
  case 'childList':
    return group('childList', [
      field('path', target.path),
      ...(record.added ?? []).map((node) => nodeLink('added', node)),
      ...(record.removed ?? []).map((node) => nodeLink('removed', node)),
      field('previous', record.previous?.path),
      field('next', record.next?.path),
    ]);
  case 'live-state':
    return group('liveState', [field('path', target.path), field('property', record.property),
      field('before', change(record.before)), field('after', change(record.after))]);
  default:
    return group(record.kind ?? 'record', Object.entries(record)
      .filter(([name]) => name !== 'kind' && name !== 'target')
      .map(([name, item]) => field(name, typeof item === 'object' ? JSON.stringify(item) : value(item))));
  }
}

/**
 * One mutation batch as a `(mutations: …)` link
 * @param {Object} batch - A line of a bundle's mutations/NNNN.ndjson
 * @param {string} [member] - The bundle file it came from
 * @returns {Link}
 */
export function mutationBatchLink(batch, member) {
  return new Link('mutations', [
    field('at', typeof batch.at === 'number' ? new Date(batch.at).toISOString() : batch.at),
    field('member', member),
    field('sequence', batch.sequence),
    field('navigation', batch.navigationId),
    field('frame', batch.frameId),
    field('mainFrame', batch.mainFrame),
    field('url', batch.url),
    ...(batch.records ?? []).map(mutationRecordLink),
  ].filter(Boolean));
}

/**
 * Write one bundle mutation file as links, streaming it line by line
 * @param {string} file - mutations/NNNN.ndjson
 * @param {(text: string) => void} write
 * @param {number} [maxBytes]
 * @returns {Promise<{batches: number, written: number, skipped: number}>}
 */
export async function convertMutationFile(file, write, maxBytes = MAX_MUTATION_BYTES_PER_INTERVAL) {
  const member = path.posix.join('mutations', path.basename(file));
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let written = 0;
  let batches = 0;
  let skipped = 0;
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    batches++;
    if (written >= maxBytes) {
      skipped++;
      continue;
    }
    let batch;
    try {
      batch = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const text = `${formatLinks([mutationBatchLink(batch, member)])}\n`;
    written += Buffer.byteLength(text);
    write(text);
  }
  if (skipped > 0) {
    write(`${formatLinks([group('mutationsTruncated', [field('member', member), field('batches', batches), field('skipped', skipped), field('keptBytes', written)])])}\n`);
  }
  return { batches, written, skipped };
}

/**
 * Record the DOM of a page: a snapshot now and after every load, and the bundle's mutations
 * @param {Object} options
 * @param {Object} options.page - Raw engine page (`content()`, `url()`, `on`/`off` 'load')
 * @param {string} options.bundle - Directory of the browser-commander trace bundle
 * @param {(text: string) => void} options.write - Receives Links Notation lines
 * @param {(error: Error) => void} [options.onError]
 * @returns {{convertMutations: () => Promise<void>, flush: (timeoutMs?: number) => Promise<void>, detach: () => void}}
 */
export function recordDom({ page, bundle, write, onError = () => {} }) {
  const pending = new Set();
  const converted = new Set();
  let conversion = Promise.resolve();

  const track = (promise) => {
    const task = promise.catch(onError).finally(() => pending.delete(task));
    pending.add(task);
    return task;
  };

  const snapshot = (reason) => track((async () => {
    const at = new Date().toISOString();
    const html = await page.content();
    write(`${formatLinks([snapshotLink({ at, reason, url: page.url(), html })])}\n`);
  })());

  const onLoad = () => void snapshot('load');
  page.on('load', onLoad);
  void snapshot('start');

  return {
    /** Convert the mutation files the bundle has completed, in order, one at a time */
    convertMutations() {
      conversion = conversion.then(async () => {
        const directory = path.join(bundle, 'mutations');
        const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.ndjson')).sort() : [];
        for (const name of files.filter((file) => !converted.has(file))) {
          converted.add(name);
          await convertMutationFile(path.join(directory, name), write);
        }
      }).catch(onError);
      return track(conversion);
    },
    async flush(timeoutMs = FLUSH_TIMEOUT_MS) {
      let timer;
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
      ]);
      clearTimeout(timer);
    },
    detach() {
      (page.off ?? page.removeListener)?.call(page, 'load', onLoad);
    },
  };
}
