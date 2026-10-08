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
          description: 'Vacancy search URL (default: suggested vacancies for the most recently updated resume)',
          default: getenv('START_URL', ''),
        })
        .option('manual-login', {
          type: 'boolean',
          description: 'Do not import logins from other browsers; wait for a manual login instead',
          default: getenv('MANUAL_LOGIN', false),
        })
        .option('login-from', {
          type: 'string',
          description: 'Only use logins from browser profiles whose name contains this text (e.g. "chrome Default")',
          default: getenv('LOGIN_FROM', ''),
        })
        .option('keep-browser-open', {
          type: 'boolean',
          description: 'Keep the browser running after exit so the next run reuses it',
          default: getenv('KEEP_BROWSER_OPEN', false),
        })
        .option('browser-idle-timeout', {
          type: 'number',
          description: 'Minutes after which a kept-open, unused browser is closed',
          default: getenv('BROWSER_IDLE_TIMEOUT', 30),
        })
        .option('browser-port', {
          type: 'number',
          description: 'Remote debugging port of the automation browser',
          default: getenv('BROWSER_PORT', 9322),
        })
        .option('test-mode', {
          type: 'boolean',
          description: 'Apply to a single vacancy, asking on stdin to confirm every click and typed value',
          default: getenv('TEST_MODE', false),
        })
        .option('trace', {
          type: 'boolean',
          description: 'Record a browser-commander trace (DOM, mutations, actions) with Links Notation export to logs/traces',
          default: getenv('TRACE', true),
        })
        .option('user-data-dir', {
          type: 'string',
          description: 'Path to user data directory for persistent session storage',
          // Default is set dynamically based on engine below
        })
        .option('job-application-interval', {
          type: 'number',
          description: 'Minimum seconds between applications; a random extra of up to the same amount is added',
          default: getenv('JOB_APPLICATION_INTERVAL', 60),
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

  config.message ||= loadMessageFromFile(config.messageFile);

  return config;
}

/**
 * Get the automation browser profile directory.
 * Both engines attach to the installed Chrome, so they share one profile. The older
 * per-engine `<engine>-data` profiles were created by the engines' bundled Chromium and
 * are left untouched.
 * @returns {string} - Path to user data directory
 */
export function getUserDataDir() {
  return path.join(os.homedir(), '.hh-automation', 'chrome-profile');
}
