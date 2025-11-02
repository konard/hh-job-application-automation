const { chromium } = require('playwright');

(async () => {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let urlFromArgs = null;

  // Check for --url argument
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && i + 1 < args.length) {
      urlFromArgs = args[i + 1];
      break;
    }
  }

  // If no --url found, check if first argument is a URL (npm strips --url when used without --)
  if (!urlFromArgs && args.length > 0 && args[0].startsWith('http')) {
    urlFromArgs = args[0];
  }

  const MESSAGE = process.env.MESSAGE || 'В какой форме предлагается юридическое оформление удалённой работы?';
  const START_URL = urlFromArgs || process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist';

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
