const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Starting Playwright tab close detection test...');

  // Launch browser
  const browser = await chromium.launch({
    headless: false,
    slowMo: 150
  });
  const page = await browser.newPage();

  // Set up close event handler
  page.on('close', () => {
    console.log('🔴 Tab close detected! Page was closed by user.');
    console.log('✅ Ending process gracefully...');
    process.exit(0);
  });

  console.log('📄 Opening test page...');
  await page.goto('https://example.com');

  console.log('✋ Waiting indefinitely... Close the browser tab to test detection.');
  console.log('💡 The script should detect the close event and exit gracefully.');

  // Keep the script running
  await new Promise(() => {});
})();
