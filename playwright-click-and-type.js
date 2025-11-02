const { chromium } = require('playwright');
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
    .help()
    .argv;

  const MESSAGE = process.env.MESSAGE || 'В какой форме предлагается юридическое оформление удалённой работы?';
  const START_URL = argv.url;

  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page = await browser.newPage();
  await page.goto(START_URL);

  const openBtn = page.locator('a', { hasText: 'Откликнуться' }).first();
  await openBtn.click();
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
