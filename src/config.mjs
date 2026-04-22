/**
 * Configuration module using lino-arguments library
 *
 * Provides unified configuration from CLI arguments, environment variables,
 * and .lenv configuration files.
 *
 * @module config
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { makeConfig } from 'lino-arguments';

/**
 * Default cover letter message
 */
const DEFAULT_MESSAGE = '';

function loadMessageFromFile(filePath) {
  if (!filePath) {
    return '';
  }

  const resolvedPath = path.resolve(filePath);
  const fileContents = fs.readFileSync(resolvedPath, 'utf8');

  // Normalize line endings and drop a single trailing newline from text files.
  return fileContents.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

/**
 * Create configuration from CLI arguments and environment variables
 *
 * Uses lino-arguments pattern for unified configuration:
 * - CLI arguments have highest priority
 * - Environment variables are used as defaults
 * - .lenv files can provide local configuration
 *
 * @returns {Object} Configuration object with camelCase keys
 */
export function createConfig() {
  const config = makeConfig({
    yargs: ({ yargs, getenv }) =>
      yargs
        .option('engine', {
          type: 'string',
          description: 'Browser automation engine to use: playwright or puppeteer',
          choices: ['playwright', 'puppeteer'],
          default: getenv('ENGINE', 'playwright'),
        })
        .option('url', {
          alias: 'u',
          type: 'string',
          description: 'URL to navigate to',
          default: getenv('START_URL', 'https://hh.ru/search/vacancy?from=resumelist'),
        })
        .option('manual-login', {
          type: 'boolean',
          description: 'Open login page and wait for manual authentication before proceeding',
          default: getenv('MANUAL_LOGIN', false),
        })
        .option('user-data-dir', {
          type: 'string',
          description: 'Path to user data directory for persistent session storage',
          // Default is set dynamically based on engine below
        })
        .option('job-application-interval', {
          type: 'number',
          description: 'Interval in seconds to wait between job application button clicks',
          default: getenv('JOB_APPLICATION_INTERVAL', 20),
        })
        .option('message', {
          alias: 'm',
          type: 'string',
          description: 'Message to send with job application',
          default: getenv('MESSAGE', ''),
        })
        .option('message-file', {
          type: 'string',
          description: 'Path to a UTF-8 text file with the message to send',
          default: getenv('MESSAGE_FILE', ''),
        })
        .option('verbose', {
          type: 'boolean',
          description: 'Enable verbose logging for debugging',
          default: getenv('VERBOSE', false),
        })
        .option('auto-submit-vacancy-response-form', {
          type: 'boolean',
          description: 'Auto-submit vacancy response forms when all questions are answered (default: false for safety)',
          default: getenv('AUTO_SUBMIT_VACANCY_RESPONSE_FORM', false),
        })
        .option('ignore-vacancies-with-questionnaire', {
          type: 'boolean',
          description: 'Skip vacancies that require additional questionnaire fields beyond the cover letter',
          default: getenv('IGNORE_VACANCIES_WITH_QUESTIONNAIRE', false),
        })
        .help(),
  });

  config.message = config.message || loadMessageFromFile(config.messageFile) || DEFAULT_MESSAGE;

  return config;
}

/**
 * Get user data directory path based on engine
 * @param {string} engine - Browser engine ('playwright' or 'puppeteer')
 * @returns {string} - Path to user data directory
 */
export function getUserDataDir(engine) {
  return path.join(os.homedir(), '.hh-automation', `${engine}-data`);
}

/**
 * Get the default message
 * @returns {string}
 */
export function getDefaultMessage() {
  return DEFAULT_MESSAGE;
}
