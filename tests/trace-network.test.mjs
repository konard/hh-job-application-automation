/**
 * Unit tests for the network log of traces: redaction, size caps, binary bodies, Links Notation
 */

import { describe, test, assert } from 'test-anywhere';
import { Parser } from 'links-notation';
import { decodeLinkText } from 'browser-commander';
import { redactBody, redactHeaders, redactHtml, capText, REDACTED } from '../src/trace-redaction.mjs';
import { describeExchange, recordNetwork, bodyLinks, isTextBody } from '../src/trace-network.mjs';
import { formatLinks } from 'links-notation';

/** Fake Playwright request/response pair */
function fakeExchange({
  method = 'GET',
  type = 'xhr',
  url = 'https://hh.ru/applicant/vacancy_response/popup',
  status = 200,
  requestHeaders = {},
  postData = null,
  responseHeaders = { 'content-type': 'application/json; charset=utf-8' },
  body = '{}',
  bodyError = null,
  sizes = null,
} = {}) {
  const calls = { body: 0 };
  const request = {
    method: () => method,
    resourceType: () => type,
    headers: () => requestHeaders,
    allHeaders: async () => requestHeaders,
    postData: () => postData,
    postDataBuffer: () => (postData === null ? null : Buffer.from(postData)),
    sizes: async () => sizes,
  };
  const response = {
    request: () => request,
    url: () => url,
    status: () => status,
    headers: () => responseHeaders,
    allHeaders: async () => responseHeaders,
    body: async () => {
      calls.body++;
      if (bodyError) {
        throw new Error(bodyError);
      }
      return Buffer.isBuffer(body) ? body : Buffer.from(body);
    },
  };
  return { response, calls };
}

/** `(name: value)` pairs of a parsed link, values decoded */
function fieldsOf(link) {
  const result = {};
  for (const child of link.values ?? []) {
    result[child.id] = child.values?.length === 1 && !child.values[0].values?.length
      ? decodeLinkText(child.values[0].id)
      : child;
  }
  return result;
}

const roundTrip = (link) => new Parser().parse(formatLinks([link]))[0];

describe('trace redaction', () => {
  test('replaces credential header values and keeps the names', () => {
    const headers = redactHeaders({
      Cookie: 'hhtoken=abc; _xsrf=def',
      'Set-Cookie': 'crypted_id=1',
      Authorization: 'Bearer x',
      'X-Xsrftoken': 'def',
      'X-Hh-App-Token': 'secret',
      Accept: 'application/json',
    });
    assert.equal(headers.Cookie, REDACTED);
    assert.equal(headers['Set-Cookie'], REDACTED);
    assert.equal(headers.Authorization, REDACTED);
    assert.equal(headers['X-Xsrftoken'], REDACTED);
    assert.equal(headers['X-Hh-App-Token'], REDACTED);
    assert.equal(headers.Accept, 'application/json');
  });

  test('redacts password-like form fields by name', () => {
    const body = redactBody('login=me&password=p%40ss&_xsrf=abc&letter=Hello', 'application/x-www-form-urlencoded');
    assert.equal(body, `login=me&password=${REDACTED}&_xsrf=${REDACTED}&letter=Hello`);
  });

  test('redacts JSON keys at any depth', () => {
    const body = JSON.parse(redactBody('{"user":{"accessToken":"t","name":"N"},"items":[{"csrf":"c"}]}', 'application/json'));
    assert.equal(body.user.accessToken, REDACTED);
    assert.equal(body.user.name, 'N');
    assert.equal(body.items[0].csrf, REDACTED);
  });

  test('redacts multipart fields by name', () => {
    const body = '--b\r\nContent-Disposition: form-data; name="_xsrf"\r\n\r\nabc\r\n--b\r\nContent-Disposition: form-data; name="text"\r\n\r\nhi\r\n--b--';
    const redacted = redactBody(body, 'multipart/form-data');
    assert.ok(redacted.includes(`name="_xsrf"\r\n\r\n${REDACTED}`));
    assert.ok(redacted.includes('name="text"\r\n\r\nhi'));
  });

  test('redacts hidden and password inputs and tokens in embedded state', () => {
    const html = '<input type="hidden" name="_xsrf" value="abc"><input name="q" value="go">'
      + '<input value="pw" type=password><template>{"xsrfToken":"zzz","title":"Dev"}</template>';
    const redacted = redactHtml(html);
    assert.ok(redacted.includes(`name="_xsrf" value="${REDACTED}"`));
    assert.ok(redacted.includes('name="q" value="go"'));
    assert.ok(redacted.includes(`value="${REDACTED}" type=password`));
    assert.ok(redacted.includes(`"xsrfToken":"${REDACTED}"`));
    assert.ok(redacted.includes('"title":"Dev"'));
    assert.ok(!redacted.includes('zzz') && !redacted.includes('abc'));
  });

  test('caps text by bytes without splitting a character', () => {
    const capped = capText('ЖЖЖЖ', 5);
    assert.equal(capped.truncated, true);
    assert.equal(capped.bytes, 8);
    assert.equal(capped.text, 'ЖЖ');
    assert.equal(capText('short', 10).truncated, false);
  });
});

