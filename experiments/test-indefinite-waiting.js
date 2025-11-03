/**
 * Experiment: Test indefinite waiting for page navigation with robust error handling
 *
 * This script tests a robust waiting mechanism that:
 * - Waits indefinitely for user to navigate back to target page
 * - Handles errors gracefully by retrying
 * - Only exits on user closing the page/browser
 * - Doesn't fail with "Waiting failed" error
 *
 * Test procedure:
 * 1. Run: node experiments/test-indefinite-waiting.js [puppeteer|playwright]
 * 2. Browser opens with example.com
 * 3. Script waits for you to navigate to target URL
 * 4. Try different scenarios:
 *    a) Navigate to the target URL - should detect and continue
 *    b) Close the tab - should exit gracefully
 *    c) Navigate to other pages first - should keep waiting
 *
 * Expected outcome:
 * - Script should wait patiently without timing out
 * - If you close the tab, it should exit gracefully
 * - If you navigate to target page, it should detect and continue
 */

const puppeteer = require('puppeteer');
const { chromium } = require('playwright');

const engine = process.argv[2] || 'puppeteer';
const TARGET_URL = 'https://example.org'; // Change to this URL to test success

/**
 * Robust waiting function that waits indefinitely for a condition
 * Uses a retry loop with small timeouts to handle transient errors
 */
async function waitForNavigationIndefinitely(page, checkFunction, checkArg, options = {}) {
  const { pollingInterval = 1000, description = 'navigation' } = options;
  let pageClosedByUser = options.pageClosedByUser || { value: false };

  while (true) {
    // Check if page was closed by user
    if (pageClosedByUser.value) {
      console.log(`⏹️  Page closed by user, stopping wait for ${description}`);
      return;
    }

    try {
      // Try to check the condition with a short timeout
      // This allows us to handle errors and retry
      const result = await page.evaluate(checkFunction, checkArg);
      if (result) {
        console.log(`✅ Condition met for ${description}!`);
        return true;
      }
    } catch (error) {
      // If page is closed or context destroyed, exit gracefully
      if (pageClosedByUser.value) {
        console.log(`⏹️  Page closed during evaluation, stopping wait for ${description}`);
        return;
      }
      // Log error but continue retrying
      console.log(`⚠️  Temporary error while checking ${description}: ${error.message} (retrying...)`);
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, pollingInterval));
  }
}

async function testPuppeteer() {
  console.log('🚀 Testing Puppeteer indefinite waiting mechanism...\n');

  let browser = null;
  const pageClosedByUser = { value: false };

  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--start-maximized'],
    });
    const [page] = await browser.pages();

    // Set up close event handler
    page.on('close', async () => {
      pageClosedByUser.value = true;
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

    console.log('📄 Opening initial page (example.com)...');
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    console.log('\n' + '='.repeat(70));
    console.log('⏳ Waiting for you to navigate to target page...');
    console.log('📍 Target URL:', TARGET_URL);
    console.log('💡 You can:');
    console.log('   - Navigate to target URL to test success detection');
    console.log('   - Navigate to other pages first (it will keep waiting)');
    console.log('   - Close the tab to test graceful shutdown');
    console.log('='.repeat(70) + '\n');

    // Use the robust waiting function
    await waitForNavigationIndefinitely(
      page,
      (targetUrl) => window.location.href.startsWith(targetUrl),
      TARGET_URL,
      {
        pollingInterval: 1000,
        description: 'user navigation to target page',
        pageClosedByUser: pageClosedByUser,
      },
    );

    if (!pageClosedByUser.value) {
      console.log('\n✅ Successfully detected navigation to target page!');
      console.log('📍 Current URL:', page.url());
    }

    // Clean up
    if (browser && !pageClosedByUser.value) {
      await browser.close();
      console.log('✅ Browser closed successfully');
    }
  } catch (error) {
    console.error('\n❌ Error occurred:', error.message);
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
  console.log('🚀 Testing Playwright indefinite waiting mechanism...\n');

  let browser = null;
  const pageClosedByUser = { value: false };

  try {
    browser = await chromium.launch({
      headless: false,
      slowMo: 150,
    });
    const page = await browser.newPage();

    // Set up close event handler
    page.on('close', async () => {
      pageClosedByUser.value = true;
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

    console.log('📄 Opening initial page (example.com)...');
    await page.goto('https://example.com');

    console.log('\n' + '='.repeat(70));
    console.log('⏳ Waiting for you to navigate to target page...');
    console.log('📍 Target URL:', TARGET_URL);
    console.log('💡 You can:');
    console.log('   - Navigate to target URL to test success detection');
    console.log('   - Navigate to other pages first (it will keep waiting)');
    console.log('   - Close the tab to test graceful shutdown');
    console.log('='.repeat(70) + '\n');

    // Use the robust waiting function
    await waitForNavigationIndefinitely(
      page,
      (targetUrl) => window.location.href.startsWith(targetUrl),
      TARGET_URL,
      {
        pollingInterval: 1000,
        description: 'user navigation to target page',
        pageClosedByUser: pageClosedByUser,
      },
    );

    if (!pageClosedByUser.value) {
      console.log('\n✅ Successfully detected navigation to target page!');
      console.log('📍 Current URL:', page.url());
    }

    // Clean up
    if (browser && !pageClosedByUser.value) {
      await browser.close();
      console.log('✅ Browser closed successfully');
    }
  } catch (error) {
    console.error('\n❌ Error occurred:', error.message);
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
