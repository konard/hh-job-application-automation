/**
 * Experiment: Test redirect handling with indefinite wait
 *
 * This script simulates the scenario where clicking a button redirects to a different page,
 * and the script should wait indefinitely for the user to complete their task and return.
 *
 * Test procedure:
 * 1. Run: node experiments/test-redirect-handling.js
 * 2. Browser opens and navigates to Google
 * 3. Script clicks a link that redirects to a different page
 * 4. Script detects redirect and waits for user to return
 * 5. User manually navigates back to original URL
 * 6. Script detects return and continues
 *
 * Expected behavior:
 * - Script should wait indefinitely without timeout
 * - User has unlimited time to complete tasks on redirected page
 * - Script continues once user returns to original page
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

let browser = null;

async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, closing browser gracefully...`);
  if (browser) {
    try {
      await browser.close();
      console.log('✅ Browser closed successfully');
    } catch (error) {
      console.error('❌ Error closing browser:', error.message);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

(async () => {
  const userDataDir = path.join(os.homedir(), '.hh-automation', 'playwright-test-data');
  const TARGET_URL = 'https://www.google.com/search?q=playwright';

  console.log('🧪 Starting redirect handling test...');
  console.log('📍 Target URL:', TARGET_URL);

  browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: 150,
    args: [
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crash-restore',
    ],
  });

  const page = browser.pages()[0];

  page.on('close', async () => {
    console.log('🔴 Tab closed by user');
    await gracefulShutdown('PAGE_CLOSE');
  });

  console.log('📄 Navigating to target page...');
  await page.goto(TARGET_URL);

  console.log('💡 Please click on any search result link to simulate a redirect.');
  console.log('💡 Then manually navigate back to:', TARGET_URL);
  console.log('⏳ Waiting for redirect...');

  // Wait for URL to change (simulate clicking a link)
  await page.waitForFunction(
    (targetUrl) => !window.location.href.startsWith(targetUrl),
    TARGET_URL,
    { timeout: 60000 }, // 60 second timeout for user to click a link
  );

  const redirectedUrl = page.url();
  console.log('✅ Redirect detected!');
  console.log('⚠️  Current URL:', redirectedUrl);
  console.log('💡 Take as much time as you need on this page.');
  console.log('💡 Once done, navigate back to:', TARGET_URL);
  console.log('⏳ Waiting for you to return...');

  // Wait indefinitely for user to return
  await page.waitForFunction(
    (targetUrl) => window.location.href.startsWith(targetUrl),
    TARGET_URL,
    { timeout: 0 }, // No timeout - wait indefinitely
  );

  console.log('✅ Returned to target page!');
  console.log('✅ Test completed successfully!');
  console.log('💡 The browser will stay open. Press Ctrl+C to exit.');

})().catch(async (error) => {
  console.error('❌ Error occurred:', error.message);
  if (browser) {
    await browser.close();
  }
  process.exit(1);
});