describe('describeExchange()', () => {
  test('records headers and bodies of a form post with secrets redacted', async () => {
    const { response } = fakeExchange({
      method: 'POST',
      url: 'https://hh.ru/applicant/vacancy_response/popup?token=abc&vacancyId=1',
      requestHeaders: { ':method': 'POST', cookie: 'hhtoken=abc', 'x-xsrftoken': 'abc', 'content-type': 'application/x-www-form-urlencoded' },
      postData: 'vacancy_id=1&_xsrf=abc&letter=Hi',
      responseHeaders: { 'content-type': 'application/json', 'set-cookie': 'a=b' },
      body: '{"success":"true","xsrfToken":"abc"}',
    });
    const link = await describeExchange(response, { at: '2026-10-10T00:00:00.000Z', id: 1 });
    const text = formatLinks([link]);
    assert.ok(!text.includes('abc'), 'no secret value reaches the log');
    const fields = fieldsOf(roundTrip(link));
    assert.equal(fields.method, 'POST');
    assert.equal(fields.status, '200');
    assert.equal(fields.type, 'xhr');
    assert.ok(fields.url.includes('vacancyId=1') && fields.url.includes(`token=${REDACTED}`));
    const requestHeaders = fieldsOf(fields.requestHeaders);
    assert.equal(requestHeaders.cookie, REDACTED);
    assert.equal(requestHeaders['x-xsrftoken'], REDACTED);
    assert.equal(requestHeaders[':method'], undefined, 'pseudo headers are left out');
    assert.equal(fields.requestBody, `vacancy_id=1&_xsrf=${REDACTED}&letter=Hi`);
    assert.equal(fieldsOf(fields.responseHeaders)['set-cookie'], REDACTED);
    assert.equal(JSON.parse(fields.responseBody).xsrfToken, REDACTED);
  });

  test('caps long text bodies with a truncation marker', async () => {
    const { response } = fakeExchange({ responseHeaders: { 'content-type': 'text/html' }, body: `<p>${'x'.repeat(5000)}</p>` });
    const fields = fieldsOf(roundTrip(await describeExchange(response, { maxBodyBytes: 100 })));
    assert.equal(Buffer.byteLength(fields.responseBody), 100);
    const marker = fieldsOf(fields.responseBodyTruncated);
    assert.equal(marker.bytes, '5007');
    assert.equal(marker.kept, '100');
  });

  test('skips binary bodies with their size, without reading them', async () => {
    const { response, calls } = fakeExchange({ type: 'fetch', responseHeaders: { 'content-type': 'image/gif' }, sizes: { responseBodySize: 43 } });
    const fields = fieldsOf(roundTrip(await describeExchange(response)));
    assert.equal(calls.body, 0);
    const skipped = fieldsOf(fields.responseBodySkipped);
    assert.equal(skipped.reason, 'binary');
    assert.equal(skipped.bytes, '43');
    assert.equal(fields.responseBody, undefined);
  });

  test('sniffs binary bodies of an unknown type', () => {
    const [link] = bodyLinks('responseBody', { bytes: Buffer.from([1, 0, 2, 3]), contentType: '' });
    assert.equal(link.id, 'responseBodySkipped');
    assert.equal(isTextBody('', Buffer.from('plain')), true);
  });

  test('notes bodies that cannot be read (redirects)', async () => {
    const { response } = fakeExchange({ status: 302, type: 'document', responseHeaders: { location: '/x' }, bodyError: 'Response body is unavailable for redirect responses' });
    const fields = fieldsOf(roundTrip(await describeExchange(response)));
    assert.equal(fieldsOf(fields.responseBodySkipped).reason, 'unavailable');
  });

  test('keeps values with quotes and newlines readable', async () => {
    const { response } = fakeExchange({ responseHeaders: { 'content-type': 'text/plain' }, body: 'a "b"\n\'c\' (d): e' });
    const fields = fieldsOf(roundTrip(await describeExchange(response)));
    assert.equal(fields.responseBody, 'a "b"\n\'c\' (d): e');
  });
});

describe('recordNetwork()', () => {
  test('writes one line per document/xhr/fetch exchange without waiting in the listener', async () => {
    const listeners = {};
    const page = { on: (name, fn) => { listeners[name] = fn; }, off: (name) => { delete listeners[name]; } };
    const lines = [];
    const recorder = recordNetwork({ page, write: (text) => lines.push(text) });
    const started = Date.now();
    listeners.response(fakeExchange({ type: 'document', responseHeaders: { 'content-type': 'text/html' }, body: '<p>hi</p>' }).response);
    listeners.response(fakeExchange({ type: 'image' }).response);
    listeners.response(fakeExchange({ type: 'fetch' }).response);
    assert.ok(Date.now() - started < 50, 'the listener returns at once');
    assert.equal(lines.length, 0, 'bodies are read after the listener returned');
    await recorder.flush();
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => line.startsWith('(response: (id: ') && line.endsWith('\n')));
    recorder.detach();
    assert.equal(listeners.response, undefined);
  });
});
