/**
 * hh.ru login without user actions.
 *
 * 1. Detect logins available on this machine: browser profiles holding cookies of
 *    hh.ru or of the social networks hh.ru accepts for sign-in (VK, Mail.ru, OK, ...).
 * 2. Take the hh.ru session of any browser you use, Safari and Firefox included (user-sessions).
 * 3. Otherwise start a temporary snapshot of the best Chromium profile. Chrome decrypts its own
 *    cookies, so no Keychain prompt is shown. If that profile is not logged in to
 *    hh.ru, sign in through the social network whose session it holds.
 * 4. Copy the resulting hh.ru cookies into the persistent automation browser.
 * 5. Fall back to waiting for a manual login in the automation browser.
 *
 * A browser slot (chat, forms, experience) gets the session of the automation browser or of
 * another slot, or else of a browser you use (seedHhSession), so no slot starts signed out. A
 * login made in any of these windows is copied into the others that show signed out
 * (shareHhSession), so you log in once.
 *
 * @module login
 */

import {
  findBrowserSource,
  launchBrowser,
  listCookieSources,
  makeBrowserCommander,
  saveStorageState,
  setCookies,
} from 'browser-commander';
import { chromium } from 'playwright';
import { SELECTORS, URL_PATTERNS } from './hh-selectors.mjs';
import { tracingEnabled } from './browser-slots.mjs';
import { isBrowserRunning } from './browser-session.mjs';
import { createTracing } from './tracing.mjs';
import { dismissOverlays } from './helpers/page-helpers.mjs';
import { log } from './logging.mjs';
import { importUserSession } from './user-sessions.mjs';
import { alertUser } from './notify.mjs';

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
  // Recorded like every browser window of the automation (TRACE=0 turns it off); passwords are redacted
  const tracing = tracingEnabled() ? await createTracing({ commander, page: session.page, name: `login-${browser}` }).catch(() => null) : null;
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
    await tracing?.stop().catch(() => {});
    await commander.destroy();
    await session.close();
  }
}

/**
 * Add cookies to the running browser (browser-commander's setCookies keeps session cookies alive)
 * @param {Object} page - Raw engine page
 * @param {Object[]} cookies
 */
function addCookies(page, cookies) {
  return setCookies({ page, engine: typeof page.context === 'function' ? 'playwright' : 'puppeteer', cookies });
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
    await commander.goto({ url: PROFILE_URL, waitForNetworkIdle: false, waitForStableUrlBefore: false });
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
    const chosen = ({ browser, profile }) =>
      !argv.loginFrom || `${browser} ${profile}`.toLowerCase().includes(argv.loginFrom.toLowerCase());
    // The hh.ru session of a browser you use, as it is
    const signedIn = async () => {
      await commander.goto({ url: PROFILE_URL, waitForNetworkIdle: false, waitForStableUrlBefore: false });
      return await isLoggedIn(commander);
    };
    if (await importUserSession({ page, domain: HH_DOMAIN, signedIn, accept: chosen })) {
      return;
    }
    // Else a sign-in through a social network whose session a Chromium profile holds
    const candidates = logins.filter((login) => login.usable && login.providers.length > 0 && chosen(login));
    for (const candidate of candidates) {
      try {
        const cookies = await hhCookiesFromProfile(candidate);
        if (!cookies) {
          continue;
        }
        await addCookies(page, cookies);
        await commander.goto({ url: PROFILE_URL, waitForNetworkIdle: false, waitForStableUrlBefore: false });
        if (await isLoggedIn(commander)) {
          console.log(`🔓 Logged in to hh.ru using ${candidate.browser} (${candidate.profile})`);
          return;
        }
      } catch (error) {
        console.log(`⚠️  Login via ${candidate.browser} (${candidate.profile}) failed: ${error.message}`);
      }
    }
  }

  console.log('🙋 Please log in to hh.ru in this or any other hh.ru window of the automation; the login is copied to the others and the automation continues.');
  await commander.goto({ url: PROFILE_URL, waitForNetworkIdle: false, waitForStableUrlBefore: false });
  const endAlert = alertUser();
  try {
    for (let round = 1; !isPageClosed() && !await isLoggedIn(commander).catch(() => false); round++) {
      // A login made in a slot window (chat, forms) is taken from there
      if (round % 5 === 0) {
        await shareHhSession({ ports: sessionPorts(argv.browserPort) }).catch(() => {});
      }
      await commander.wait({ ms: 2000, reason: 'waiting for manual login' });
    }
  } finally {
    endAlert();
  }
  // And the slots still signed out get this login
  await shareHhSession({ ports: sessionPorts(argv.browserPort) }).catch(() => {});
}

/** Ports of the windows that hold an hh.ru session: the automation browser, chat (9340, 9341), forms (9331-9339), experience (9351) */
export const HH_SESSION_PORTS = [9322, 9340, 9341, ...Array.from({ length: 9 }, (_, index) => 9331 + index), 9351, 9352];

