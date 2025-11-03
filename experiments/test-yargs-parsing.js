const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Test script to verify yargs argument parsing
const argv = yargs(hideBin(process.argv))
  .option('url', {
    alias: 'u',
    type: 'string',
    description: 'URL to navigate to',
    default: process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist',
  })
  .help()
  .argv;

console.log('Parsed arguments:');
console.log('  --url:', argv.url);
console.log('\nFull argv object:', argv);
