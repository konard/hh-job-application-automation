/**
 * A site's login taken from a browser you already use (Google Chrome, Safari, Firefox, Edge,
 * Brave, Yandex, Arc, …), so a browser slot of the automation does not start signed out.
 *
 * The installed browsers holding cookies of the site are listed (names and counts only), the one
 * with the most is tried first: its cookies are read with browser-commander and set in the slot,
 * and the slot is checked to be signed in. Chrome-family cookies are read by the browser itself
 * from a copy of its profile, without a window (no Keychain prompt); Safari's and Firefox's are
 * read from their cookie files (Safari needs Full Disk Access for the terminal). Cookie values are
 * never printed, and kept nowhere but the slot's own profile (no cookie cache on disk).
 *
 * @module user-sessions
 */

import { listCookieSources, readBrowserCookies, setCookies } from 'browser-commander';

const cookieCount = (source) => Object.values(source.byDomain ?? {}).reduce((sum, n) => sum + n, 0);

/**
 * Browser profiles to try, most cookies of the site first (only names and counts are read here)
 * @param {Array<Object>} sources - listCookieSources entries
 * @param {Object} [choice]
 * @param {string} [choice.from] - Only this browser (chrome, safari, firefox, …)
 * @param {string} [choice.profile] - Only this profile
 * @param {(source: Object) => boolean} [choice.accept] - Any other condition
 * @returns {Array<Object>}
 */
export function candidateSources(sources, { from = '', profile = '', accept = () => true } = {}) {
  return sources
    .filter((source) => !source.error && cookieCount(source) > 0)
    .filter((source) => (!from || source.browser === from) && (!profile || source.profile === profile) && accept(source))
    .sort((a, b) => cookieCount(b) - cookieCount(a));
}

/**
 * Sign a slot in with the session of a browser you already use
 * @param {Object} options
 * @param {Object} options.page - A Playwright or Puppeteer page of the slot
 * @param {string} options.domain - The site's domain (hh.ru, linkedin.com)
 * @param {() => Promise<boolean>} options.signedIn - Opens a page of the site and tells whether it is signed in
 * @param {string} [options.from] - Only this browser
 * @param {string} [options.profile] - Only this profile
 * @param {(source: Object) => boolean} [options.accept] - Any other condition on the browser profile
 * @param {Array<Object>} [options.sources] - listCookieSources entries, when already listed
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{browser: string, profile: string, cookies: number}|null>} The browser profile used, or null
 */
export async function importUserSession({ page, domain, signedIn, from, profile, accept, sources, log = console.log }) {
  const listed = sources ?? await listCookieSources({ domains: [domain] });
  if (listed.some((source) => source.browser === 'safari' && source.error)) {
    log('   Safari: give your terminal app Full Disk Access (System Settings → Privacy & Security) to read it');
  }
  const engine = typeof page.context === 'function' ? 'playwright' : 'puppeteer';
  for (const source of candidateSources(listed, { from, profile, accept })) {
    const name = `${source.browser} (${source.profile})`;
    try {
      const cookies = await readBrowserCookies({
        browser: source.browser, profile: source.profile, domainFilter: domain, ignoreDecryptionErrors: true, cache: false,
      });
      if (cookies.length === 0) {
        continue;
      }
      await setCookies({ page, engine, cookies });
      if (await signedIn()) {
        log(`🔓 Signed in to ${domain} with the session of ${name}: ${cookies.length} cookie(s), values not shown`);
        return { browser: source.browser, profile: source.profile, cookies: cookies.length };
      }
      log(`⚠️  The ${domain} session of ${name} is not signed in (expired or logged out)`);
    } catch (error) {
      log(`⚠️  Could not read the ${domain} session of ${name}: ${error.message.split('\n')[0]}`);
    }
  }
  return null;
}
