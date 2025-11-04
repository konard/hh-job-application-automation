// Simple syntax check for puppeteer-apply.mjs
// This verifies that the file can be parsed without syntax errors

const fs = require('fs');
const path = require('path');

const puppeteerFile = path.join(__dirname, '..', 'puppeteer-apply.mjs');
const playwrightFile = path.join(__dirname, '..', 'playwright-apply.mjs');

console.log('🔍 Checking syntax of automation scripts...\n');

// Read and check puppeteer file
try {
  const puppeteerCode = fs.readFileSync(puppeteerFile, 'utf8');

  // Check for the invalid syntax pattern
  if (puppeteerCode.includes('page.15399')) {
    console.error('❌ ERROR: Found invalid syntax "page.15399" in puppeteer-apply.mjs');
    console.error('   This should be "page.$$" for Puppeteer element query');
    process.exit(1);
  }

  // Try to parse it (basic syntax check)
  require(puppeteerFile);
  console.log('✅ puppeteer-apply.mjs syntax is valid');
} catch (err) {
  console.error('❌ ERROR in puppeteer-apply.mjs:', err.message);
  process.exit(1);
}

// Read and check playwright file
try {
  const playwrightCode = fs.readFileSync(playwrightFile, 'utf8');

  // Try to parse it (basic syntax check)
  require(playwrightFile);
  console.log('✅ playwright-apply.mjs syntax is valid');
} catch (err) {
  console.error('❌ ERROR in playwright-apply.mjs:', err.message);
  process.exit(1);
}

console.log('\n✅ All syntax checks passed!');
