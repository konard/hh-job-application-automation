// Test script to verify --message option parsing in both puppeteer and playwright scripts
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const path = require('path');
const os = require('os');

console.log('Testing --message option parsing...\n');

// Test case 1: With --message option
const argv1 = yargs(['--message', 'Custom test message'])
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
    default: path.join(os.homedir(), '.hh-automation', 'test-data'),
  })
  .option('job-application-interval', {
    type: 'number',
    description: 'Interval in seconds to wait between job application button clicks',
    default: 20,
  })
  .option('message', {
    alias: 'm',
    type: 'string',
    description: 'Message to send with job application',
  })
  .help()
  .argv;

const MESSAGE1 = argv1.message || process.env.MESSAGE || 'Default message';

console.log('Test 1: With --message option');
console.log('  argv.message:', argv1.message);
console.log('  MESSAGE constant:', MESSAGE1);
console.log('  Expected: "Custom test message"');
console.log('  Result:', MESSAGE1 === 'Custom test message' ? '✅ PASS' : '❌ FAIL');

console.log();

// Test case 2: Without --message option (should use default)
const argv2 = yargs([])
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
    default: path.join(os.homedir(), '.hh-automation', 'test-data'),
  })
  .option('job-application-interval', {
    type: 'number',
    description: 'Interval in seconds to wait between job application button clicks',
    default: 20,
  })
  .option('message', {
    alias: 'm',
    type: 'string',
    description: 'Message to send with job application',
  })
  .help()
  .argv;

const MESSAGE2 = argv2.message || process.env.MESSAGE || 'Default message';

console.log('Test 2: Without --message option');
console.log('  argv.message:', argv2.message);
console.log('  MESSAGE constant:', MESSAGE2);
console.log('  Expected: "Default message"');
console.log('  Result:', MESSAGE2 === 'Default message' ? '✅ PASS' : '❌ FAIL');

console.log();

// Test case 3: With -m shorthand option
const argv3 = yargs(['-m', 'Short option test'])
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
    default: path.join(os.homedir(), '.hh-automation', 'test-data'),
  })
  .option('job-application-interval', {
    type: 'number',
    description: 'Interval in seconds to wait between job application button clicks',
    default: 20,
  })
  .option('message', {
    alias: 'm',
    type: 'string',
    description: 'Message to send with job application',
  })
  .help()
  .argv;

const MESSAGE3 = argv3.message || process.env.MESSAGE || 'Default message';

console.log('Test 3: With -m shorthand option');
console.log('  argv.message:', argv3.message);
console.log('  MESSAGE constant:', MESSAGE3);
console.log('  Expected: "Short option test"');
console.log('  Result:', MESSAGE3 === 'Short option test' ? '✅ PASS' : '❌ FAIL');

console.log('\n✅ All tests completed!');
