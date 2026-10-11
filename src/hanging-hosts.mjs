/**
 * Third-party ad and tracker hosts on hh.ru pages whose requests hang until they time out (about
 * 30 s each). While they hang the page is not idle, so clicks and page handlers waited for them.
 * Their requests are answered at once in the browser with an empty pixel: the known ones from the
 * start, any other host that is not hh.ru's own after its first time out. Only their URLs are
 * intercepted, so the HTTP cache is kept and hh.ru gets no more requests than before.
 *
 * @module hanging-hosts
 */

/** Seen timing out on every hh.ru page */
export const KNOWN_HANGING_HOSTS = ['rap.skcrtxr.com', 'redirect-frontend.weborama-tech.ru', 'widget-api.uxfeedback.ru'];

/** hh.ru's own hosts are never blocked */
const OWN_HOST = /(^|\.)(hh\.ru|hhcdn\.ru)$/i;

/**
 * Whether a failed request makes its host one to block
 * @param {string} url
 * @param {string} errorText - Playwright's request.failure().errorText
 * @returns {string|null} The host to block, or null
 */
export function hangingHost(url, errorText) {
  if (!/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/.test(errorText ?? '')) {
    return null;
  }
  try {
    const host = new URL(url).hostname;
    return host && !OWN_HOST.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** A transparent 1x1 GIF: a tracking pixel that gets it counts as loaded and is not asked again */
const PIXEL = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Answer the hanging hosts' requests at once with an empty pixel (DevTools protocol, Fetch domain
 * for their URLs only). A blocked request fails, and the ad scripts asked again hundreds of times
 * a second; an answered one is done
 * @param {Object} page - Playwright page
 * @param {Object} [options]
 * @param {Function} [options.log]
 * @returns {Promise<Set<string>>} The hosts answered this way
 */
export async function blockHangingHosts(page, { log = console.log } = {}) {
  const hosts = new Set(KNOWN_HANGING_HOSTS);
  const cdp = await page.context().newCDPSession(page);
  const apply = () => cdp.send('Fetch.enable', { patterns: [...hosts].map((host) => ({ urlPattern: `*://${host}/*` })) });
  cdp.on('Fetch.requestPaused', ({ requestId }) => {
    cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'image/gif' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: PIXEL,
    }).catch(() => {});
  });
  await apply();
  page.on('requestfailed', (request) => {
    const host = hangingHost(request.url(), request.failure()?.errorText);
    if (host && !hosts.has(host)) {
      hosts.add(host);
      log(`🚧 ${host} timed out: its requests are answered at once from now on, so pages are ready without waiting for it`);
      apply().catch(() => {});
    }
  });
  return hosts;
}
