// Test that both playwright and puppeteer scripts support the new cover letter button markup
// with data-qa="vacancy-response-letter-toggle" attribute (issue #59)

const fs = require('fs');
const path = require('path');

console.log('🔍 Testing support for vacancy-response-letter-toggle cover letter button markup...\n');

const puppeteerFile = path.join(__dirname, '..', 'puppeteer-apply.mjs');
const playwrightFile = path.join(__dirname, '..', 'playwright-apply.mjs');

let hasErrors = false;

// Test Playwright implementation
console.log('📝 Checking playwright-apply.mjs...');
const playwrightCode = fs.readFileSync(playwrightFile, 'utf8');

if (playwrightCode.includes('data-qa="vacancy-response-letter-toggle"')) {
  console.log('✅ Playwright: Found support for data-qa="vacancy-response-letter-toggle" attribute');
} else {
  console.error('❌ Playwright: Missing support for data-qa="vacancy-response-letter-toggle" attribute');
  hasErrors = true;
}

// Verify the selector includes both old and new patterns
const playwrightCoverLetterLine = playwrightCode
  .split('\n')
  .find(line => line.includes('Добавить сопроводительное') && line.includes('locator'));

if (playwrightCoverLetterLine) {
  console.log('✅ Playwright: Cover letter selector found');
  if (playwrightCoverLetterLine.includes('vacancy-response-letter-toggle')) {
    console.log('✅ Playwright: Selector includes vacancy-response-letter-toggle data-qa attribute');
  } else {
    console.error('❌ Playwright: Selector missing vacancy-response-letter-toggle data-qa attribute');
    hasErrors = true;
  }
} else {
  console.error('❌ Playwright: Could not find cover letter selector line');
  hasErrors = true;
}

console.log('');

// Test Puppeteer implementation
console.log('📝 Checking puppeteer-apply.mjs...');
const puppeteerCode = fs.readFileSync(puppeteerFile, 'utf8');

if (puppeteerCode.includes('data-qa')) {
  console.log('✅ Puppeteer: Found data-qa attribute handling');
} else {
  console.error('❌ Puppeteer: Missing data-qa attribute handling');
  hasErrors = true;
}

if (puppeteerCode.includes('vacancy-response-letter-toggle')) {
  console.log('✅ Puppeteer: Found support for vacancy-response-letter-toggle value');
} else {
  console.error('❌ Puppeteer: Missing support for vacancy-response-letter-toggle value');
  hasErrors = true;
}

// Verify the cover letter click logic checks both text and data-qa
const puppeteerCoverLetterSection = puppeteerCode
  .split('\n')
  .slice(344, 352)
  .join('\n');

if (puppeteerCoverLetterSection.includes('Добавить сопроводительное') &&
    puppeteerCoverLetterSection.includes('vacancy-response-letter-toggle')) {
  console.log('✅ Puppeteer: Cover letter logic checks both text and vacancy-response-letter-toggle data-qa attribute');
} else {
  console.error('❌ Puppeteer: Cover letter logic incomplete');
  hasErrors = true;
}

console.log('');

if (hasErrors) {
  console.error('❌ Some checks failed!');
  process.exit(1);
} else {
  console.log('✅ All checks passed! Both scripts support the new vacancy-response-letter-toggle cover letter button markup.');
}
