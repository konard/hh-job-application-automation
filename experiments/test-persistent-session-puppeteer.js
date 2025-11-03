// Test script to verify persistent session storage in Puppeteer
const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');

(async () => {
  console.log('Testing Puppeteer persistent session storage...\n');

  const userDataDir = path.join(os.homedir(), '.hh-automation', 'puppeteer-data-test');
  console.log('📁 User data directory:', userDataDir);

  // Test case 1: Launch browser with userDataDir
  console.log('\n✅ Test 1: Launching browser with userDataDir');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
    userDataDir: userDataDir,
  });

  const [page] = await browser.pages();
  console.log('✅ Browser launched successfully with persistent storage');

  // Test case 2: Navigate to a test page
  console.log('\n✅ Test 2: Navigating to hh.ru');
  await page.goto('https://hh.ru', { waitUntil: 'domcontentloaded' });
  console.log('✅ Navigation successful');

  // Test case 3: Check if cookies persist
  const cookies = await page.cookies();
  console.log('\n✅ Test 3: Cookie persistence');
  console.log('  Current cookies count:', cookies.length);

  if (cookies.length > 0) {
    console.log('  Sample cookie domains:', [...new Set(cookies.slice(0, 5).map(c => c.domain))].join(', '));
  }

  console.log('\n💡 Instructions:');
  console.log('  1. If you see a login page, log in manually');
  console.log('  2. Close the browser when done');
  console.log('  3. Run this script again to verify session persistence');
  console.log('  4. You should not need to log in again if session persisted');

  console.log('\n⏳ Browser will stay open for manual testing...');
  console.log('💡 Close the browser window when you\'re done testing');

  // Wait for the browser to be closed manually
  await new Promise(resolve => {
    browser.on('disconnected', () => {
      console.log('\n✅ Browser closed');
      console.log('✅ Session data saved to:', userDataDir);
      resolve();
    });
  });
})();
