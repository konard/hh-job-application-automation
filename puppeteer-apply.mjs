#!/usr/bin/env node

import puppeteer from 'puppeteer';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

let browser = null;

/**
 * Disables Chrome translate feature by modifying the Preferences file
 * @param {string} userDataDir - Path to Chrome user data directory
 */
async function disableTranslateInPreferences(userDataDir) {
  const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
  const defaultDir = path.join(userDataDir, 'Default');

  try {
    // Ensure Default directory exists
    await fs.mkdir(defaultDir, { recursive: true });

    let preferences = {};

    // Try to read existing preferences
    try {
      const content = await fs.readFile(preferencesPath, 'utf8');
      preferences = JSON.parse(content);
    } catch {
      // File doesn't exist yet, start with empty preferences
      console.log('📝 Creating new Preferences file...');
    }

    // Set translate to disabled
    if (!preferences.translate) {
      preferences.translate = {};
    }
    preferences.translate.enabled = false;

    // Write back to file
    await fs.writeFile(preferencesPath, JSON.stringify(preferences, null, 2), 'utf8');
    console.log('✅ Translation disabled in Preferences file');
  } catch (error) {
    console.error('⚠️  Warning: Could not modify Preferences file:', error.message);
  }
}

// Handle graceful shutdown on exit signals
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, closing browser gracefully...`);
  if (browser) {
    try {
      await browser.close();
      console.log('✅ Browser closed successfully');
    } catch (error) {
      console.error('❌ Error closing browser:', error.message);
    }
  }
  process.exit(0);
}

// Register signal handlers for graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

(async () => {
  // Parse command-line arguments using yargs
  // npm passes --url as npm_config_url when used without --
  const argv = yargs(hideBin(process.argv))
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'URL to navigate to',
      default: process.env.npm_config_url || process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist',
    })
    .option('manual-login', {
      type: 'boolean',
      description: 'Open login page and wait for manual authentication before proceeding',
      default: false,
    })
    .option('user-data-dir', {
      type: 'string',
      description: 'Path to user data directory for persistent session storage',
      default: path.join(os.homedir(), '.hh-automation', 'puppeteer-data'),
    })
    .option('job-application-interval', {
      type: 'number',
      description: 'Interval in seconds to wait between job application button clicks',
      default: 20,
    })
    .option('message', {
      alias: 'm',
      type: 'string',
      description: 'Message to send with job application',
    })
    .help()
    .argv;

  const MESSAGE = argv.message || process.env.MESSAGE || `В какой форме предлагается юридическое оформление удалённой работы?

Посмотреть мой код на GitHub можно тут:

