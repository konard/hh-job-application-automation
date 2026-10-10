/**
 * Requests and responses of a traced page in Links Notation (network.lino)
 *
 * browser-commander traces record only failed requests (`requestfailed`), so document,
 * XHR and fetch exchanges are recorded here: method, status, URL, request and response
 * headers and bodies. Credentials are redacted (names kept), text bodies are capped with
 * a truncation marker, binary bodies are skipped with their size.
 *
 * Recording never blocks the page: the `response` listener only takes a timestamp, the
 * headers and body are read afterwards and the line is written when they arrive.
 *
 * @module trace-network
 */

import { formatLinks, Link } from 'links-notation';
import { normalizePrivacyOptions, redactUrl } from 'browser-commander';
import { cappedField, field, group, redactBody, redactHeaders } from './trace-redaction.mjs';

export const RECORDED_RESOURCE_TYPES = new Set(['document', 'xhr', 'fetch']);
/** Text bodies longer than this are cut, with `(bodyTruncated: (bytes: N) (kept: M))` */
export const MAX_BODY_BYTES = 256 * 1024;
/** How long stopping waits for bodies that are still loading */
const FLUSH_TIMEOUT_MS = 3000;

const TEXT_TYPE = /^text\/|json|xml|javascript|ecmascript|graphql|x-www-form-urlencoded|multipart\/form-data/;
const privacy = normalizePrivacyOptions({ redactQueryParams: ['_xsrf', 'xsrf', 'csrf', 'hhtoken'] });

/**
 * MIME type without parameters, lower case
 * @param {Object<string, string>} headers
 * @returns {string}
 */
export function contentTypeOf(headers = {}) {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type');
  return (entry?.[1] ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Whether a body of this type is text worth recording; unknown types are sniffed
 * @param {string} contentType
 * @param {Buffer} [bytes]
 * @returns {boolean}
 */
export function isTextBody(contentType, bytes) {
  if (contentType) {
    // A multipart upload with a file is binary although its type is text-like
    return TEXT_TYPE.test(contentType) && !(contentType.startsWith('multipart/') && bytes?.includes(0));
  }
  return !bytes || !bytes.subarray(0, 1024).includes(0);
}

/**
 * Headers as links, HTTP/2 pseudo headers (:method, :path) left out: they repeat the request line
 * @param {string} name
 * @param {Object<string, string>} headers
 * @returns {Link}
 */
export function headersLink(name, headers) {
  return group(name, Object.entries(redactHeaders(headers))
    .filter(([header]) => !header.startsWith(':'))
    .map(([header, value]) => field(header.toLowerCase(), value)));
}

/**
 * Body links: the redacted, capped text, or why it was left out
 * @param {string} name - `requestBody` or `responseBody`
 * @param {Object} body
 * @param {Buffer|string|null} [body.bytes]
 * @param {number|null} [body.size] - Known size when the bytes were not read
 * @param {string} body.contentType
 * @param {string} [body.unavailable] - Why the body could not be read
 * @param {number} [maxBytes]
 * @returns {Link[]}
 */
export function bodyLinks(name, { bytes, size = null, contentType, unavailable }, maxBytes = MAX_BODY_BYTES) {
  if (unavailable) {
    return [group(`${name}Skipped`, [field('reason', 'unavailable'), field('detail', unavailable.split('\n')[0])])];
  }
  if (bytes === null || bytes === undefined) {
    return size ? [group(`${name}Skipped`, [field('reason', 'binary'), field('bytes', size)])] : [];
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  if (buffer.length === 0) {
    return [];
  }
  if (!isTextBody(contentType, buffer)) {
    return [group(`${name}Skipped`, [field('reason', 'binary'), field('bytes', buffer.length)])];
  }
  return cappedField(name, redactBody(buffer.toString('utf8'), contentType), maxBytes);
}

async function readHeaders(message) {
  try {
    return (await message.allHeaders?.()) ?? message.headers();
  } catch {
    return message.headers?.() ?? {};
  }
}

async function readResponseBody(response, request, contentType) {
  if (contentType && !isTextBody(contentType)) {
    // Binary: only its size, without transferring the bytes
    const sizes = await request.sizes?.().catch(() => null);
    const length = Number(response.headers()['content-length']);
    return { bytes: null, size: sizes?.responseBodySize || (Number.isFinite(length) ? length : null) };
  }
  try {
    return { bytes: await (response.body ? response.body() : response.buffer()) };
  } catch (error) {
    return { unavailable: error.message };
  }
}

/**
 * One request/response exchange as a `(response: …)` link
 * @param {Object} response - Playwright or Puppeteer response
 * @param {Object} [options]
 * @param {string} [options.at] - When the response arrived (ISO)
 * @param {number} [options.id] - Sequence number in this log
 * @param {number} [options.maxBodyBytes]
 * @returns {Promise<Link>}
 */
export async function describeExchange(response, { at = new Date().toISOString(), id, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const request = response.request();
  const [requestHeaders, responseHeaders] = await Promise.all([readHeaders(request), readHeaders(response)]);
  const requestType = contentTypeOf(requestHeaders);
  const responseType = contentTypeOf(responseHeaders);
  const postData = request.postDataBuffer?.() ?? request.postData?.() ?? null;
  const responseBody = await readResponseBody(response, request, responseType);
  return new Link('response', [
    field('id', id),
    field('at', at),
    field('method', request.method()),
    field('status', response.status()),
    field('type', request.resourceType()),
    field('contentType', responseType || '-'),
    field('url', redactUrl(response.url(), privacy)),
    headersLink('requestHeaders', requestHeaders),
    ...bodyLinks('requestBody', { bytes: postData, contentType: requestType }, maxBodyBytes),
    headersLink('responseHeaders', responseHeaders),
    ...bodyLinks('responseBody', { ...responseBody, contentType: responseType }, maxBodyBytes),
  ].filter(Boolean));
}

/**
 * Record the document/XHR/fetch exchanges of a page
 * @param {Object} options
 * @param {Object} options.page - Raw engine page (`on`/`off` 'response')
 * @param {(text: string) => void} options.write - Receives one Links Notation line per exchange
 * @param {(error: Error) => void} [options.onError]
 * @param {number} [options.maxBodyBytes]
 * @returns {{flush: (timeoutMs?: number) => Promise<void>, detach: () => void}}
 */
export function recordNetwork({ page, write, onError = () => {}, maxBodyBytes = MAX_BODY_BYTES }) {
  const pending = new Set();
  let sequence = 0;
  const listener = (response) => {
    let type;
    try {
      type = response.request().resourceType();
    } catch (error) {
      onError(error);
      return;
    }
    if (!RECORDED_RESOURCE_TYPES.has(type)) {
      return;
    }
    const task = describeExchange(response, { at: new Date().toISOString(), id: ++sequence, maxBodyBytes })
      .then((link) => write(`${formatLinks([link])}\n`))
      .catch(onError)
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on('response', listener);
  return {
    async flush(timeoutMs = FLUSH_TIMEOUT_MS) {
      let timer;
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
      ]);
      clearTimeout(timer);
    },
    detach() {
      (page.off ?? page.removeListener)?.call(page, 'response', listener);
    },
  };
}
