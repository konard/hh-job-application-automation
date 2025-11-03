const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

(async () => {
  console.log('🧪 Testing Playwright with args to prevent "Restore pages?" popup...');

  const userDataDir = path.join(os.homedir(), '.hh-automation', 'playwright-test-no-restore');

  console.log('📂 User data directory:', userDataDir);
  console.log('');
  console.log('🎯 Goal: Launch browser WITHOUT seeing "Restore pages?" popup');
  console.log('');

  // Launch browser with persistent context and args to prevent restore popup
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: 150,
    args: [
      '--disable-session-crashed-bubble',  // Disable the "Restore pages?" popup
      '--disable-infobars',                 // Disable info bars
      '--no-first-run',                     // Skip first run tasks
      '--no-default-browser-check',         // Skip default browser check
      '--disable-features=PasswordManager',  // Additional cleanup
    ],
  });

  const page = await browser.newPage();

  console.log('✅ Browser launched!');
  console.log('');
  console.log('👀 Check if you see:');
  console.log('   ❌ "Restore pages?" popup (should NOT appear)');
  console.log('   ❌ "Chromium didn\'t shut down correctly" message (should NOT appear)');
  console.log('');
  console.log('📄 Navigating to test page...');

  await page.goto('https://example.com');

  console.log('');
  console.log('⏱️  Waiting 10 seconds for you to observe...');
  await page.waitForTimeout(10000);

  console.log('');
  console.log('🧹 Closing browser...');
  await browser.close();

  console.log('✅ Test complete!');
  console.log('');
  console.log('💡 If you did NOT see the "Restore pages?" popup, the fix works!');
})();
