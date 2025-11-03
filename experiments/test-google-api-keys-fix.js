const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

(async () => {
  console.log('🧪 Testing fix for "Google API keys are missing" warning and page cutoff...\n');

  // Set environment variables to suppress Google API keys warning
  process.env.GOOGLE_API_KEY = 'no';
  process.env.GOOGLE_DEFAULT_CLIENT_ID = 'no';
  process.env.GOOGLE_DEFAULT_CLIENT_SECRET = 'no';

  console.log('✅ Set Google API environment variables to "no"');
  console.log('📋 Environment variables:');
  console.log('   GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY);
  console.log('   GOOGLE_DEFAULT_CLIENT_ID:', process.env.GOOGLE_DEFAULT_CLIENT_ID);
  console.log('   GOOGLE_DEFAULT_CLIENT_SECRET:', process.env.GOOGLE_DEFAULT_CLIENT_SECRET);
  console.log('');

  // Launch browser with persistent context
  const browser = await chromium.launchPersistentContext(
    path.join(os.homedir(), '.hh-automation', 'playwright-test-google-api'),
    {
      headless: false,
      slowMo: 150,
      chromiumSandbox: true,
      args: [
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crash-restore',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    },
  );

  const page = browser.pages()[0];

  console.log('✅ Browser launched successfully');
  console.log('📋 Please check:');
  console.log('   1. Is the "Google API keys are missing" banner visible? (Should be NO)');
  console.log('   2. Is the page rendered at full height without cutoff at bottom? (Should be YES)');
  console.log('');
  console.log('⏳ Navigating to hh.ru test page...\n');

  // Navigate to a real hh.ru page to test
  await page.goto('https://hh.ru');

  console.log('✅ Page loaded');
  console.log('💡 Check the browser window:');
  console.log('   - No Google API warning banner should be visible');
  console.log('   - Page should render fully to the bottom of the viewport');
  console.log('   - Try resizing the window - page should adapt correctly');
  console.log('');
  console.log('⏸️  Pausing for 30 seconds for manual inspection...\n');

  // Wait longer for manual inspection
  await new Promise(r => setTimeout(r, 30000));

  console.log('✅ Test completed - closing browser');
  await browser.close();
})().catch((error) => {
  console.error('❌ Error occurred:', error.message);
  console.error(error.stack);
  process.exit(1);
});
