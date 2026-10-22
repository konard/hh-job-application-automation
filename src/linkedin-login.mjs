#!/usr/bin/env bun
/**
 * Sign the LinkedIn slot in with the LinkedIn session of a browser you already use:
 * `bun run linkedin-login [-- --from <browser>] [--profile <name>] [--manual]`
 *
 * The installed browsers that hold linkedin.com cookies are listed (names and counts only), the
 * one with the most is tried first (user-sessions): its linkedin.com cookies are copied into the
 * LinkedIn slot (port 9350) and the feed is opened to check the sign-in. Cookie values are never
 * printed or written anywhere but the slot's own browser profile. Safari needs Full Disk Access
 * for the terminal.
 * When no browser session works, the slot shows the LinkedIn login page and waits for you to log
 * in there (this script never reads, types or stores a password).
 *
 * Run it yourself (in Claude Code: `! bun run linkedin-login`), since it reads your browsers'
 * cookie stores.
 */

import { listCookieSources } from 'browser-commander';
import { openSlot } from './browser-slots.mjs';
import { hasLinkedInSession, isLinkedInLoginPage, waitForLinkedInLogin } from './experience-sites.mjs';
import { importUserSession } from './user-sessions.mjs';

const FEED = 'https://www.linkedin.com/feed/';
const DOMAIN = 'linkedin.com';

const USAGE = `Usage: bun run linkedin-login -- [options]

  --from <browser>   Take the session from this browser (chrome, edge, brave, arc, firefox, safari, …)
  --profile <name>   Its profile (default: the one holding the most LinkedIn cookies)
  --manual           Skip the browsers: log in yourself in the slot window
  --port <n>         Port of the LinkedIn slot (default 9350)`;

function parseArgs(args) {
  const parsed = { from: '', profile: '', manual: false, port: 9350 };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => inline ?? args[++i];
    if (flag === '--from') {
      parsed.from = value().toLowerCase();
    } else if (flag === '--profile') {
      parsed.profile = value();
    } else if (flag === '--manual') {
      parsed.manual = true;
    } else if (flag === '--port') {
      parsed.port = Number(value());
    } else {
      console.log(USAGE);
      process.exit(flag === '--help' || flag === '-h' ? 0 : 1);
    }
  }
  return parsed;
}

/** Whether the page is signed in to LinkedIn after opening the feed */
export async function signedIn(page) {
  await page.goto(FEED, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  return await hasLinkedInSession(page) && !isLinkedInLoginPage(page.url());
}

if (import.meta.main) {
  const argv = parseArgs(process.argv.slice(2));
  const session = await openSlot({ name: 'linkedin-slot', port: argv.port });
  const { page } = session;
  let done = await signedIn(page);
  if (done) {
    console.log('✅ The LinkedIn slot is already signed in');
  }

  if (!done && !argv.manual) {
    const sources = await listCookieSources({ domains: [DOMAIN] });
    for (const source of sources) {
      const cookies = Object.values(source.byDomain ?? {}).reduce((sum, n) => sum + n, 0);
      console.log(`🔎 ${source.browser} (${source.profile}): ${source.error ? `not readable: ${source.error}` : `${cookies} LinkedIn cookie(s)`}`);
    }
    done = Boolean(await importUserSession({
      page, domain: DOMAIN, signedIn: () => signedIn(page), from: argv.from, profile: argv.profile, sources,
    }));
  }

  if (!done) {
    await waitForLinkedInLogin(page, { url: FEED, port: argv.port, importSession: false });
    console.log('✅ Signed in to LinkedIn in the slot window');
  }
  // The slot stays open with its session for the experience sync
  await session.release();
  process.exit(0);
}
