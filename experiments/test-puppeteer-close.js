const puppeteer = require('puppeteer');

(async () => {
  console.log('🚀 Starting Puppeteer tab close detection test...');

  // Launch browser
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const [page] = await browser.pages();

  // Set up close event handler
  page.on('close', () => {
    console.log('🔴 Tab close detected! Page was closed by user.');
    console.log('✅ Ending process gracefully...');
    process.exit(0);
  });

  console.log('📄 Opening test page...');
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

  console.log('✋ Waiting indefinitely... Close the browser tab to test detection.');
  console.log('💡 The script should detect the close event and exit gracefully.');

  // Keep the script running
  await new Promise(() => {});
})();
