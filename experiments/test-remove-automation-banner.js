const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

(async () => {
  console.log('🧪 Testing removal of "Chrome is being controlled by automated test software" banner...\n');

  // Launch browser with ignoreDefaultArgs to exclude --enable-automation
  const browser = await chromium.launchPersistentContext(
    path.join(os.homedir(), '.hh-automation', 'playwright-test-data'),
    {
      headless: false,
      slowMo: 150,
      args: [
        '--disable-session-crashed-bubble',  // Disable the "Restore pages?" popup (older method)
        '--hide-crash-restore-bubble',        // Hide crash restore bubble (Chrome 113+)
        '--disable-infobars',                 // Disable info bars (deprecated but kept for compatibility)
        '--no-first-run',                     // Skip first run tasks
        '--no-default-browser-check',         // Skip default browser check
        '--disable-crash-restore',            // Additional crash restore disable
      ],
      ignoreDefaultArgs: ['--enable-automation'],  // This removes the automation banner
    },
  );

  const page = browser.pages()[0];

  console.log('✅ Browser launched successfully');
  console.log('📋 Please check if the "Chrome is being controlled by automated test software" banner is visible');
  console.log('⏳ Navigating to a test page...\n');

  await page.goto('https://www.google.com');

  console.log('✅ Page loaded');
  console.log('💡 The automation banner should NOT be visible at the top of the browser');
  console.log('⏸️  Pausing for 10 seconds for manual inspection...\n');

  await new Promise(r => setTimeout(r, 10000));

  console.log('✅ Test completed - closing browser');
  await browser.close();
})().catch((error) => {
  console.error('❌ Error occurred:', error.message);
  process.exit(1);
});
