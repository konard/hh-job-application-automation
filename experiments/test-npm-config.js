// Test to see if npm passes --url as a config option
console.log('npm_config_url:', process.env.npm_config_url);
console.log('process.argv:', process.argv);

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('url', {
    alias: 'u',
    type: 'string',
    description: 'URL to navigate to',
    default: process.env.npm_config_url || process.env.START_URL || 'https://hh.ru/search/vacancy?from=resumelist'
  })
  .help()
  .argv;

console.log('Parsed URL:', argv.url);
