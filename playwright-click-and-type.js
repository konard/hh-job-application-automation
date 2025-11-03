const { chromium } = require('playwright');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const path = require('path');
const os = require('os');

(async () => {
  // Parse command-line arguments using yargs
  // npm passes --url as npm_config_url when used without --
  const argv = yargs(hideBin(process.argv))
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'URL to navigate to',
      default: process.env.npm_config_url || process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist'
    })
    .option('manual-login', {
      type: 'boolean',
      description: 'Open login page and wait for manual authentication before proceeding',
      default: false
    })
    .option('user-data-dir', {
      type: 'string',
      description: 'Path to user data directory for persistent session storage',
      default: path.join(os.homedir(), '.hh-automation', 'playwright-data')
    })
    .help()
    .argv;

  const MESSAGE = process.env.MESSAGE || 'В какой форме предлагается юридическое оформление удалённой работы?';
  const START_URL = argv.url;

  // Launch browser with persistent context to save cookies and session data
  const browser = await chromium.launchPersistentContext(argv['user-data-dir'], {
    headless: false,
    slowMo: 150,
    args: [
      '--disable-session-crashed-bubble',  // Disable the "Restore pages?" popup
      '--disable-infobars',                 // Disable info bars
      '--no-first-run',                     // Skip first run tasks
      '--no-default-browser-check'          // Skip default browser check
    ]
  });
  const page = await browser.newPage();

  // Detect tab close event and exit gracefully
  page.on('close', () => {
    console.log('🔴 Tab close detected! Page was closed by user.');
    console.log('✅ Ending process gracefully...');
    process.exit(0);
  });

  // Handle manual login if requested
  if (argv['manual-login']) {
    const backurl = encodeURIComponent(START_URL);
    const loginUrl = `https://hh.ru/account/login?role=applicant&backurl=${backurl}&hhtmFrom=vacancy_search_list`;

    console.log('🔐 Opening login page for manual authentication...');
    console.log('📍 Login URL:', loginUrl);

    await page.goto(loginUrl);

    console.log('⏳ Waiting for you to complete login...');
    console.log('💡 The browser will automatically continue once you are redirected to:', START_URL);

    // Wait for redirect to the target URL after successful login
    await page.waitForFunction(
      (targetUrl) => window.location.href.startsWith(targetUrl),
      START_URL,
      { timeout: 0 } // No timeout - wait indefinitely for user to login
    );

    console.log('✅ Login successful! Proceeding with automation...');
  } else {
    await page.goto(START_URL);
  }

  const openBtn = page.locator('a', { hasText: 'Откликнуться' }).first();

  // Use Promise.race to handle both navigation and modal popup scenarios
  await Promise.race([
    openBtn.click(),
    // Wait for navigation with a timeout - if navigation happens, this resolves
    page.waitForNavigation({ timeout: 2000 }).catch(() => {
      // Navigation timeout is expected if modal opens instead of redirect
      // This is not an error, just means we stayed on the same page
    })
  ]);

  // Give additional time for any delayed redirects to complete
  await new Promise(r => setTimeout(r, 500));

  // Check if we're still on the target page
  const currentUrl = page.url();
  const targetPagePattern = /^https:\/\/hh\.ru\/search\/vacancy/;

  if (!targetPagePattern.test(currentUrl)) {
    console.log('⚠️  Redirected to a different page:', currentUrl);
    console.log('💡 This appears to be a separate application form page.');
    console.log('💡 Please fill out the form manually and navigate back to:', START_URL);
    console.log('🛑 Automation stopped - manual intervention required.');
    return; // Exit gracefully without error
  }

  // Continue with automation only if we're on the target page
  await page.waitForSelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]');

  const addCover = page.locator('button:has-text("Добавить сопроводительное"), a:has-text("Добавить сопроводительное")').first();
  if (await addCover.count()) await addCover.click();

  const textarea = page.locator('textarea[data-qa="vacancy-response-popup-form-letter-input"]');
  await textarea.click();
  await textarea.type(MESSAGE);

  console.log('✅ Playwright: typed message successfully');
  // await page.locator('[data-qa="vacancy-response-submit-popup"]').click();
  // await browser.close();
})();
