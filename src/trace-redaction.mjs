/**
 * Redaction and size caps for what the local trace recorders write (network.lino, dom.lino)
 *
 * Secrets are replaced before a byte reaches disk: names stay, values become `[redacted]`.
 * Links Notation values are encoded with browser-commander's `encodeLinkText`, so a value
 * holding quotes or newlines reads back unchanged.
 *
 * @module trace-redaction
 */

import { Link } from 'links-notation';
import { DEFAULT_REDACT_ATTRIBUTES, REDACTED, encodeLinkText } from 'browser-commander';

export { REDACTED };

/** Header names whose value is a credential, beyond browser-commander's list (Cookie, Authorization, ...) */
const SECRET_HEADER = /token|csrf|xsrf|secret|password|api-?key|session|auth/i;
/** Form, JSON and query field names whose value is a credential */
const SECRET_FIELD = /pass|pwd|token|csrf|xsrf|secret|api[-_]?key|otp|session|auth|cookie|credential|^pin$|^code$/i;
/** Words that name a credential in free text (scripts, embedded JSON) */
const SECRET_KEY = /token|csrf|xsrf|password|secret/gi;
/** The rest of `"xsrfToken":"…"`, `password: '…'` after the word: the quoted value */
const SECRET_ASSIGNMENT = /[\w.-]*(?:&quot;|["'])?\s*[:=]\s*(&quot;|["'])([^"'\n&]{1,4096})\1/y;
const SECRET_INPUT_TYPE = /\btype\s*=\s*["']?(?:hidden|password)\b/i;
const INPUT_VALUE = /(\bvalue\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i;

/**
 * Whether a header carries a credential
 * @param {string} name
 * @returns {boolean}
 */
export function isSecretHeader(name) {
  const lower = String(name).toLowerCase();
  return DEFAULT_REDACT_ATTRIBUTES.includes(lower) || SECRET_HEADER.test(lower);
}

/**
 * Whether a form or JSON field carries a credential
 * @param {string} name
 * @returns {boolean}
 */
export function isSecretField(name) {
  return SECRET_FIELD.test(String(name));
}

/**
 * Headers with credential values replaced, names kept
 * @param {Object<string, string>} headers
 * @returns {Object<string, string>}
 */
export function redactHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers)
    .map(([name, value]) => [name, isSecretHeader(name) ? REDACTED : String(value)]));
}

/**
 * Credential values inside free text (scripts, embedded JSON, HTML) replaced
 * @param {string} text
 * @returns {string}
 */
export function redactText(text) {
  // The word is found first and the value is matched only after it: a pattern starting with
  // `[\w.-]*` would be retried at every position of a 3 MB page
  let result = '';
  let copied = 0;
  SECRET_KEY.lastIndex = 0;
  for (let key = SECRET_KEY.exec(text); key; key = SECRET_KEY.exec(text)) {
    SECRET_ASSIGNMENT.lastIndex = key.index + key[0].length;
    const assignment = SECRET_ASSIGNMENT.exec(text);
    if (!assignment) {
      continue;
    }
    const valueEnd = SECRET_ASSIGNMENT.lastIndex - assignment[1].length;
    result += `${text.slice(copied, valueEnd - assignment[2].length)}${REDACTED}`;
    copied = valueEnd;
    SECRET_KEY.lastIndex = SECRET_ASSIGNMENT.lastIndex;
  }
  return result + text.slice(copied);
}

/**
 * HTML with the values of hidden and password inputs replaced (CSRF tokens live there),
 * and credentials in embedded scripts and state replaced
 * @param {string} html
 * @returns {string}
 */
export function redactHtml(html) {
  return redactText(html.replace(/<input\b[^>]*>/gi, (tag) =>
    SECRET_INPUT_TYPE.test(tag) ? tag.replace(INPUT_VALUE, `$1"${REDACTED}"`) : tag));
}

function redactJsonValue(value, key = '') {
  if (key && isSecretField(key) && value !== null && typeof value !== 'object') {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactJsonValue(item, name)]));
  }
  return value;
}

/**
 * A request or response body with credential values replaced, by its content type:
 * form fields and JSON keys by name, multipart parts by name, HTML inputs, text by pattern
 * @param {string} text
 * @param {string} contentType - Lower-case MIME type without parameters
 * @returns {string}
 */
export function redactBody(text, contentType = '') {
  if (contentType === 'application/x-www-form-urlencoded') {
    return text.split('&').map((pair) => {
      const name = pair.split('=')[0];
      let decoded = name;
      try {
        decoded = decodeURIComponent(name.replace(/\+/g, ' '));
      } catch {
        // A malformed name is kept as it is
      }
      return pair.includes('=') && isSecretField(decoded) ? `${name}=${REDACTED}` : pair;
    }).join('&');
  }
  if (contentType.includes('json')) {
    try {
      return JSON.stringify(redactJsonValue(JSON.parse(text)));
    } catch {
      return redactText(text);
    }
  }
  if (contentType === 'multipart/form-data' || /^--\S+\r?\n/.test(text)) {
    return text.replace(/(Content-Disposition:[^\n]*\bname="([^"]*)"[^\n]*\r?\n\r?\n)([^\r\n]*)/gi,
      (match, head, name, value) => (isSecretField(name) ? `${head}${REDACTED}` : `${head}${value}`));
  }
  if (contentType.includes('html') || contentType.includes('xml')) {
    return redactHtml(text);
  }
  return redactText(text);
}

/**
 * Text cut to a byte budget (UTF-8), without splitting a character
 * @param {string} text
 * @param {number} maxBytes
 * @returns {{text: string, bytes: number, truncated: boolean}}
 */
export function capText(text, maxBytes) {
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxBytes) {
    return { text, bytes, truncated: false };
  }
  const cut = Buffer.from(text).subarray(0, maxBytes).toString('utf8').replace(/�$/, '');
  return { text: cut, bytes, truncated: true };
}

/**
 * One `(name: value)` link, nothing for null/undefined
 * @param {string} name
 * @param {*} value
 * @returns {Link|null}
 */
export function field(name, value) {
  if (value === null || value === undefined) {
    return null;
  }
  return new Link(name, [new Link(encodeLinkText(value))]);
}

/**
 * `(name: (child) (child) …)` without empty children
 * @param {string} name
 * @param {Array<Link|null>} children
 * @returns {Link}
 */
export function group(name, children) {
  return new Link(name, children.filter(Boolean));
}

/**
 * A capped text as links: `(name: '…')`, plus `(nameTruncated: (bytes: N) (kept: M))` when cut
 * @param {string} name
 * @param {string} text
 * @param {number} maxBytes
 * @returns {Link[]}
 */
export function cappedField(name, text, maxBytes) {
  const capped = capText(text, maxBytes);
  return [
    field(name, capped.text),
    capped.truncated
      ? group(`${name}Truncated`, [field('bytes', capped.bytes), field('kept', Buffer.byteLength(capped.text))])
      : null,
  ].filter(Boolean);
}