github.com/konard
github.com/deep-assistant
github.com/linksplatform
github.com/link-foundation`;
  const START_URL = argv.url;

  // Disable translate in Preferences before launching browser
  await disableTranslateInPreferences(argv['user-data-dir']);

  // Launch browser with persistent user data directory to save cookies and session data
  browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--disable-session-crashed-bubble',  // Disable the "Restore pages?" popup (older method)
      '--hide-crash-restore-bubble',        // Hide crash restore bubble (Chrome 113+)
      '--disable-infobars',                 // Disable info bars
      '--no-first-run',                     // Skip first run tasks
      '--no-default-browser-check',         // Skip default browser check
      '--disable-crash-restore',             // Additional crash restore disable
    ],
    userDataDir: argv['user-data-dir'],
  });
  const [page] = await browser.pages();

  // Track if page was closed by user to handle graceful shutdown
  let pageClosedByUser = false;

  // Detect tab close event and exit gracefully
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

  /**
   * Robust waiting function that waits indefinitely for a URL condition
   * Uses a polling loop with error handling to avoid "Waiting failed" errors
   */
  async function waitForUrlCondition(targetUrl, description) {
    const pollingInterval = 1000; // Check every second
    console.log(`⏳ ${description}...`);

    while (true) {
      // Check if page was closed by user
      if (pageClosedByUser) {
        return; // Exit gracefully, close handler will take care of cleanup
      }

      try {
        // Try to check if we're on the target URL
        const result = await page.evaluate((url) => window.location.href.startsWith(url), targetUrl);
        if (result) {
          return true; // Condition met
        }
      } catch (error) {
        // If page is closed or context destroyed, exit gracefully
        if (pageClosedByUser) {
          return;
        }
        // Log error but continue retrying (transient errors are expected)
        console.log(`⚠️  Temporary error while checking URL: ${error.message.substring(0, 100)}... (retrying)`);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }
  }

  // Handle manual login if requested
  if (argv['manual-login']) {
    const backurl = encodeURIComponent(START_URL);
    const loginUrl = `https://hh.ru/account/login?role=applicant&backurl=${backurl}&hhtmFrom=vacancy_search_list`;

    console.log('🔐 Opening login page for manual authentication...');
    console.log('📍 Login URL:', loginUrl);

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    console.log('💡 The browser will automatically continue once you are redirected to:', START_URL);

    // Wait for redirect to the target URL after successful login
    await waitForUrlCondition(START_URL, 'Waiting for you to complete login');

    if (!pageClosedByUser) {
      console.log('✅ Login successful! Proceeding with automation...');
    }
  } else {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  }

  const targetPagePattern = /^https:\/\/hh\.ru\/search\/vacancy/;
  const BUTTON_CLICK_INTERVAL = argv['job-application-interval'] * 1000; // Convert seconds to milliseconds

  // Main loop to process all "Откликнуться" buttons
  while (true) {
    // Get all "Откликнуться" buttons on the current page
    await page.waitForSelector('a');
    const links = await page.$$('a');
    const openButtons = [];
    for (const link of links) {
      const txt = (await page.evaluate(el => el.textContent.trim(), link)) || '';
      if (txt === 'Откликнуться') {
        openButtons.push(link);
      }
    }

    if (openButtons.length === 0) {
      console.log('✅ No more "Откликнуться" buttons found. Automation completed successfully.');
      break;
    }

    console.log(`📋 Found ${openButtons.length} "Откликнуться" button(s). Processing next button...`);

    // Always click the first available button (as processed buttons will be removed from the list)
    const openBtn = openButtons[0];

    // Use Promise.race to handle both navigation and modal popup scenarios
    await Promise.race([
      openBtn.click(),
      // Wait for navigation with a timeout - if navigation happens, this resolves
      page.waitForNavigation({ timeout: 2000 }).catch(() => {
        // Navigation timeout is expected if modal opens instead of redirect
        // This is not an error, just means we stayed on the same page
      }),
    ]);

    // Give additional time for any delayed redirects to complete
    await new Promise(r => setTimeout(r, 2000));

    // Check if we're still on the target page
    const currentUrl = page.url();

    if (!targetPagePattern.test(currentUrl)) {
      console.log('⚠️  Redirected to a different page:', currentUrl);
      console.log('💡 This appears to be a separate application form page.');
      console.log('💡 Please fill out the form manually. Take as much time as you need.');
      console.log('💡 Once done, navigate back to:', START_URL);

      // Wait indefinitely for user to navigate back to target page
      await waitForUrlCondition(START_URL, 'Waiting for you to return to the target page');

      // If page was closed by user, exit
      if (pageClosedByUser) {
        return;
      }

      console.log('✅ Returned to target page! Continuing with button loop...');

      // Give time for page to fully load after navigation
      await new Promise(r => setTimeout(r, 1000));

      // Continue to next iteration to get fresh button list
      continue;
    }

    // No redirect occurred, wait for modal to appear
    await page.waitForSelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]', { visible: true });

    // Issue #47 Fix 2: Check for 200 application limit error
    const limitErrorSelector = '[data-qa-popup-error-code="negotiations-limit-exceeded"]';
    const limitErrorElement = await page.$(limitErrorSelector);

    if (limitErrorElement) {
      console.log('⚠️  Limit reached: 200 applications in 24 hours');
      console.log('💤 Waiting 1 hour before retrying...');

      // Close the modal
      const closeButton = await page.$('[data-qa="response-popup-close"]');
      if (closeButton) {
        await closeButton.click();
        console.log('✅ Closed the application modal');
      }

      // Wait 1 hour (3600 seconds)
      const oneHourInMs = 60 * 60 * 1000;
      await new Promise(r => setTimeout(r, oneHourInMs));

      console.log('🔄 Refreshing the page after wait period...');
      await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 2000)); // Wait for page to load

      // Continue to next iteration to try again
      continue;
    }

    // Click "Добавить сопроводительное"
    const nodes = await page.$$('button, a, span');
    for (const el of nodes) {
      const txt = (await page.evaluate(el => el.textContent.trim(), el)) || '';
      if (txt === 'Добавить сопроводительное') { await el.click(); break; }
    }

    // Activate textarea and type
    await page.waitForSelector('textarea[data-qa="vacancy-response-popup-form-letter-input"]', { visible: true });
    await page.click('textarea[data-qa="vacancy-response-popup-form-letter-input"]');

    // Issue #47 Fix 1: Only type if textarea is empty to prevent double typing
    const currentValue = await page.$eval('textarea[data-qa="vacancy-response-popup-form-letter-input"]', el => el.value);
    if (!currentValue || currentValue.trim() === '') {
      await page.type('textarea[data-qa="vacancy-response-popup-form-letter-input"]', MESSAGE);
      console.log('✅ Puppeteer: typed message successfully');
    } else {
      console.log('⏭️  Puppeteer: textarea already contains text, skipping typing to prevent double entry');
    }

    // Verify textarea contains the expected message
    const textareaValue = await page.$eval('textarea[data-qa="vacancy-response-popup-form-letter-input"]', el => el.value);
    if (textareaValue === MESSAGE) {
      console.log('✅ Puppeteer: verified textarea contains target message');

      // Click the "Откликнуться" submit button
      await page.click('[data-qa="vacancy-response-submit-popup"]');
      console.log('✅ Puppeteer: clicked submit button');
    } else {
      console.error('❌ Puppeteer: textarea value does not match expected message');
      console.error('Expected:', MESSAGE);
      console.error('Actual:', textareaValue);
    }

    // Wait for the modal to close after submission
    await new Promise(r => setTimeout(r, 2000));

    // Wait 20 seconds before processing the next button
    console.log(`⏳ Waiting ${BUTTON_CLICK_INTERVAL / 1000} seconds before processing next button...`);
    await new Promise(r => setTimeout(r, BUTTON_CLICK_INTERVAL));
  }
})().catch(async (error) => {
  console.error('❌ Error occurred:', error.message);
  process.exit(1);
});
