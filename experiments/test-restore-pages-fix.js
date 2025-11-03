const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

/**
 * Experiment to test fixes for the "Restore pages?" dialog
 *
 * The issue: When using launchPersistentContext, Chromium shows a
 * "Restore pages? Chromium didn't shut down correctly" dialog on restart.
 *
 * Root cause: The browser profile isn't marking the exit as "Normal",
 * so Chromium thinks it crashed.
 *
 * Solutions to test:
 * 1. Add --hide-crash-restore-bubble flag (Chrome 113+)
 * 2. Set profile.exit_type preference to "Normal"
 * 3. Add --disable-crash-restore flag
 */

(async () => {
  console.log('🧪 Testing fix for "Restore pages?" dialog...\n');

  const userDataDir = path.join(os.homedir(), '.hh-automation', 'playwright-test-data');

  console.log('📁 User data directory:', userDataDir);
  console.log('🚀 Launching browser with fixes...\n');

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: 150,
    args: [
      '--disable-session-crashed-bubble',  // Disable the "Restore pages?" popup (older method)
      '--hide-crash-restore-bubble',        // Hide crash restore bubble (Chrome 113+)
      '--disable-infobars',                 // Disable info bars
      '--no-first-run',                     // Skip first run tasks
      '--no-default-browser-check',         // Skip default browser check
      '--disable-crash-restore',            // Additional crash restore disable
    ]
  });

  const page = browser.pages()[0];

  console.log('✅ Browser launched successfully');
  console.log('📍 Navigating to test page...\n');

  await page.goto('https://example.com');

  console.log('⏳ Waiting 5 seconds before closing...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('🔒 Closing browser...');
  await browser.close();

  console.log('✅ Browser closed successfully');
  console.log('\n🔄 Now restart this script to check if the "Restore pages?" dialog appears.');
  console.log('   If it doesn\'t appear, the fix is working!');
})();
