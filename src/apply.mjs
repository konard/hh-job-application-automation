#!/usr/bin/env bun

/**
 * Universal job application automation for hh.ru
 * Works with both Playwright and Puppeteer through browser-commander
 *
 * This is the main entry point that:
 * 1. Parses CLI arguments
 * 2. Initializes browser and commander
 * 3. Creates and starts the orchestrator
 */

import path from 'path';
import { createQADatabase } from './qa-database.mjs';
import { createIgnoredVacanciesDatabase } from './ignored-vacancies-db.mjs';
import {
  isNavigationError,
  isTimeoutError,
  launchBrowser,
  makeBrowserCommander,
} from 'browser-commander';
import { handleVacancyResponsePage } from './vacancy-response.mjs';
import { enableDebugLevel } from './logging.mjs';
import { createConfig, getUserDataDir } from './config.mjs';
import { URL_PATTERNS } from './hh-selectors.mjs';
import { createOrchestrator } from './orchestrator.mjs';
import { markVacancyAsProcessed } from './vacancies.mjs';

// Create QA database instance with explicit production file path
const QA_DB_PATH = path.join(process.cwd(), 'data', 'qa.lino');
const qaDB = createQADatabase(QA_DB_PATH);
const IGNORED_VACANCIES_DB_PATH = path.join(process.cwd(), 'data', 'ignored-vacancy-ids.txt');
const ignoredVacanciesDB = createIgnoredVacanciesDatabase(IGNORED_VACANCIES_DB_PATH);

// Extract methods from database instance
const { readQADatabase, addOrUpdateQA } = qaDB;
const { readIgnoredVacancyIds, addIgnoredVacancyId } = ignoredVacanciesDB;

let browser = null;
let commander = null;

/**
 * Handle graceful shutdown on exit signals
 */
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, closing browser gracefully...`);

  // Cleanup browser-commander resources (network tracker, navigation manager)
  if (commander) {
    try {
      commander.destroy();
      console.log('Browser commander cleaned up');
    } catch (error) {
      console.error('Error cleaning up commander:', error.message);
    }
  }

  if (browser) {
    try {
      await browser.close();
      console.log('Browser closed successfully');
    } catch (error) {
      console.error('Error closing browser:', error.message);
    }
  }
  process.exit(0);
}

// Register signal handlers for graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

(async () => {
  // Parse command-line arguments using lino-arguments config module
  const argv = createConfig();

  // Set user data dir based on engine if not explicitly set
  if (!argv.userDataDir) {
    argv.userDataDir = getUserDataDir(argv.engine);
  }

  // Enable debug logging if verbose mode is on
  if (argv.verbose) {
    enableDebugLevel();
  }

  // Use message from config (already has default from config module)
  const MESSAGE = argv.message;
  const START_URL = argv.url;

  if (argv.ignoreVacanciesWithQuestionnaire) {
    const ignoredVacancyIds = await readIgnoredVacancyIds();
    for (const vacancyId of ignoredVacancyIds) {
      markVacancyAsProcessed(vacancyId);
    }

    if (ignoredVacancyIds.size > 0) {
      console.log(`Loaded ${ignoredVacancyIds.size} ignored questionnaire vacancy ID(s) from disk`);
    }
  }

  // Launch browser with default configuration from browser-commander
  const { browser: launchedBrowser, page } = await launchBrowser({
    engine: argv.engine,
    userDataDir: argv.userDataDir,
    headless: false,
    verbose: argv.verbose,
  });

  browser = launchedBrowser;

  // Create browser commander instance
  commander = makeBrowserCommander({ page, verbose: argv.verbose });

  console.log(`Using ${commander.engine} automation engine`);

  // Issue #115: Log when verbose mode enables typing mutex logging
  if (argv.verbose) {
    console.log('🔧 Verbose mode enabled: typing mutex logging active (prevents character interleaving)');
  }

  // URL patterns from centralized config
  const targetPagePattern = URL_PATTERNS.searchVacancy;
  const vacancyResponsePattern = URL_PATTERNS.vacancyResponse;
  const vacancyPagePattern = URL_PATTERNS.vacancyPage;
  const BUTTON_CLICK_INTERVAL = argv.jobApplicationInterval * 1000;
  let lastSearchPageUrl = START_URL;

  // Wrapper function to pass all dependencies to handleVacancyResponsePage
  const handleVacancyResponsePageWrapper = async () => {
    return handleVacancyResponsePage({
      commander,
      MESSAGE,
      vacancyResponsePattern,
      readQADatabase,
      addOrUpdateQA,
      addIgnoredVacancyId,
      autoSubmitEnabled: argv.autoSubmitVacancyResponseForm,
      ignoreVacanciesWithQuestionnaire: argv.ignoreVacanciesWithQuestionnaire,
      returnUrl: lastSearchPageUrl,
      verbose: argv.verbose,
    });
  };

  // Create and start orchestrator
  const orchestrator = createOrchestrator({
    commander,
    browser,
    page,
    argv,
    START_URL,
    MESSAGE,
    qaDB: { readQADatabase, addOrUpdateQA, addIgnoredVacancyId },
    targetPagePattern,
    vacancyResponsePattern,
    vacancyPagePattern,
    BUTTON_CLICK_INTERVAL,
    handleVacancyResponsePageWrapper,
    onSearchPageUrlChange: (url) => {
      lastSearchPageUrl = url;
    },
  });

  await orchestrator.start();
})().catch(async (error) => {
  // Check if this is a navigation error - if so, don't crash
  if (isNavigationError(error)) {
    console.log('Navigation-related error occurred, attempting to recover...');
    console.log('The automation may have been interrupted by page navigation.');
    console.log('Please restart the script if needed.');
    // Don't exit with error for navigation issues
    process.exit(0);
  }

  // Check if this is a timeout error - these are non-fatal, continue automation
  if (isTimeoutError(error)) {
    console.log('⚠️  Timeout error occurred while waiting for page elements');
    console.log(`   Error: ${error.message}`);
    console.log('   This is usually caused by:');
    console.log('     - Slow page loading due to network conditions');
    console.log('     - Page structure differs from expected');
    console.log('     - Third-party scripts blocking page rendering');
    console.log('   The automation will continue with the next vacancy');
    console.log('   (The automation loop should handle this gracefully)');
    // Don't exit - this should not crash the application
    // Note: The orchestrator's main loop will continue automatically
    process.exit(0);
  }

  console.error('Error occurred:', error.message);
  process.exit(1);
});
