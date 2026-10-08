/**
 * hh.ru login without user actions.
 *
 * 1. Detect logins available on this machine: browser profiles holding cookies of
 *    hh.ru or of the social networks hh.ru accepts for sign-in (VK, Mail.ru, OK, ...).
 * 2. Start a temporary snapshot of the best Chromium profile. Chrome decrypts its own
 *    cookies, so no Keychain prompt is shown. If that profile is not logged in to
 *    hh.ru, sign in through the social network whose session it holds.
 * 3. Copy the resulting hh.ru cookies into the persistent automation browser.
 * 4. Fall back to waiting for a manual login in the automation browser.
 *
 * @module login
 */

import {
  findBrowserSource,
  launchBrowser,
  listCookieSources,
  makeBrowserCommander,
  saveStorageState,
} from 'browser-commander';
import { SELECTORS, URL_PATTERNS } from './hh-selectors.mjs';
import { dismissOverlays } from './helpers/page-helpers.mjs';
import { log } from './logging.mjs';

const HH_DOMAIN = 'hh.ru';
// Shows the login card inline when logged out and the profile when logged in
const PROFILE_URL = 'https://hh.ru/applicant/resumes';

/** Social sign-in providers offered by hh.ru, in order of preference */
const PROVIDERS = [
  { id: 'vk', domains: ['vk.com', 'vk.ru'] },
  { id: 'mail', domains: ['mail.ru'] },
  { id: 'ok', domains: ['ok.ru'] },
  { id: 'gplus', domains: ['google.com'] },
  { id: 'esia', domains: ['gosuslugi.ru'] },
];

// Launch channels for catalogue browser ids that differ from their channel name
const CHANNELS = { edge: 'msedge', 'edge-beta': 'msedge-beta', 'edge-dev': 'msedge-dev' };

const isHhCookie = ({ domain }) => domain.replace(/^\./, '') === HH_DOMAIN || domain.endsWith(`.${HH_DOMAIN}`);

/**
 * Whether the current hh.ru page is shown to a logged-in user
 * @param {Object} commander - Browser commander instance
 * @returns {Promise<boolean>}
 */
export async function isLoggedIn(commander) {
  if (!/(^|\.)hh\.ru$/.test(new URL(commander.getUrl()).hostname) || URL_PATTERNS.loginPage.test(commander.getUrl())) {
    return false;
  }
  return await commander.count({ selector: `${SELECTORS.loginLink}, ${SELECTORS.loginForm}` }) === 0;
}

/**
 * Logins available on this machine, best first. Only cookie names and counts are read.
 * @returns {Promise<Array<{browser: string, profile: string, hh: number, providers: string[], usable: boolean}>>}
 */
export async function detectLogins() {
  const domains = [HH_DOMAIN, ...PROVIDERS.flatMap(({ domains: providerDomains }) => providerDomains)];
  const logins = [];
  for (const source of await listCookieSources({ domains })) {
    if (source.error) {
      console.log(`⚠️  ${source.browser} (${source.profile}): ${source.error}`);
      continue;
    }
    const providers = PROVIDERS
      .filter(({ domains: providerDomains }) => providerDomains.some((domain) => source.byDomain[domain] > 0))
      .map(({ id }) => id);
    logins.push({
      browser: source.browser,
      profile: source.profile,
      hh: source.byDomain[HH_DOMAIN],
      providers,
      // Only Chromium-family profiles can be snapshotted and driven over CDP
      usable: findBrowserSource(source.browser)?.family === 'chromium',
    });
  }
  return logins.sort((a, b) => b.usable - a.usable || b.providers.length - a.providers.length || b.hh - a.hh);
}

/**
 * Sign in to hh.ru with a social network session held by the snapshot profile
 * @returns {Promise<boolean>}
 */
async function signInWithProvider(commander, provider) {
  await commander.evaluate((selector) => document.querySelector(selector)?.click(), SELECTORS.loginSocialShowMore);
  await commander.wait({ ms: 1500, reason: 'social login buttons' });
  const clicked = await commander.evaluate(
    (selector) => {
      const link = document.querySelector(selector);
      link?.click();
      return Boolean(link);
    },
    SELECTORS.loginSocial(provider),
  );
  if (!clicked) {
    return false;
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    await commander.wait({ ms: 1500, reason: `${provider} sign-in` });
    if (await isLoggedIn(commander).catch(() => false)) {
      return true;
    }
    // Confirm the sign-in once when the provider asks ("Continue as ...")
    await commander.evaluate((pattern) => {
      const button = [...document.querySelectorAll('button, [role="button"]')]
        .find((el) => el.offsetParent && new RegExp(pattern, 'i').test(el.textContent.trim()));
      button?.click();
    }, SELECTORS.providerConfirmPattern).catch(() => {});
  }
  return false;
}