const sessionPorts = (port) => [...new Set([port ?? 9322, ...HH_SESSION_PORTS])];

const isHhUrl = (url) => /^https:\/\/([\w-]+\.)*hh\.ru\//.test(url);

/**
 * Whether an open hh.ru page shows a signed-in user, read as it is (nothing is loaded)
 * @param {Object} page - Playwright page
 * @returns {Promise<'in'|'out'|null>} null when the page does not tell (not hh.ru, still loading)
 */
export async function pageSignInState(page) {
  if (!isHhUrl(page.url())) {
    return null;
  }
  if (URL_PATTERNS.loginPage.test(page.url())) {
    return 'out';
  }
  return await page.evaluate(([signedIn, signedOut]) => {
    if (document.querySelector(signedOut)) {
      return 'out';
    }
    return document.querySelector(signedIn) ? 'in' : null;
  }, [SELECTORS.signedInMenu, `${SELECTORS.loginLink}, ${SELECTORS.loginForm}`]).catch(() => null);
}

/**
 * Log in once for all windows: when one hh.ru window of the automation is signed in, its hh.ru
 * cookies are copied into each running one that shows signed out, and that page is reloaded.
 * Only names of ports are printed, never values
 * @param {Object} [options]
 * @param {number[]} [options.ports] - Debugging ports of the windows
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<number[]>} Ports signed in this way
 */
export async function shareHhSession({ ports = HH_SESSION_PORTS, log: say = console.log } = {}) {
  const windows = [];
  try {
    for (const port of ports) {
      if (!await isBrowserRunning(port)) {
        continue;
      }
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) {
        continue;
      }
      const pages = browser.contexts().flatMap((context) => context.pages()).filter((page) => isHhUrl(page.url()));
      const states = await Promise.all(pages.map(pageSignInState));
      windows.push({ port, browser, pages: pages.filter((_, index) => states[index] === 'out'), signedIn: states.includes('in') });
    }
    const source = windows.find((window) => window.signedIn);
    const targets = windows.filter((window) => !window.signedIn && window.pages.length > 0);
    if (!source || targets.length === 0) {
      return [];
    }
    const cookies = (await source.browser.contexts()[0].cookies()).filter(isHhCookie);
    const signedIn = [];
    for (const target of targets) {
      await target.browser.contexts()[0].addCookies(cookies);
      for (const page of target.pages) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      if (await pageSignInState(target.pages[0]) !== 'out') {
        say(`🔑 The hh.ru login of the window on port ${source.port} is copied to the window on port ${target.port} (${cookies.length} cookies, values not shown)`);
        signedIn.push(target.port);
      }
    }
    return signedIn;
  } finally {
    // Disconnects only: the windows keep running
    await Promise.all(windows.map(({ browser }) => browser.close().catch(() => {})));
  }
}

/**
 * Keep the hh.ru windows signed in together: every interval a login made in one of them is
 * copied into the others that show signed out
 * @param {Object} [options]
 * @param {number} [options.port] - Port of the automation browser
 * @param {number} [options.intervalMs=60000]
 * @returns {() => void} Stops watching
 */
export function watchHhSessions({ port, intervalMs = 60000 } = {}) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    await shareHhSession({ ports: sessionPorts(port) }).catch(() => {});
    running = false;
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Whether a slot's page is signed in to hh.ru: the profile page shows no login link or form
 * @param {Object} page - Playwright page of the slot
 * @returns {Promise<boolean>}
 */
export async function hhPageSignedIn(page) {
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const url = page.url();
  if (!/(^|\.)hh\.ru$/.test(new URL(url).hostname) || URL_PATTERNS.loginPage.test(url)) {
    return false;
  }
  return await page.locator(`${SELECTORS.loginLink}, ${SELECTORS.loginForm}`).count() === 0;
}

/**
 * Sign a browser slot in to hh.ru: its own login is kept; else the login of the automation
 * browser or another slot, or else the session of a browser you use. Values are never printed
 * @param {Object} options
 * @param {Object} options.page - Playwright page of the slot
 * @param {number} [options.fromPort=9322] - Port of the automation browser
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<boolean>} Whether the slot is signed in
 */
export async function seedHhSession({ page, fromPort = 9322, log: say = console.log }) {
  // A slot signed in on its own keeps its login (a signed-out browser's cookies would replace it)
  // Checking the profile page would navigate away from an already signed-in chat and its draft.
  if (await pageSignInState(page) === 'in') return true;
  if (await hhPageSignedIn(page)) {
    return true;
  }
  if ((await shareHhSession({ ports: sessionPorts(fromPort), log: say })).length > 0 && await pageSignInState(page) === 'in') {
    return true;
  }
  if (await importUserSession({ page, domain: HH_DOMAIN, signedIn: () => hhPageSignedIn(page), log: say })) {
    return true;
  }
  say('⚠️  No signed-in hh.ru session in the automation windows or your browsers: log in to hh.ru in any automation window, the others take that login');
  return false;
}
