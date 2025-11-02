const puppeteer = require('puppeteer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

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
    .help()
    .argv;

  const MESSAGE = process.env.MESSAGE || 'В какой форме предлагается юридическое оформление удалённой работы?';
  const START_URL = argv.url;

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] });
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
