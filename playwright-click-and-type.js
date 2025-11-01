const { chromium } = require('playwright');

(async () => {
  const MESSAGE = process.env.MESSAGE || 'Вы принимаете по КЭДО?';
  const START_URL = process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist';

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
