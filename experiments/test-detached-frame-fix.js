/**
 * Test script to verify that detached frame errors are silently handled
 * when user switches tabs during waitForUrlCondition
 *
 * This simulates the scenario from issue #61 where:
 * 1. Script is waiting for a URL condition
 * 2. User switches to another tab
 * 3. Frame becomes detached
 * 4. No error messages should be logged
 * 5. When user returns, waiting continues normally
 *
 * Test procedure:
 * 1. Run: node experiments/test-detached-frame-fix.js
 * 2. Browser opens with hh.ru
 * 3. Switch to another tab/window
 * 4. Wait a few seconds
 * 5. Return to the browser tab
 * 6. Verify no error messages appear in terminal
 *
 * Expected outcome:
 * - No "Temporary error" messages should appear for detached frame errors
 * - Script should continue waiting silently while on another tab
 * - Script should work normally when returning to the tab
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🧪 Testing detached frame error handling...\n');

  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();
  let pageClosedByUser = false;

  page.on('close', () => {
    pageClosedByUser = true;
  });

  /**
   * Robust waiting function that waits indefinitely for a URL condition
   * Uses a polling loop with error handling to avoid "Waiting failed" errors
   */
  async function waitForUrlCondition(targetUrl, description) {
    const pollingInterval = 1000; // Check every second
    console.log(`⏳ ${description}...`);

    let checkCount = 0;
    let detachedErrorCount = 0;
    let otherErrorCount = 0;

    while (true) {
      // Check if page was closed by user
      if (pageClosedByUser) {
        return; // Exit gracefully, close handler will take care of cleanup
      }

      checkCount++;

      try {
        // Try to check if we're on the target URL
        const result = await page.evaluate((url) => window.location.href.startsWith(url), targetUrl);
        if (result) {
          console.log(`\n✅ URL condition met after ${checkCount} checks`);
          console.log(`   Detached frame errors silently handled: ${detachedErrorCount}`);
          console.log(`   Other errors: ${otherErrorCount}`);
          return true; // Condition met
        }
      } catch (error) {
        // If page is closed or context destroyed, exit gracefully
        if (pageClosedByUser) {
          return;
        }
        // Silently ignore detached frame errors - these occur when user switches tabs
        // and are expected behavior. The loop will continue checking and will succeed
        // once the user returns to the main tab.
        const isDetachedFrameError = error.message && error.message.includes('detached Frame');
        if (isDetachedFrameError) {
          detachedErrorCount++;
        } else {
          otherErrorCount++;
          // Only log non-detached-frame errors
          console.log(`⚠️  Temporary error while checking URL: ${error.message.substring(0, 100)}... (retrying)`);
        }
      }

      // Show progress every 10 checks without cluttering output
      if (checkCount % 10 === 0) {
        console.log(`   Checked ${checkCount} times (${detachedErrorCount} detached frame errors silently handled)`);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }
  }

  // Navigate to initial page
  await page.goto('https://hh.ru');

  console.log('📋 Instructions:');
  console.log('   1. Switch to another tab now to trigger detached frame');
  console.log('   2. Wait a few seconds while script continues checking');
  console.log('   3. Return to this tab');
  console.log('   4. Script should detect you are back without any error messages');
  console.log('');
  console.log('💡 Expected behavior: No "Temporary error" messages should appear');
  console.log('💡 for detached frame errors while you are on another tab\n');

  // Wait for a URL that will never match to test continuous checking
  // In practice, we'll manually close after testing
  setTimeout(async () => {
    console.log('\n🎯 Test completed! Detached frame errors were handled silently.');
    console.log('💡 If you saw no error messages while switching tabs, the fix works correctly.');
    await browser.close();
    process.exit(0);
  }, 30000); // Run test for 30 seconds

  await waitForUrlCondition('https://hh.ru/test-url-that-never-matches', 'Waiting for test condition');

})().catch(async (error) => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});