/**
 * Get logged-in hh.ru cookies from a snapshot of a browser profile
 * @returns {Promise<Object[]|null>}
 */
async function hhCookiesFromProfile({ browser, profile, providers }) {
  const session = await launchBrowser({
    engine: 'playwright',
    channel: CHANNELS[browser] ?? browser,
    attach: { mode: 'snapshot', browser, profile },
  });
  const commander = makeBrowserCommander({ page: session.page, enableNetworkTracking: false });
  try {
    await commander.goto({ url: PROFILE_URL, waitForNetworkIdle: false, waitForStableUrlBefore: false });
    await commander.wait({ ms: 2000, reason: 'profile page to render' });
    let loggedIn = await isLoggedIn(commander);
    for (const provider of providers) {
      if (loggedIn) {
        break;
      }
      console.log(`🔑 Signing in to hh.ru with ${provider} from ${browser} (${profile})...`);
      loggedIn = await signInWithProvider(commander, provider);
    }
    return loggedIn ? (await saveStorageState(session.page)).cookies.filter(isHhCookie) : null;
  } finally {
    await commander.destroy();
    await session.close();
  }
}

/**
 * Add cookies to the running browser.
 * Workaround: browser-commander has no API to add cookies after launch/connect.
 */
async function addCookies(page, cookies) {
  if (typeof page.context === 'function') {
    return page.context().addCookies(cookies);
  }
  // Puppeteer treats a non-positive expiry as already expired; omit it for session cookies
  return page.browser().setCookie(...cookies.map(({ expires, ...cookie }) => (expires > 0 ? { ...cookie, expires } : cookie)));
}

/**
 * Make sure the automation browser is logged in to hh.ru
 *
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.page - Raw engine page
 * @param {Object} options.argv - Configuration (manualLogin, loginFrom)
 * @param {Function} options.isPageClosed - Whether the user closed the tab
 */
export async function ensureLoggedIn({ commander, page, argv, isPageClosed }) {
  // Reuse whatever hh.ru page the persistent browser already shows
  if (!/(^|\.)hh\.ru$/.test(new URL(commander.getUrl()).hostname)) {
    await commander.goto({ url: PROFILE_URL, waitForStableUrlBefore: false });
  }
  await dismissOverlays(commander);
  if (await isLoggedIn(commander)) {
    log.debug(() => '🔓 Already logged in to hh.ru');
    return;
  }

  if (!argv.manualLogin) {
    const logins = await detectLogins();
    console.log('🔍 Logins found on this machine:');
    for (const { browser, profile, hh, providers, usable } of logins) {
      console.log(`   ${browser} (${profile}): hh.ru cookies ${hh}, social: ${providers.join(', ') || '-'}${usable ? '' : ' (not usable: no CDP)'}`);
    }
    const candidates = logins.filter(({ usable, browser, profile }) =>
      usable && (!argv.loginFrom || `${browser} ${profile}`.toLowerCase().includes(argv.loginFrom.toLowerCase())));
    for (const candidate of candidates) {
      try {
        const cookies = await hhCookiesFromProfile(candidate);
        if (!cookies) {
          continue;
        }
        await addCookies(page, cookies);
        await commander.goto({ url: PROFILE_URL, waitForStableUrlBefore: false });
        if (await isLoggedIn(commander)) {
          console.log(`🔓 Logged in to hh.ru using ${candidate.browser} (${candidate.profile})`);
          return;
        }
      } catch (error) {
        console.log(`⚠️  Login via ${candidate.browser} (${candidate.profile}) failed: ${error.message}`);
      }
    }
  }

  console.log('🙋 Please log in to hh.ru in the browser window; the automation continues automatically.');
  await commander.goto({ url: PROFILE_URL, waitForStableUrlBefore: false });
  while (!isPageClosed() && !await isLoggedIn(commander).catch(() => false)) {
    await commander.wait({ ms: 2000, reason: 'waiting for manual login' });
  }
}
