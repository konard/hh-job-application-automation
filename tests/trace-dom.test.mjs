/**
 * Unit tests for the DOM log of traces: snapshots, mutation batches, redaction and caps
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, test, assert } from 'test-anywhere';
import { formatLinks, Parser } from 'links-notation';
import { decodeLinkText, TRACE_EVENT_SOURCES } from 'browser-commander';
import { snapshotLink, mutationBatchLink, convertMutationFile, recordDom } from '../src/trace-dom.mjs';
import { REDACTED } from '../src/trace-redaction.mjs';
import { TRACE_OPTIONS } from '../src/tracing.mjs';

const parse = (text) => new Parser().parse(text);
const valueOf = (link, name) => {
  const child = link.values.find((item) => item.id === name);
  return child ? decodeLinkText(child.values[0].id) : undefined;
};

const batch = {
  sequence: 7,
  at: Date.UTC(2026, 9, 10, 12, 0, 0),
  url: 'https://hh.ru/applicant/vacancy_response?vacancyId=1',
  frameId: 'frame-1',
  navigationId: 'nav-2',
  mainFrame: true,
  records: [
    { kind: 'attributes', target: { type: 'element', tag: 'div', path: 'body > div', html: '<div class="b">…</div>' }, attribute: 'class', before: 'a', after: 'b' },
    { kind: 'attributes', target: { type: 'element', tag: 'input', path: 'form > input', html: '<input type="hidden" name="_xsrf" value="t">' }, attribute: 'value', before: 'old', after: 'new' },
    { kind: 'childList', target: { type: 'element', tag: 'ul', path: 'body > ul' }, added: [{ type: 'element', tag: 'li', path: 'body > ul > li', index: 0, html: '<li>"Go" and \'Rust\'</li>' }], removed: [], previous: null, next: null },
    { kind: 'characterData', target: { type: 'text', path: 'body > p' }, before: 'one', after: 'two' },
    { kind: 'live-state', property: 'value', target: { type: 'element', tag: 'textarea', path: 'form > textarea' }, before: '', after: 'Hello' },
  ],
};

describe('snapshotLink()', () => {
  test('writes the redacted DOM with its size, capped with a marker', () => {
    const html = `<html><input type="hidden" name="_xsrf" value="secret"><p>${'x'.repeat(200)}</p></html>`;
    const [link] = parse(formatLinks([snapshotLink({ at: '2026-10-10T00:00:00.000Z', reason: 'load', url: 'https://hh.ru/', html }, 80)]));
    assert.equal(link.id, 'snapshot');
    assert.equal(valueOf(link, 'reason'), 'load');
    assert.equal(valueOf(link, 'bytes'), String(Buffer.byteLength(html)));
    assert.ok(!valueOf(link, 'html').includes('secret'));
    assert.ok(valueOf(link, 'html').includes(`value="${REDACTED}"`));
    assert.equal(Buffer.byteLength(valueOf(link, 'html')), 80);
    assert.ok(link.values.some((item) => item.id === 'htmlTruncated'));
  });
});

describe('mutationBatchLink()', () => {
  test('turns every record kind into a link and redacts hidden input values', () => {
    const [link] = parse(formatLinks([mutationBatchLink(batch, 'mutations/0001.ndjson')]));
    assert.equal(link.id, 'mutations');
    assert.equal(valueOf(link, 'at'), '2026-10-10T12:00:00.000Z');
    assert.equal(valueOf(link, 'navigation'), 'nav-2');
    assert.deepEqual(link.values.slice(-5).map((item) => item.id), ['attributes', 'attributes', 'childList', 'text', 'liveState']);
    const [classChange, hiddenChange, childList] = link.values.slice(-5);
    assert.equal(valueOf(classChange, 'after'), 'b');
    assert.equal(valueOf(hiddenChange, 'before'), REDACTED);
    assert.equal(valueOf(hiddenChange, 'after'), REDACTED);
    const added = childList.values.find((item) => item.id === 'added');
    assert.equal(valueOf(added, 'html'), '<li>"Go" and \'Rust\'</li>');
  });
});

describe('convertMutationFile()', () => {
  test('streams a bundle file and stops at the cap with a marker', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-dom-'));
    const file = path.join(directory, '0001.ndjson');
    fs.writeFileSync(file, `${[batch, batch, batch].map((item) => JSON.stringify(item)).join('\n')}\n`);
    const lines = [];
    const all = await convertMutationFile(file, (text) => lines.push(text));
    assert.deepEqual(all, { batches: 3, written: Buffer.byteLength(lines.join('')), skipped: 0 });
    assert.equal(lines.length, 3);

    const capped = [];
    const result = await convertMutationFile(file, (text) => capped.push(text), 10);
    assert.equal(result.skipped, 2);
    assert.equal(capped.length, 2);
    const [marker] = parse(capped[1]);
    assert.equal(marker.id, 'mutationsTruncated');
    assert.equal(valueOf(marker, 'member'), 'mutations/0001.ndjson');
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('recordDom()', () => {
  test('snapshots at start and on every load, converts each completed mutation file once', async () => {
    const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-bundle-'));
    fs.mkdirSync(path.join(bundle, 'mutations'));
    fs.writeFileSync(path.join(bundle, 'mutations', '0001.ndjson'), `${JSON.stringify(batch)}\n`);
    const listeners = {};
    const page = {
      on: (name, fn) => { listeners[name] = fn; },
      off: (name) => { delete listeners[name]; },
      url: () => 'https://hh.ru/',
      content: async () => '<html><body>page</body></html>',
    };
    const lines = [];
    const recorder = recordDom({ page, bundle, write: (text) => lines.push(text) });
    listeners.load();
    await recorder.convertMutations();
    fs.writeFileSync(path.join(bundle, 'mutations', '0002.ndjson'), `${JSON.stringify(batch)}\n`);
    await recorder.convertMutations();
    await recorder.flush();
    const ids = lines.map((line) => parse(line)[0].id);
    assert.equal(ids.filter((id) => id === 'snapshot').length, 2);
    assert.equal(ids.filter((id) => id === 'mutations').length, 2);
    recorder.detach();
    assert.equal(listeners.load, undefined);
    fs.rmSync(bundle, { recursive: true, force: true });
  });
});

describe('TRACE_OPTIONS', () => {
  test('avoid the Trusted Types failure and redact hidden inputs in the bundle', () => {
    assert.equal(TRACE_OPTIONS.dom.openShadowRoots, false);
    assert.ok(TRACE_OPTIONS.privacy.redactSelectors.includes('input[type=hidden]'));
    assert.equal(TRACE_OPTIONS.mode, 'continuous');
  });

  test('keep every browser-commander event source: console messages and page errors are on the timeline', () => {
    assert.equal(TRACE_OPTIONS.events, undefined);
    assert.ok(TRACE_EVENT_SOURCES.includes('console'));
    assert.ok(TRACE_EVENT_SOURCES.includes('pageerror'));
    assert.ok(TRACE_EVENT_SOURCES.includes('requestfailed'));
  });
});
