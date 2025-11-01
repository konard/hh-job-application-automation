const puppeteer = require('puppeteer');

(async () => {
  const MESSAGE = process.env.MESSAGE || 'Вы принимаете по КЭДО?';
  const START_URL = process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist';

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] });
  const [page] = await browser.pages();

  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  // Click first "Откликнуться"
  await page.waitForSelector('a');
  const links = await page.15399('a');
  for (const link of links) {
    const txt = (await page.evaluate(el => el.textContent.trim(), link)) || '';
    if (txt === 'Откликнуться') { await link.click(); break; }
  }

  await page.waitForSelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]', { visible: true });

  // Click "Добавить сопроводительное"
  const nodes = await page.15399('button, a, span');
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
