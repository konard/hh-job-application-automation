const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

(async () => {
  console.log('🧪 Testing translation disable configuration in Playwright...');

  const browser = await chromium.launchPersistentContext(
    path.join(os.homedir(), '.hh-automation', 'playwright-test-translation'),
    {
      headless: false,
      slowMo: 150,
      chromiumSandbox: true,
      viewport: null,
      args: [
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crash-restore',
        '--disable-translate',                // Disable Google Translate feature
        '--disable-features=Translate',       // Disable translate features
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    },
  );

  const page = browser.pages()[0];

  // Navigate to a Russian language page (hh.ru)
  console.log('📍 Navigating to hh.ru (Russian language page)...');
  await page.goto('https://hh.ru/search/vacancy?from=resumelist');

  console.log('⏳ Waiting 10 seconds to observe if translation popup appears...');
  await new Promise(r => setTimeout(r, 10000));

  console.log('✅ Test completed. Please verify visually that no translation popup appeared.');
  console.log('💡 The browser will stay open for 30 more seconds for manual inspection.');

  await new Promise(r => setTimeout(r, 30000));

  await browser.close();
  console.log('🏁 Test finished.');
})().catch((error) => {
  console.error('❌ Error occurred:', error.message);
  process.exit(1);
});
