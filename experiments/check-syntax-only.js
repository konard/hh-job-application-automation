// Simple syntax check without requiring modules
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const puppeteerFile = path.join(__dirname, '..', 'puppeteer-apply.mjs');
const playwrightFile = path.join(__dirname, '..', 'playwright-apply.mjs');

console.log('🔍 Checking syntax of automation scripts...\n');

// Check puppeteer file
const puppeteerCode = fs.readFileSync(puppeteerFile, 'utf8');

if (puppeteerCode.includes('page.15399')) {
  console.error('❌ ERROR: Found invalid syntax "page.15399" in puppeteer-apply.mjs');
  console.error('   This should be "page.$$" for Puppeteer element query');
  process.exit(1);
}

console.log('✅ No invalid "page.15399" syntax found in puppeteer-apply.mjs');

// Basic parse check (will catch obvious syntax errors)
try {
  new vm.Script(puppeteerCode, { filename: 'puppeteer-apply.mjs' });
  console.log('✅ puppeteer-apply.mjs can be parsed successfully');
} catch (err) {
  console.error('❌ Syntax error in puppeteer-apply.mjs:', err.message);
  process.exit(1);
}

// Check playwright file
const playwrightCode = fs.readFileSync(playwrightFile, 'utf8');
try {
  new vm.Script(playwrightCode, { filename: 'playwright-apply.mjs' });
  console.log('✅ playwright-apply.mjs can be parsed successfully');
} catch (err) {
  console.error('❌ Syntax error in playwright-apply.mjs:', err.message);
  process.exit(1);
}

console.log('\n✅ All syntax checks passed!');
