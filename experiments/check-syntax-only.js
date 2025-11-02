// Simple syntax check without requiring modules
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const puppeteerFile = path.join(__dirname, '..', 'puppeteer-click-and-type.js');
const playwrightFile = path.join(__dirname, '..', 'playwright-click-and-type.js');

console.log('🔍 Checking syntax of automation scripts...\n');

// Check puppeteer file
const puppeteerCode = fs.readFileSync(puppeteerFile, 'utf8');

if (puppeteerCode.includes('page.15399')) {
  console.error('❌ ERROR: Found invalid syntax "page.15399" in puppeteer-click-and-type.js');
  console.error('   This should be "page.$$" for Puppeteer element query');
  process.exit(1);
}

console.log('✅ No invalid "page.15399" syntax found in puppeteer-click-and-type.js');

// Basic parse check (will catch obvious syntax errors)
try {
  new vm.Script(puppeteerCode, { filename: 'puppeteer-click-and-type.js' });
  console.log('✅ puppeteer-click-and-type.js can be parsed successfully');
} catch (err) {
  console.error('❌ Syntax error in puppeteer-click-and-type.js:', err.message);
  process.exit(1);
}

// Check playwright file
const playwrightCode = fs.readFileSync(playwrightFile, 'utf8');
try {
  new vm.Script(playwrightCode, { filename: 'playwright-click-and-type.js' });
  console.log('✅ playwright-click-and-type.js can be parsed successfully');
} catch (err) {
  console.error('❌ Syntax error in playwright-click-and-type.js:', err.message);
  process.exit(1);
}

console.log('\n✅ All syntax checks passed!');
