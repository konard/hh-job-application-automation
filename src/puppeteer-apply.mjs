#!/usr/bin/env node

import puppeteer from 'puppeteer';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { readQADatabase, addOrUpdateQA, findBestMatch } from './qa-database.mjs';

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

  // Define URL patterns early so they can be used in event listeners
  const targetPagePattern = /^https:\/\/hh\.ru\/search\/vacancy/;
  const vacancyResponsePattern = /^https:\/\/hh\.ru\/applicant\/vacancy_response\?vacancyId=/;

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

  // Issue #68: Save Q&A pairs before navigation away from vacancy_response page
  // This ensures answers are saved even if user navigates away quickly
  let lastUrl = page.url();
  page.on('framenavigated', async (frame) => {
    // Only handle main frame navigation
    if (frame !== page.mainFrame()) return;

    try {
      const currentUrl = frame.url();
      const wasOnVacancyResponse = vacancyResponsePattern.test(lastUrl);
      const isOnVacancyResponse = vacancyResponsePattern.test(currentUrl);

      // If we were on vacancy_response page and are navigating away, save Q&A pairs
      if (wasOnVacancyResponse && !isOnVacancyResponse) {
        console.log('🔄 Navigation detected from vacancy_response page, saving Q&A pairs...');
        const savedCount = await saveQAPairs();
        if (savedCount > 0) {
          console.log(`💾 Saved ${savedCount} Q&A pair(s) before navigation`);
        }
      }

      lastUrl = currentUrl;
    } catch (error) {
      // Ignore errors during navigation save
      console.log('⚠️  Error saving Q&A during navigation:', error.message);
    }
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
        // Silently ignore detached frame errors - these occur when user switches tabs
        // and are expected behavior. The loop will continue checking and will succeed
        // once the user returns to the main tab.
        const isDetachedFrameError = error.message && error.message.includes('detached Frame');
        if (!isDetachedFrameError) {
          // Only log non-detached-frame errors
          console.log(`⚠️  Temporary error while checking URL: ${error.message.substring(0, 100)}... (retrying)`);
        }
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

  const BUTTON_CLICK_INTERVAL = argv['job-application-interval'] * 1000; // Convert seconds to milliseconds

  /**
   * Setup Q&A auto-fill and auto-save for all textareas on the page
   * Issue #68: Automatically remember and prefill answers to repetitive questions
   * Issue #80: Use proper typing simulation instead of direct value assignment
   */
  async function setupQAHandling() {
    try {
      // Read the Q&A database
      const qaMap = await readQADatabase();

      // Extract all questions and their corresponding textarea selectors
      const pageQuestions = await page.evaluate(() => {
        const questions = [];
        const textareas = document.querySelectorAll('textarea');

        textareas.forEach((textarea, index) => {
          const taskBody = textarea.closest('[data-qa="task-body"]');
          if (!taskBody) return;

          const questionEl = taskBody.querySelector('[data-qa="task-question"]');
          if (!questionEl) return;

          const question = questionEl.textContent.trim();
          if (question) {
            // Create a unique selector for this textarea
            // Prefer name attribute for more reliable selection, fallback to nth-of-type
            const selector = textarea.name ? `textarea[name="${textarea.name}"]` : `textarea:nth-of-type(${index + 1})`;
            questions.push({ question, selector, index });
          }
        });

        return questions;
      });

      // Use fuzzy matching to find answers for each question
      // Issue #74: Questions on forms may be phrased differently than in database
      const questionToAnswer = new Map();
      for (const { question, selector, index } of pageQuestions) {
        const match = findBestMatch(question, qaMap);
        if (match) {
          questionToAnswer.set(question, { answer: match.answer, selector, index });
          console.log(`[QA] Fuzzy match for "${question}" (score: ${match.score.toFixed(3)})`);
          console.log(`[QA] Matched to: "${match.question}"`);
          console.log(`[QA] Answer: "${match.answer}"`);
        }
      }

      // Prefill textareas using Puppeteer's type() method for proper event triggering
      // Issue #80: Direct value assignment doesn't work with hh.ru's framework
      for (const [question, { answer, selector }] of questionToAnswer) {
        try {
          const currentValue = await page.$eval(selector, el => el.value);

          if (!currentValue || currentValue.trim() === '') {
            // Use click() + type() method to simulate real user input like cover letter filling
            // This triggers all necessary events that hh.ru framework expects
            await page.click(selector);
            await page.type(selector, answer);
            console.log(`[QA] Prefilled answer for: ${question}`);
          } else {
            console.log(`[QA] Textarea already has content for: ${question}`);
          }
        } catch (error) {
          console.error(`[QA] Error prefilling textarea for "${question}":`, error.message);
        }
      }

      // Inject client-side script to handle Q&A saving functionality
      await page.evaluate((qaData) => {
        // Convert Map entries to object for serialization
        const qaObj = Object.fromEntries(qaData);

        // Find all textareas on the page
        const textareas = document.querySelectorAll('textarea');

        textareas.forEach((textarea) => {
          // Look for the question label
          const taskBody = textarea.closest('[data-qa="task-body"]');
          if (!taskBody) return;

          const questionEl = taskBody.querySelector('[data-qa="task-question"]');
          if (!questionEl) return;

          const question = questionEl.textContent.trim();
          if (!question) return;

          // Get the known answer for this question
          const knownAnswer = qaObj[question]?.answer;

          // Add blur event listener to save Q&A when user finishes editing
          textarea.addEventListener('blur', async () => {
            const answer = textarea.value.trim();
            if (answer && answer !== knownAnswer) {
              // Mark this Q&A pair for saving
              textarea.dataset.qaQuestion = question;
              textarea.dataset.qaAnswer = answer;
              console.log('[QA] Marked for saving:', question, '->', answer);
            }
          });
        });
      }, Array.from(questionToAnswer.entries()));

      // Collect and save any Q&A pairs that were marked for saving
      const qaPairsToSave = await page.evaluate(() => {
        const pairs = [];
        const textareas = document.querySelectorAll('textarea[data-qa-question][data-qa-answer]');
        textareas.forEach((textarea) => {
          pairs.push({
            question: textarea.dataset.qaQuestion,
            answer: textarea.dataset.qaAnswer,
          });
        });
        return pairs;
      });

      // Save any new Q&A pairs to the database
      for (const { question, answer } of qaPairsToSave) {
        await addOrUpdateQA(question, answer);
        console.log('💾 Saved Q&A:', question);
      }

      return qaPairsToSave.length;
    } catch (error) {
      console.error('⚠️  Error setting up Q&A handling:', error.message);
      return 0;
    }
  }

  /**
   * Save Q&A pairs from textareas after user interaction
   */
  async function saveQAPairs() {
    try {
      const qaPairs = await page.evaluate(() => {
        const pairs = [];
        const textareas = document.querySelectorAll('textarea');

        textareas.forEach((textarea) => {
          const taskBody = textarea.closest('[data-qa="task-body"]');
          if (!taskBody) return;

          const questionEl = taskBody.querySelector('[data-qa="task-question"]');
          if (!questionEl) return;

          const question = questionEl.textContent.trim();
          const answer = textarea.value.trim();

          if (question && answer) {
            pairs.push({ question, answer });
          }
        });

        return pairs;
      });

      for (const { question, answer } of qaPairs) {
        await addOrUpdateQA(question, answer);
        console.log('💾 Saved Q&A:', question);
      }

      return qaPairs.length;
    } catch (error) {
      console.error('⚠️  Error saving Q&A pairs:', error.message);
      return 0;
    }
  }

  /**
   * Handle the vacancy_response page by prefilling the message and optionally clicking submit
   * Issue #65: Prefill message on vacancy_response page and only auto-click if no other text fields exist
   */
  async function handleVacancyResponsePage() {
    console.log('📝 Detected vacancy_response page, handling application form...');

    // First, try to click the toggle button to expand the cover letter section if it's collapsed
    try {
      const toggleButton = await page.$('[data-qa="vacancy-response-letter-toggle"]');
      if (toggleButton) {
        console.log('🔘 Cover letter section is collapsed, clicking toggle to expand...');
        await toggleButton.click();
        // Wait a moment for the expand animation to complete
        await new Promise(r => setTimeout(r, 500));
        console.log('✅ Cover letter section expanded');
      }
    } catch {
      // Toggle button might not exist if the section is already expanded
      console.log('💡 Toggle button not found, cover letter section may already be expanded');
    }

    // Wait for the textarea to be visible
    try {
      await page.waitForSelector('textarea[data-qa="vacancy-response-popup-form-letter-input"]', {
        visible: true,
        timeout: 5000,
      });
    } catch {
      console.log('⚠️  Cover letter textarea not found on vacancy_response page');
      return;
    }

    // Check if textarea is already filled
    const currentValue = await page.$eval('textarea[data-qa="vacancy-response-popup-form-letter-input"]', el => el.value);
    if (!currentValue || currentValue.trim() === '') {
      // Click on textarea to activate it
      await page.click('textarea[data-qa="vacancy-response-popup-form-letter-input"]');
      // Type the message
      await page.type('textarea[data-qa="vacancy-response-popup-form-letter-input"]', MESSAGE);
      console.log('✅ Prefilled cover letter message');
    } else {
      console.log('⏭️  Cover letter already contains text, skipping prefill');
    }

    // Count all textareas on the page
    const textareas = await page.$$('textarea');
    const textareaCount = textareas.length;

    console.log(`📊 Found ${textareaCount} textarea(s) on the page`);

    // Issue #68: Setup Q&A handling for all textareas with questions
    // This will prefill known answers and prepare to save new ones
    await setupQAHandling();

    // Only auto-click submit if there is exactly 1 textarea (the cover letter one)
    if (textareaCount === 1) {
      console.log('✅ Only one textarea found, safe to auto-submit');

      // Check if submit button is disabled
      const submitButton = await page.$('[data-qa="vacancy-response-submit-popup"]');
      if (!submitButton) {
        console.log('⚠️  Submit button not found');
        return;
      }

      const isButtonDisabled = await page.evaluate(el => el.hasAttribute('disabled') || el.classList.contains('disabled'), submitButton);

      if (isButtonDisabled) {
        console.log('⚠️  Submit button is disabled, manual action required');
      } else {
        // Click the submit button
        await page.click('[data-qa="vacancy-response-submit-popup"]');
        console.log('✅ Clicked submit button');

        // Wait for submission to complete
        await new Promise(r => setTimeout(r, 2000));
      }
    } else {
      console.log('⚠️  Multiple textareas found, manual submission required to avoid errors');
      console.log('💡 Please review and submit the form manually when ready');

      // Issue #68: Save Q&A pairs before waiting for manual submission
      // This ensures answers are saved even if user doesn't submit immediately
      const savedCount = await saveQAPairs();
      if (savedCount > 0) {
        console.log(`💾 Saved ${savedCount} Q&A pair(s) to database`);
      }
    }
  }

  // Check if we're already on a vacancy_response page at startup
  const currentUrl = page.url();
  if (vacancyResponsePattern.test(currentUrl)) {
    await handleVacancyResponsePage();
    console.log('✅ Initial vacancy_response page handled. Script will continue monitoring...');
  }

  // Issue #68: Setup periodic Q&A saving
  // This ensures Q&A pairs are saved even if user navigates away manually
  let lastSaveTime = Date.now();
  const SAVE_INTERVAL_MS = 5000; // Save every 5 seconds if on vacancy_response page

  // Periodic save interval
  const saveInterval = setInterval(async () => {
    try {
      const currentUrl = page.url();
      const now = Date.now();

      // Only save if we're on a vacancy_response page and enough time has passed
      if (vacancyResponsePattern.test(currentUrl) && (now - lastSaveTime) >= SAVE_INTERVAL_MS) {
        const savedCount = await saveQAPairs();
        if (savedCount > 0) {
          console.log(`💾 Auto-saved ${savedCount} Q&A pair(s)`);
          lastSaveTime = now;
        }
      }
    } catch {
      // Ignore errors during periodic save
    }
  }, SAVE_INTERVAL_MS);

  // Cleanup interval on process exit
  process.on('exit', () => clearInterval(saveInterval));

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

      // Check if it's a vacancy_response page (Issue #65)
      if (vacancyResponsePattern.test(currentUrl)) {
        console.log('💡 This is a vacancy_response page, handling automatically...');
        await handleVacancyResponsePage();

        // Wait for potential redirect or manual navigation back
        await new Promise(r => setTimeout(r, 2000));

        // Check if we're back on the target page or still on vacancy_response
        const newUrl = page.url();
        if (targetPagePattern.test(newUrl)) {
          console.log('✅ Back on search page after submission');
          await new Promise(r => setTimeout(r, 1000));
          continue;
        } else if (vacancyResponsePattern.test(newUrl)) {
          // Still on vacancy_response page (manual submission required)
          console.log('💡 Waiting for you to complete and navigate back to:', START_URL);

          // Issue #68: Save Q&A pairs before waiting for navigation
          // This ensures answers are saved even if user navigates away quickly
          const savedCount = await saveQAPairs();
          if (savedCount > 0) {
            console.log(`💾 Saved ${savedCount} Q&A pair(s) before waiting for navigation`);
          }

          await waitForUrlCondition(START_URL, 'Waiting for you to return to the target page');
          if (pageClosedByUser) {
            return;
          }
          console.log('✅ Returned to target page! Continuing with button loop...');
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      } else {
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
    }

    // No redirect occurred, wait for modal to appear
    // Issue #53 Fix: Handle timeout gracefully when modal doesn't appear
    let modalAppeared = false;
    try {
      await page.waitForSelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]', {
        visible: true,
        timeout: 10000, // 10 second timeout
      });
      modalAppeared = true;
    } catch {
      console.log('⚠️  Modal did not appear within timeout. This may be a different type of vacancy response.');
      console.log('💡 Skipping this button and moving to the next one...');
      // Continue to next iteration to try the next button
      continue;
    }

    if (!modalAppeared) {
      continue; // Safety check, should not reach here
    }

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

    // Click "Добавить сопроводительное" or element with data-qa="add-cover-letter" or data-qa="vacancy-response-letter-toggle"
    const nodes = await page.$$('button, a, span, div');
    for (const el of nodes) {
      const txt = (await page.evaluate(el => el.textContent.trim(), el)) || '';
      const dataQa = (await page.evaluate(el => el.getAttribute('data-qa'), el)) || '';
      if (txt === 'Добавить сопроводительное' || dataQa === 'add-cover-letter' || dataQa === 'vacancy-response-letter-toggle') { await el.click(); break; }
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
    } else {
      console.error('❌ Puppeteer: textarea value does not match expected message');
      console.error('Expected:', MESSAGE);
      console.error('Actual:', textareaValue);
    }

    // Issue #63 Fix: Check if submit button is disabled AFTER entering the message
    // This is important because some vacancies require a cover letter, and the button
    // is disabled until the message is entered
    const submitButton = await page.$('[data-qa="vacancy-response-submit-popup"]');
    const isButtonDisabled = await page.evaluate(el => el.hasAttribute('disabled') || el.classList.contains('disabled'), submitButton);

    if (isButtonDisabled) {
      console.error('❌ Application button is still disabled after entering the message!');

      // Try to extract the error/warning message from the modal
      try {
        // Get all text content from the modal to find the reason
        const modalForm = await page.$('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]');
        const modalText = await page.evaluate(el => el.innerText, modalForm);

        // Log the reason from the modal
        console.error('📋 Reason from modal:');
        console.error(modalText);
      } catch {
        console.error('⚠️  Could not extract detailed error message from modal');
      }

      console.error('');
      console.error('💡 Please resolve this issue and try again.');

      // Close browser and exit with error
      if (browser) {
        await browser.close();
      }
      process.exit(1);
    }

    // Click the "Откликнуться" submit button
    await page.click('[data-qa="vacancy-response-submit-popup"]');
    console.log('✅ Puppeteer: clicked submit button');

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
