/**
 * Experiment: Test modal timeout handling
 *
 * This script tests the scenario where clicking a "Откликнуться" button
 * should open a modal, but the modal might not appear within default timeout.
 *
 * Root cause: Line 269 in puppeteer-apply.mjs uses waitForSelector with default timeout
 * which fails when the modal doesn't appear quickly enough or at all.
 *
 * Test procedure:
 * 1. Run: node experiments/test-modal-timeout-fix.js
 * 2. Simulates clicking a button and waiting for modal
 * 3. Tests graceful handling when modal doesn't appear
 *
 * Expected behavior:
 * - Script should handle modal timeout gracefully
 * - Should retry or skip the button and move to next one
 * - Should not crash the entire automation
 */

const puppeteer = require('puppeteer');

async function testModalWaitWithTimeout() {
  console.log('🧪 Testing modal wait with graceful timeout handling...');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // Navigate to a test page
  await page.goto('https://example.com');

  console.log('📋 Testing waitForSelector with timeout handling...');

  // Test 1: Wait for non-existent selector with timeout
  try {
    await page.waitForSelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]', {
      visible: true,
      timeout: 5000, // 5 second timeout for testing
    });
    console.log('✅ Modal appeared');
  } catch (error) {
    console.log('⚠️  Modal did not appear within timeout:', error.message);
    console.log('💡 This is the scenario that causes the bug in production');
  }

  // Test 2: Same scenario with try-catch and graceful handling
  console.log('\n🧪 Testing graceful handling approach...');

  try {
    const modalAppeared = await page.waitForSelector(
      'form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]',
      {
        visible: true,
        timeout: 5000,
      },
    ).then(() => true).catch(() => false);

    if (modalAppeared) {
      console.log('✅ Modal appeared, proceed with form filling');
    } else {
      console.log('⚠️  Modal did not appear, skipping this button');
    }
  } catch (error) {
    console.log('❌ Unexpected error:', error.message);
  }

  console.log('\n✅ Test completed successfully!');
  console.log('💡 Solution: Wrap waitForSelector in try-catch or use .catch() to handle timeout gracefully');

  await browser.close();
}

testModalWaitWithTimeout().catch(console.error);
