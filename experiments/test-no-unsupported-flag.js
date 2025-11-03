const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

(async () => {
  console.log('🧪 Testing solution to remove unsupported flag warning...\n');
  console.log('📋 Expected: No "unsupported command-line flag" warning should appear\n');

  // Solution: Remove --disable-blink-features=AutomationControlled
  // The ignoreDefaultArgs: ['--enable-automation'] is sufficient to remove the automation banner
  const browser = await chromium.launchPersistentContext(
    path.join(os.homedir(), '.hh-automation', 'playwright-test-no-flag'),
    {
      headless: false,
      slowMo: 150,
      chromiumSandbox: true,  // Keep sandboxing enabled
      args: [
        // Removed: '--disable-blink-features=AutomationControlled' - this causes the warning
        '--disable-session-crashed-bubble',  // Disable the "Restore pages?" popup (older method)
        '--hide-crash-restore-bubble',        // Hide crash restore bubble (Chrome 113+)
        '--disable-infobars',                 // Disable info bars (deprecated but kept for compatibility)
        '--no-first-run',                     // Skip first run tasks
        '--no-default-browser-check',         // Skip default browser check
        '--disable-crash-restore',            // Additional crash restore disable
      ],
      ignoreDefaultArgs: ['--enable-automation'],  // This removes the automation banner without the warning
    },
  );

  const page = browser.pages()[0];

  console.log('✅ Browser launched successfully');
  console.log('📋 Please check:');
  console.log('   1. No "You are using an unsupported command-line flag" warning should be visible');
  console.log('   2. The "Chrome is being controlled by automated test software" banner should still be hidden');
  console.log('⏳ Navigating to a test page...\n');

  await page.goto('https://www.google.com');

  console.log('✅ Page loaded');
  console.log('💡 Inspect the browser to verify:');
  console.log('   - No warning banner at the top');
  console.log('   - No automation control banner');
  console.log('⏸️  Pausing for 15 seconds for manual inspection...\n');

  await new Promise(r => setTimeout(r, 15000));

  console.log('✅ Test completed - closing browser');
  await browser.close();

  console.log('\n📊 Test Summary:');
  console.log('   The solution removes the unsupported flag warning by:');
  console.log('   1. Removing --disable-blink-features=AutomationControlled');
  console.log('   2. Relying solely on ignoreDefaultArgs: [\'--enable-automation\']');
  console.log('   This achieves the goal of hiding automation banner without the warning.');
})().catch((error) => {
  console.error('❌ Error occurred:', error.message);
  process.exit(1);
});
