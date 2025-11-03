// Test script to verify --job-application-interval option parsing
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const path = require('path');
const os = require('os');

// Simulate parsing with different interval values
function testIntervalParsing(args) {
  const argv = yargs(args)
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'URL to navigate to',
      default: 'https://hh.ru/search/vacancy?from=resumelist',
    })
    .option('manual-login', {
      type: 'boolean',
      description: 'Open login page and wait for manual authentication before proceeding',
      default: false,
    })
    .option('user-data-dir', {
      type: 'string',
      description: 'Path to user data directory for persistent session storage',
      default: path.join(os.homedir(), '.hh-automation', 'playwright-data'),
    })
    .option('job-application-interval', {
      type: 'number',
      description: 'Interval in seconds to wait between job application button clicks',
      default: 20,
    })
    .help()
    .argv;

  return argv['job-application-interval'] * 1000;
}

console.log('Testing --job-application-interval option parsing:');
console.log('');

// Test 1: Default value (no option provided)
const interval1 = testIntervalParsing([]);
console.log('Test 1 - No option provided:');
console.log('  Expected: 20000ms (default 20 seconds)');
console.log('  Actual:  ', interval1 + 'ms');
console.log('  Result:  ', interval1 === 20000 ? '✅ PASS' : '❌ FAIL');
console.log('');

// Test 2: Custom value 10 seconds
const interval2 = testIntervalParsing(['--job-application-interval', '10']);
console.log('Test 2 - Custom value 10 seconds:');
console.log('  Expected: 10000ms');
console.log('  Actual:  ', interval2 + 'ms');
console.log('  Result:  ', interval2 === 10000 ? '✅ PASS' : '❌ FAIL');
console.log('');

// Test 3: Custom value 5 seconds
const interval3 = testIntervalParsing(['--job-application-interval', '5']);
console.log('Test 3 - Custom value 5 seconds:');
console.log('  Expected: 5000ms');
console.log('  Actual:  ', interval3 + 'ms');
console.log('  Result:  ', interval3 === 5000 ? '✅ PASS' : '❌ FAIL');
console.log('');

// Test 4: Custom value 30 seconds
const interval4 = testIntervalParsing(['--job-application-interval', '30']);
console.log('Test 4 - Custom value 30 seconds:');
console.log('  Expected: 30000ms');
console.log('  Actual:  ', interval4 + 'ms');
console.log('  Result:  ', interval4 === 30000 ? '✅ PASS' : '❌ FAIL');
console.log('');

// Final summary
const allPassed = interval1 === 20000 && interval2 === 10000 && interval3 === 5000 && interval4 === 30000;
console.log('='.repeat(50));
console.log('Overall Result:', allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
console.log('='.repeat(50));

process.exit(allPassed ? 0 : 1);
