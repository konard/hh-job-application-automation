/**
 * Third-party ad and tracker hosts on hh.ru pages whose requests hang until they time out (about
 * 30 s each). While they hang the page is never idle, so every click and page handler waited for
 * them: a full form was filled a minute late. Their requests are blocked in the browser, the way
 * an ad blocker does: the known ones from the start, any other host that is not hh.ru's own after
 * its first time out. Blocking keeps the HTTP cache (unlike request routing), so hh.ru gets no
 * more requests than before.
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

/**
 * Block the hanging hosts in a Chromium page (DevTools protocol, Network.setBlockedURLs)
 * @param {Object} page - Playwright page
 * @param {Object} [options]
 * @param {Function} [options.log]
 * @returns {Promise<Set<string>>} The blocked hosts
 */
export async function blockHangingHosts(page, { log = console.log } = {}) {
  const hosts = new Set(KNOWN_HANGING_HOSTS);
  const cdp = await page.context().newCDPSession(page);
  const apply = () => cdp.send('Network.setBlockedURLs', { urls: [...hosts].map((host) => `*://${host}/*`) });
  await cdp.send('Network.enable');
  await apply();
  page.on('requestfailed', (request) => {
    const host = hangingHost(request.url(), request.failure()?.errorText);
    if (host && !hosts.has(host)) {
      hosts.add(host);
      log(`🚧 ${host} timed out: its requests are blocked from now on, so pages are ready without waiting for it`);
      apply().catch(() => {});
    }
  });
  return hosts;
}
