const puppeteer = require('puppeteer');
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
      default: path.join(os.homedir(), '.hh-automation', 'puppeteer-data')
    })
    .help()
    .argv;

  const MESSAGE = process.env.MESSAGE || 'В какой форме предлагается юридическое оформление удалённой работы?';
  const START_URL = argv.url;

  // Launch browser with persistent user data directory to save cookies and session data
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
    userDataDir: argv['user-data-dir']
  });
  const [page] = await browser.pages();

  // Handle manual login if requested
  if (argv['manual-login']) {
    const backurl = encodeURIComponent(START_URL);
    const loginUrl = `https://hh.ru/account/login?role=applicant&backurl=${backurl}&hhtmFrom=vacancy_search_list`;

    console.log('🔐 Opening login page for manual authentication...');
    console.log('📍 Login URL:', loginUrl);

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    console.log('⏳ Waiting for you to complete login...');
    console.log('💡 The browser will automatically continue once you are redirected to:', START_URL);

    // Wait for redirect to the target URL after successful login
    await page.waitForFunction(
      (targetUrl) => window.location.href.startsWith(targetUrl),
      { timeout: 0 }, // No timeout - wait indefinitely for user to login
      START_URL
    );

    console.log('✅ Login successful! Proceeding with automation...');
  } else {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  }

  // Click first "Откликнуться"
  await page.waitForSelector('a');
  const links = await page.$$('a');
  for (const link of links) {
    const txt = (await page.evaluate(el => el.textContent.trim(), link)) || '';
    if (txt === 'Откликнуться') { await link.click(); break; }
  }

  // Wait a moment for potential navigation/redirect
  await page.waitForTimeout(1000);

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
  await page.waitForSelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]', { visible: true });

  // Click "Добавить сопроводительное"
  const nodes = await page.$$('button, a, span');
  for (const el of nodes) {
    const txt = (await page.evaluate(el => el.textContent.trim(), el)) || '';
    if (txt === 'Добавить сопроводительное') { await el.click(); break; }
  }

  // Activate textarea and type
  await page.waitForSelector('textarea[data-qa="vacancy-response-popup-form-letter-input"]', { visible: true });
  await page.click('textarea[data-qa="vacancy-response-popup-form-letter-input"]');
  await page.type('textarea[data-qa="vacancy-response-popup-form-letter-input"]', MESSAGE);

  console.log('✅ Puppeteer: typed message successfully');
  // await page.click('[data-qa="vacancy-response-submit-popup"]');
  // await browser.close();
})();
