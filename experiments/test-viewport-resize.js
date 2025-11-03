const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

(async () => {
  console.log('🧪 Testing Playwright viewport resize issue...\n');

  // Set environment variables to suppress Google API keys warning
  process.env.GOOGLE_API_KEY = 'no';
  process.env.GOOGLE_DEFAULT_CLIENT_ID = 'no';
  process.env.GOOGLE_DEFAULT_CLIENT_SECRET = 'no';

  console.log('📋 Testing two configurations:\n');
  console.log('Test 1: WITHOUT viewport: null (current behavior)');
  console.log('Test 2: WITH viewport: null (proposed fix)\n');

  // Test 1: Current behavior (no viewport option)
  console.log('🔹 Test 1: Launching WITHOUT viewport: null...');
  const browser1 = await chromium.launchPersistentContext(
    path.join(os.homedir(), '.hh-automation', 'playwright-test-no-viewport'),
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

  const page1 = browser1.pages()[0];
  await page1.goto('https://hh.ru');

  console.log('✅ Browser 1 launched');
  console.log('📋 Current viewport:', await page1.viewportSize());
  console.log('💡 Notice: The viewport is fixed at default size (likely 1280x720)');
  console.log('💡 The page content does NOT fill the entire window');
  console.log('⏸️  Pausing for 10 seconds for inspection...\n');

  await new Promise(r => setTimeout(r, 10000));

  console.log('🔹 Closing Test 1 browser...\n');
  await browser1.close();

  // Test 2: With viewport: null (proposed fix)
  console.log('🔹 Test 2: Launching WITH viewport: null...');
  const browser2 = await chromium.launchPersistentContext(
    path.join(os.homedir(), '.hh-automation', 'playwright-test-with-viewport'),
    {
      headless: false,
      slowMo: 150,
      chromiumSandbox: true,
      viewport: null,  // This makes viewport match window size!
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

  const page2 = browser2.pages()[0];
  await page2.goto('https://hh.ru');

  console.log('✅ Browser 2 launched');
  console.log('📋 Current viewport:', await page2.viewportSize());
  console.log('💡 Notice: The viewport is NULL, meaning it matches the window size');
  console.log('💡 The page content should now fill the entire window');
  console.log('💡 Try resizing the window - the page should adapt!');
  console.log('⏸️  Pausing for 20 seconds for inspection...\n');

  await new Promise(r => setTimeout(r, 20000));

  console.log('🔹 Closing Test 2 browser...\n');
  await browser2.close();

  console.log('✅ Test completed!');
  console.log('📋 Summary:');
  console.log('   - Without viewport: null → Fixed viewport, does not resize');
  console.log('   - With viewport: null → Dynamic viewport, matches window size');
})().catch((error) => {
  console.error('❌ Error occurred:', error.message);
  console.error(error.stack);
  process.exit(1);
});
