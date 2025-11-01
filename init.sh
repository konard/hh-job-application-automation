
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-hhru-automation}"
MSG='В какой форме предлагается юридическое оформление удалённой работы?'
START_URL='https://hh.ru/search/vacancy?from=resumelist'

echo "🚀 Initializing repo: $APP_DIR"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Init Node project
npm init -y >/dev/null
npm i -D playwright puppeteer >/dev/null
npx playwright install chromium >/dev/null

# .gitignore
cat > .gitignore <<'EOF'
node_modules/
playwright-report/
test-results/
.DS_Store
EOF

# --- 1️⃣ In-browser script (for copying into DevTools console) ---
cat > inbrowser-clicks.js <<'EOF'
/**
 * In-browser DevTools version.
 * Paste into console while viewing hh.ru search results.
 */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (selector, { timeout = 8000 } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(200);
    }
    throw new Error(`Timeout for ${selector}`);
  };
  const waitForText = async (text, tags = ['a','button','span'], timeout = 8000) => {
    const t0 = Date.now();
    const sel = tags.join(',');
    while (Date.now() - t0 < timeout) {
      const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim() === text);
      if (el) return el;
      await sleep(200);
    }
    throw new Error(`Timeout for "${text}"`);
  };
  const link = [...document.querySelectorAll('a')].find(e => e.textContent.trim() === 'Откликнуться');
  if (!link) throw new Error('No "Откликнуться" link found.');
  link.click();
  const form = await waitFor('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]');
  const addCover = await waitForText('Добавить сопроводительное');
  addCover.click();
  console.log('✅ Clicked both buttons (Откликнуться + Добавить сопроводительное)');
})();
EOF

# --- 2️⃣ Playwright version ---
cat > playwright-click-and-type.js <<EOF
const { chromium } = require('playwright');

(async () => {
  const MESSAGE = process.env.MESSAGE || '$MSG';
  const START_URL = process.env.START_URL || '$START_URL';

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
EOF

# --- 3️⃣ Puppeteer version ---
cat > puppeteer-click-and-type.js <<EOF
const puppeteer = require('puppeteer');

(async () => {
  const MESSAGE = process.env.MESSAGE || '$MSG';
  const START_URL = process.env.START_URL || '$START_URL';

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] });
  const [page] = await browser.pages();

  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

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
EOF

# --- npm scripts ---
node -e '
const fs=require("fs");
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
pkg.scripts={
  "console":"echo 'Open hh.ru in browser → copy inbrowser-clicks.js → paste in DevTools'",
  "playwright":"node playwright-click-and-type.js",
  "puppeteer":"node puppeteer-click-and-type.js"
};
fs.writeFileSync("package.json", JSON.stringify(pkg,null,2));
'

# --- Git init ---
git init >/dev/null
git add .
git commit -m "initial hh.ru automation (console, Playwright, Puppeteer)" >/dev/null

echo "✅ Repo created in $(pwd)"
echo "▶ Run:"
echo "   npm run playwright   # Playwright automation"
echo "   npm run puppeteer    # Puppeteer automation"
echo "   npm run console      # Reminder for browser version"
echo
echo "💡 To push to GitHub:"
echo "   git remote add origin <YOUR_GITHUB_URL.git>"
echo "   git branch -M main && git push -u origin main"