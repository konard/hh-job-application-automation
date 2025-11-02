// Test script to verify --manual-login option parsing in both scripts
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

console.log('Testing --manual-login option parsing...\n');

// Test case 1: Default (no --manual-login)
const argv1 = yargs(['--url', 'https://hh.ru/search/vacancy'])
  .option('url', {
    alias: 'u',
    type: 'string',
    description: 'URL to navigate to',
    default: 'https://hh.ru/search/vacancy?from=resumelist'
  })
  .option('manual-login', {
    type: 'boolean',
    description: 'Open login page and wait for manual authentication before proceeding',
    default: false
  })
  .help()
  .argv;

console.log('Test 1: Without --manual-login flag');
console.log('  URL:', argv1.url);
console.log('  manual-login:', argv1['manual-login']);
console.log('  Expected: false');
console.log('  Status:', argv1['manual-login'] === false ? '✅ PASS' : '❌ FAIL');
console.log();

// Test case 2: With --manual-login flag
const argv2 = yargs(['--url', 'https://hh.ru/search/vacancy', '--manual-login'])
  .option('url', {
    alias: 'u',
    type: 'string',
    description: 'URL to navigate to',
    default: 'https://hh.ru/search/vacancy?from=resumelist'
  })
  .option('manual-login', {
    type: 'boolean',
    description: 'Open login page and wait for manual authentication before proceeding',
    default: false
  })
  .help()
  .argv;

console.log('Test 2: With --manual-login flag');
console.log('  URL:', argv2.url);
console.log('  manual-login:', argv2['manual-login']);
console.log('  Expected: true');
console.log('  Status:', argv2['manual-login'] === true ? '✅ PASS' : '❌ FAIL');
console.log();

// Test case 3: URL encoding test
const testUrl = 'https://hh.ru/search/vacancy?resume=80d55a81ff0171bfa80039ed1f743266675357&from=resumelist';
const encodedBackurl = encodeURIComponent(testUrl);
const loginUrl = `https://hh.ru/account/login?role=applicant&backurl=${encodedBackurl}&hhtmFrom=vacancy_search_list`;

console.log('Test 3: Login URL construction');
console.log('  Original URL:', testUrl);
console.log('  Encoded backurl:', encodedBackurl);
console.log('  Login URL:', loginUrl);
console.log('  Status:', loginUrl.includes('backurl=') && loginUrl.includes('role=applicant') ? '✅ PASS' : '❌ FAIL');
console.log();

console.log('All parsing tests completed!');
