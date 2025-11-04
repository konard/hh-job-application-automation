const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

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

(async () => {
  console.log('🧪 Testing translation disable configuration in Puppeteer...');

  const userDataDir = path.join(os.homedir(), '.hh-automation', 'puppeteer-test-translation');

  // Disable translate in Preferences before launching browser
  await disableTranslateInPreferences(userDataDir);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crash-restore',
    ],
    userDataDir: userDataDir,
  });

  const [page] = await browser.pages();

  // Navigate to a Russian language page (hh.ru)
  console.log('📍 Navigating to hh.ru (Russian language page)...');
  await page.goto('https://hh.ru/search/vacancy?from=resumelist', { waitUntil: 'domcontentloaded' });

  console.log('⏳ Waiting 10 seconds to observe if translation popup appears...');
  await new Promise(r => setTimeout(r, 10000));

  console.log('✅ Test completed. Please verify visually that no translation popup appeared.');
  console.log('💡 The browser will stay open for 30 more seconds for manual inspection.');

  await new Promise(r => setTimeout(r, 30000));

  await browser.close();
  console.log('🏁 Test finished.');
})().catch((error) => {
  console.error('❌ Error occurred:', error.message);
  process.exit(1);
});
