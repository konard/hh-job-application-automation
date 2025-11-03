/**
 * Experiment: Test tab closure during waitForFunction (reproduces issue #25)
 *
 * This script reproduces the exact scenario from issue #25:
 * - Script is waiting with page.waitForFunction for user to return to target page
 * - User closes the browser tab instead of navigating back
 * - Should handle this gracefully without "Waiting failed" error
 *
 * Test procedure with Puppeteer:
 * 1. Run: node experiments/test-close-during-wait.js puppeteer
 * 2. Wait for browser to open and start waiting
 * 3. Close the browser tab (not the whole browser, just the tab)
 * 4. Verify graceful shutdown message appears
 *
 * Test procedure with Playwright:
 * 1. Run: node experiments/test-close-during-wait.js playwright
 * 2. Wait for browser to open and start waiting
 * 3. Close the browser tab
 * 4. Verify graceful shutdown message appears
 *
 * Expected outcome:
 * - Script should detect tab closure and exit gracefully
 * - Should NOT show "Waiting failed" or similar error
 */

const puppeteer = require('puppeteer');
const { chromium } = require('playwright');

const engine = process.argv[2] || 'puppeteer';

async function testPuppeteer() {
  console.log('🚀 Testing Puppeteer tab close during waitForFunction...');

  let browser = null;
  let pageClosedByUser = false;

  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--start-maximized'],
    });
    const [page] = await browser.pages();

    // Set up close event handler
    page.on('close', async () => {
      pageClosedByUser = true;
      console.log('🔴 Tab close detected! Page was closed by user.');
      console.log('✅ Closing browser gracefully...');
      try {
        await browser.close();
        console.log('✅ Browser closed successfully');
      } catch (error) {
        console.error('❌ Error closing browser:', error.message);
      }
      process.exit(0);
    });

    console.log('📄 Opening test page...');
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    console.log('⏳ Starting waitForFunction (simulating waiting for user to return to target page)...');
    console.log('💡 Now close the browser tab to test graceful handling');

    // This simulates the waitForFunction call that waits for user to navigate back
    try {
      await page.waitForFunction(
        (targetUrl) => window.location.href.startsWith(targetUrl),
        { timeout: 0 }, // No timeout - wait indefinitely
        'https://target-page.example.com',
      );
    } catch (error) {
      // If page was closed by user, the close event handler will handle shutdown
      if (pageClosedByUser) {
        return; // Exit gracefully, close handler will take care of cleanup
      }
      throw error; // Re-throw if it's a different error
    }

    console.log('✅ waitForFunction completed (this should not happen in this test)');
  } catch (error) {
    console.error('❌ Error occurred:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('❌ Error closing browser:', closeError.message);
      }
    }
    process.exit(1);
  }
}

async function testPlaywright() {
  console.log('🚀 Testing Playwright tab close during waitForFunction...');

  let browser = null;
  let pageClosedByUser = false;

  try {
    browser = await chromium.launch({
      headless: false,
      slowMo: 150,
    });
    const page = await browser.newPage();

    // Set up close event handler
    page.on('close', async () => {
      pageClosedByUser = true;
      console.log('🔴 Tab close detected! Page was closed by user.');
      console.log('✅ Closing browser gracefully...');
      try {
        await browser.close();
        console.log('✅ Browser closed successfully');
      } catch (error) {
        console.error('❌ Error closing browser:', error.message);
      }
      process.exit(0);
    });

    console.log('📄 Opening test page...');
    await page.goto('https://example.com');

    console.log('⏳ Starting waitForFunction (simulating waiting for user to return to target page)...');
    console.log('💡 Now close the browser tab to test graceful handling');

    // This simulates the waitForFunction call that waits for user to navigate back
    try {
      await page.waitForFunction(
        (targetUrl) => window.location.href.startsWith(targetUrl),
        'https://target-page.example.com',
        { timeout: 0 }, // No timeout - wait indefinitely
      );
    } catch (error) {
      // If page was closed by user, the close event handler will handle shutdown
      if (pageClosedByUser) {
        return; // Exit gracefully, close handler will take care of cleanup
      }
      throw error; // Re-throw if it's a different error
    }

    console.log('✅ waitForFunction completed (this should not happen in this test)');
  } catch (error) {
    console.error('❌ Error occurred:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('❌ Error closing browser:', closeError.message);
      }
    }
    process.exit(1);
  }
}

if (engine === 'playwright') {
  testPlaywright();
} else {
  testPuppeteer();
}
