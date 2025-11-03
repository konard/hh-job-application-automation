// Minimal test to verify playwright script argument parsing without launching browser
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('url', {
    alias: 'u',
    type: 'string',
    description: 'URL to navigate to',
    default: process.env.npm_config_url || process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist',
  })
  .help()
  .argv;

const MESSAGE = process.env.MESSAGE || 'В какой форме предлагается юридическое оформление удалённой работы?';
const START_URL = argv.url;

console.log('✅ Playwright test script');
console.log('   URL:', START_URL);
console.log('   Message:', MESSAGE);
