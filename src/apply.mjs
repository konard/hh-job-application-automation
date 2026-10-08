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
import {
  isNavigationError,
  isTimeoutError,
  launchBrowser,
  makeBrowserCommander,
} from 'browser-commander';
import { createQADatabase } from './qa-database.mjs';
import { createIgnoredVacanciesDatabase } from './ignored-vacancies-db.mjs';
import { enableDebugLevel } from './logging.mjs';
import { createConfig, getUserDataDir } from './config.mjs';
import { createOrchestrator } from './orchestrator.mjs';
import { markVacancyAsProcessed } from './vacancies.mjs';

const { readQADatabase, addOrUpdateQA } = createQADatabase(path.join(process.cwd(), 'data', 'qa.lino'));
const { readIgnoredVacancyIds, addIgnoredVacancyId } = createIgnoredVacanciesDatabase(
  path.join(process.cwd(), 'data', 'ignored-vacancy-ids.txt'),
);

let browser = null;
let commander = null;

/**
 * Release browser-commander resources, close the browser and exit
 */
async function shutdown(reason) {
  console.log(`\n${reason}, closing browser gracefully...`);
  try {
    await commander?.destroy();
    await browser?.close();
    console.log('Browser closed successfully');
  } catch (error) {
    console.error('Error closing browser:', error.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('Received SIGINT'));
process.on('SIGTERM', () => shutdown('Received SIGTERM'));

(async () => {
  const argv = createConfig();
  argv.userDataDir ||= getUserDataDir(argv.engine);

  if (argv.verbose) {
    enableDebugLevel();
  }

  if (argv.ignoreVacanciesWithQuestionnaire) {
    const ignoredVacancyIds = await readIgnoredVacancyIds();
    ignoredVacancyIds.forEach(markVacancyAsProcessed);
    if (ignoredVacancyIds.size > 0) {
      console.log(`Loaded ${ignoredVacancyIds.size} ignored questionnaire vacancy ID(s) from disk`);
    }
  }

  // Launch the installed Chrome the way a person would (no automation switches)
  const launched = await launchBrowser({
    engine: argv.engine,
    userDataDir: argv.userDataDir,
    headless: false,
    verbose: argv.verbose,
    restrictions: ['no-crash-restore', 'no-translate'],
  });
  browser = launched.browser;

  commander = makeBrowserCommander({ page: launched.page, verbose: argv.verbose });
  console.log(`Using ${commander.engine} automation engine`);

  const orchestrator = createOrchestrator({
    commander,
    page: launched.page,
    argv,
    qaDB: { readQADatabase, addOrUpdateQA, addIgnoredVacancyId },
    onPageClosed: () => shutdown('Tab close detected'),
  });

  await orchestrator.start();
})().catch((error) => {
  if (isNavigationError(error)) {
    console.log('Navigation-related error occurred, the automation was interrupted by page navigation.');
    console.log('Please restart the script if needed.');
    process.exit(0);
  }

  if (isTimeoutError(error)) {
    console.log(`⚠️  Timeout error occurred while waiting for page elements: ${error.message}`);
    process.exit(0);
  }

  console.error('Error occurred:', error.message);
  process.exit(1);
});
