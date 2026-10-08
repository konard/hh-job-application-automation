#!/usr/bin/env bun

/**
 * Universal job application automation for hh.ru
 * Works with both Playwright and Puppeteer through browser-commander
 *
 * This is the main entry point that:
 * 1. Parses CLI arguments
 * 2. Starts (or reuses) the automation browser and starts tracing
 * 3. Creates and starts the orchestrator (login, resume selection, applications)
 */

import path from 'path';
import { isNavigationError, isTimeoutError, makeBrowserCommander } from 'browser-commander';
import { createQADatabase } from './qa-database.mjs';
import { createIgnoredVacanciesDatabase } from './ignored-vacancies-db.mjs';
import { enableDebugLevel } from './logging.mjs';
import { createConfig, getUserDataDir } from './config.mjs';
import { createOrchestrator } from './orchestrator.mjs';
import { markVacancyAsProcessed } from './vacancies.mjs';
import { connectOrLaunchBrowser } from './browser-session.mjs';
import { startTracing, stopTracing } from './tracing.mjs';
import { enableTestMode, withConfirmations } from './test-mode.mjs';

const { readQADatabase, addOrUpdateQA } = createQADatabase(path.join(process.cwd(), 'data', 'qa.lino'));
const { readIgnoredVacancyIds, addIgnoredVacancyId } = createIgnoredVacanciesDatabase(
  path.join(process.cwd(), 'data', 'ignored-vacancy-ids.txt'),
);

let session = null;
let commander = null;
let shuttingDown = false;

/**
 * Finish the trace, release browser-commander resources and the browser, then exit
 */
async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`\n${reason}, shutting down...`);
  try {
    await stopTracing();
    await commander?.destroy();
    await session?.release();
  } catch (error) {
    console.error('Error during shutdown:', error.message);
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('Received SIGINT'));
process.on('SIGTERM', () => shutdown('Received SIGTERM'));

(async () => {
  const argv = createConfig();
  argv.userDataDir ||= getUserDataDir();

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

  session = await connectOrLaunchBrowser({
    engine: argv.engine,
    userDataDir: argv.userDataDir,
    port: argv.browserPort,
    keepOpen: argv.keepBrowserOpen,
    idleTimeoutMinutes: argv.browserIdleTimeout,
  });

  if (argv.testMode) {
    enableTestMode({ onStop: () => shutdown('Test mode stopped by the user') });
    console.log('🧪 Test mode: one application, every value entered into the form is confirmed first');
  }

  commander = makeBrowserCommander({ page: session.page, verbose: argv.verbose });
  console.log(`Using ${commander.engine} automation engine`);

  if (argv.trace) {
    await startTracing({ commander, page: session.page });
  }

  const orchestrator = createOrchestrator({
    commander: withConfirmations(commander),
    page: session.page,
    argv,
    qaDB: { readQADatabase, addOrUpdateQA, addIgnoredVacancyId },
    onPageClosed: () => shutdown('Tab close detected'),
    onApplicationSent: () => argv.testMode && shutdown('Test mode: the application was sent'),
  });

  await orchestrator.start();
})().catch((error) => {
  if (isNavigationError(error)) {
    return shutdown('Navigation interrupted the automation; please restart the script if needed');
  }
  if (isTimeoutError(error)) {
    return shutdown(`Timeout while waiting for page elements: ${error.message}`);
  }
  console.error('Error occurred:', error.message);
  return shutdown('Unexpected error', 1);
});
