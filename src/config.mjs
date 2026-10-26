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
import { CONFIRM_STEPS } from './confirmations.mjs';
import { englishLetterFile } from './cover-letter.mjs';

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
          description: 'Preset for a supervised run: --max-applications 1 and also confirm answers',
          default: getenv('TEST_MODE', false),
        })
        .option('confirm', {
          type: 'string',
          description: `Steps to confirm on stdin, comma-separated: ${CONFIRM_STEPS.join(', ')}, or none`,
          default: getenv('CONFIRM', 'send'),
        })
        .option('notification-sound', {
          type: 'boolean',
          description: 'Play a sound when attention is needed; disable sound while keeping visual alerts',
          default: getenv('NOTIFY_SOUND', true),
        })
        .option('on-missing-answers', {
          type: 'string',
          choices: ['wait', 'skip'],
          description: 'Questions without a saved answer: wait for the user to answer them, or skip the vacancy',
          default: getenv('ON_MISSING_ANSWERS', 'wait'),
        })
        .option('auto-send-exact-answers', {
          type: 'boolean',
          description: 'Send a form with questions without asking when every question is a saved question word for word ' +
            'and autofill answered it with the saved answer; other forms are autofilled and wait for you',
          default: getenv('AUTO_SEND_EXACT_ANSWERS', true),
        })
        .option('answer-final-period', {
          type: 'string', choices: ['with', 'without'],
          description: 'When both answer variants exist, resolve a final-period conflict with or without the period; first saves keep their wording',
          default: getenv('ANSWER_FINAL_PERIOD', 'with'),
        })
        .option('auto-answer-viewed-vacancy', {
          type: 'boolean',
          description: 'Answer the viewed-but-not-applied vacancy survey with "Maybe I\'ll apply later"',
          default: getenv('AUTO_ANSWER_VIEWED_VACANCY', true),
        })
        .option('network-idle-ms', {
          type: 'number',
          description: 'How long the page has no requests before it counts as ready for the next step (browser-commander waits 30000 by default)',
          default: getenv('NETWORK_IDLE_MS', 2000),
        })
        .option('answer-instant-chats', {
          type: 'boolean',
          description: 'Answer the chat hh.ru opens after an application (a recruiter bot\'s questions) before the next vacancy: ' +
            'perfect matches of saved answers are sent (with --auto-send-exact-answers), others wait for you in the panel',
          default: getenv('ANSWER_INSTANT_CHATS', true),
        })
        .option('auto-reuse-answers', {
          type: 'boolean',
          description: 'When a recruiter bot offers the answers given to it before («Используем эти ответы?»), choose «Да» ' +
            'when each is your saved answer and «Нет» when one differs; by default they are compared and you choose',
          default: getenv('AUTO_REUSE_ANSWERS', false),
        })
        .option('single-tab', {
          type: 'boolean',
          description: 'Keep the automation browser to one tab: other tabs are closed when the run attaches, new ones as they open',
          default: getenv('SINGLE_TAB', true),
        })
        .option('captcha-prefill', {
          type: 'boolean',
          description: 'Prefill the captcha with the guesses of local Claude Code (Haiku) and Codex (latest Luna) ' +
            'for you to check and send',
          default: getenv('CAPTCHA_PREFILL', true),
        })
        .option('vacancy-insights', {
          type: 'boolean', description: 'Visit vacancy pages before applying; collect private descriptions, compare the résumé and add verified technology aliases',
          default: getenv('VACANCY_INSIGHTS', true),
        })
        .option('collect-vacancies', {
          type: 'boolean', description: 'Cache full vacancy descriptions locally in Links Notation (never committed)',
          default: getenv('COLLECT_VACANCIES', true),
        })
        .option('compare-resume', {
          type: 'boolean', description: 'Print a separate technology coverage comparison with the résumé before each application',
          default: getenv('COMPARE_RESUME', true),
        })
        .option('update-resume-aliases', {
          type: 'boolean', description: 'Add verified alternate spellings of existing résumé technologies to the résumé; never infer new experience',
          default: getenv('UPDATE_RESUME_ALIASES', true),
        })
        .option('vacancy-cache-dir', {
          type: 'string', description: 'Private local vacancy cache directory',
          default: getenv('VACANCY_CACHE_DIR', path.join(process.cwd(), 'data/vacancies')),
        })
        .option('captcha-auto-send', {
          type: 'boolean',
          description: 'With --captcha-prefill: send Haiku\'s reading of a captcha once; if hh.ru does not accept it, ' +
            'the captcha is only prefilled and waits for you',
          default: getenv('CAPTCHA_AUTO_SEND', true),
        })
        .option('skip-question', {
          type: 'string',
          array: true,
          description: 'Skip vacancies that ask this question (or a part of it) for now; repeat for several. ' +
            'They are kept in data/deferred-questions.lino',
          default: getenv('SKIP_QUESTIONS', ''),
        })
        .option('max-applications', {
          type: 'number',
          description: 'Stop after sending this many applications (0 = no limit)',
          default: getenv('MAX_APPLICATIONS', 0),
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
          description: 'Seconds between opened vacancies, a fixed pace (a random extra of up to a quarter is added); 0, the default: the adaptive pace of 1-7 min, as fast as hh.ru allows without captchas',
          default: getenv('JOB_APPLICATION_INTERVAL', 0),
        })
        .option('message', {
          alias: 'm',
          type: 'string',
          description: 'Cover letter to send with every application (this or --message-file is required)',
          default: getenv('MESSAGE', ''),
        })
        .option('message-file', {
          type: 'string',
          description: 'Path to a UTF-8 text file with the cover letter, e.g. data/cover-letter.txt',
          default: getenv('MESSAGE_FILE', ''),
        })
        .option('message-file-en', {
          type: 'string',
          description: 'The English cover letter, used when the vacancy\'s questions are in English (default: <message-file>.en.txt when it exists)',
          default: getenv('MESSAGE_FILE_EN', ''),
        })
        .option('verbose', {
          type: 'boolean',
          description: 'Enable verbose logging for debugging',
          default: getenv('VERBOSE', false),
        })
        .option('auto-submit-vacancy-response-form', {
          type: 'boolean',
          description: 'Send forms with questions (popup or full form) unattended even when not every answer is the saved answer of the very same question (default: false for safety)',
          default: getenv('AUTO_SUBMIT_VACANCY_RESPONSE_FORM', false),
        })
        .option('ignore-vacancies-with-questionnaire', {
          type: 'boolean',
          description: 'Skip vacancies that require additional questionnaire fields beyond the cover letter (kept in data/skipped-vacancies.lino)',
          default: getenv('IGNORE_VACANCIES_WITH_QUESTIONNAIRE', false),
        })
        .option('clear-rejections', {
          type: 'boolean',
          description: 'Open unread rejections («Отказ») in the chat browser slot (port 9340) alongside the application loop, so they leave the unread chats; nothing is typed in them (--no-clear-rejections to turn it off)',
          default: getenv('CLEAR_REJECTIONS', true),
        })
        .option('process-chats', {
          type: 'boolean',
          description: 'Also answer unread chats alongside the application loop in the chat browser slot (port 9340), always after the rejections are cleared',
          default: getenv('PROCESS_CHATS', false),
        })
        .option('chats-interval-minutes', {
          type: 'number',
          description: 'How often the rejections are cleared and, with --process-chats, unread chats answered (minutes)',
          default: getenv('CHATS_INTERVAL_MINUTES', 120),
        })
        .help(),
  });

  config.message ||= loadMessageFromFile(config.messageFile);
  const englishFile = config.messageFileEn || englishLetterFile(config.messageFile);
  config.messageEn = englishFile && fs.existsSync(path.resolve(englishFile)) ? loadMessageFromFile(englishFile) : '';
  // The cover letter is the user's choice; nothing is sent without one
  if (!config.message.trim() && !config.help) {
    throw new Error('Choose a cover letter: --message-file <file> (e.g. data/cover-letter.txt) or --message "<text>"');
  }
  // SKIP_QUESTIONS holds several questions separated by |
  config.skipQuestions = [config.skipQuestion ?? []].flat()
    .flatMap((question) => String(question).split('|'))
    .map((question) => question.trim())
    .filter(Boolean);
  config.confirmSteps = config.confirm === 'none' ? []
    : config.confirm.split(',').map((step) => step.trim()).filter(Boolean);
  if (config.testMode) {
    config.confirmSteps = [...new Set(['answers', ...config.confirmSteps, 'send'])];
    config.maxApplications ||= 1;
  }
  const unknownSteps = config.confirmSteps.filter((step) => !CONFIRM_STEPS.includes(step));
  if (unknownSteps.length > 0) {
    throw new Error(`Unknown --confirm step(s): ${unknownSteps.join(', ')}; use ${CONFIRM_STEPS.join(', ')}`);
  }

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
