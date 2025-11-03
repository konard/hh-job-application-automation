/**
 * Experiment: Test graceful browser closing with signal handlers
 *
 * This script tests whether proper signal handling and browser.close()
 * prevents the "Restore pages?" dialog in Chrome/Chromium.
 *
 * Test procedure:
 * 1. Run this script: node experiments/test-graceful-browser-close.js
 * 2. Wait for the browser to open
 * 3. Press Ctrl+C to send SIGINT signal
 * 4. Verify that "Browser closed successfully" message appears
 * 5. Run the script again
 * 6. Verify that NO "Restore pages?" dialog appears
 *
 * Expected outcome:
 * - Browser should close gracefully with proper shutdown
 * - Chrome should NOT show "Restore pages?" or "Chromium didn't shut down correctly" on next run
 */

const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

let browser = null;

// Handle graceful shutdown on exit signals
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

// Register signal handlers for graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

(async () => {
  const userDataDir = path.join(os.homedir(), '.hh-automation', 'test-graceful-close');

  console.log('🚀 Launching browser with graceful shutdown handlers...');
  console.log('📁 User data directory:', userDataDir);
  console.log('💡 Press Ctrl+C to test graceful shutdown');

  // Launch browser with persistent context
  browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: 150,
    args: [
      '--disable-session-crashed-bubble',  // Disable the "Restore pages?" popup (older method)
      '--hide-crash-restore-bubble',        // Hide crash restore bubble (Chrome 113+)
      '--disable-infobars',                 // Disable info bars
      '--no-first-run',                     // Skip first run tasks
      '--no-default-browser-check',         // Skip default browser check
      '--disable-crash-restore',             // Additional crash restore disable
    ],
  });

  const page = browser.pages()[0];

  console.log('✅ Browser launched successfully');
  console.log('🔍 Navigate to any page and then press Ctrl+C to test graceful shutdown');

  await page.goto('https://www.google.com');

  // Keep the browser open and wait for signal
  await new Promise(() => {}); // Wait forever until signal received
})().catch(async (error) => {
  console.error('❌ Error occurred:', error.message);
  if (browser) {
    try {
      await browser.close();
      console.log('✅ Browser closed after error');
    } catch (closeError) {
      console.error('❌ Error closing browser:', closeError.message);
    }
  }
  process.exit(1);
});
