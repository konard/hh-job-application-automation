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
import { enableConfirmations, withConfirmations } from './confirmations.mjs';
import { withCaptchaGuard } from './captcha.mjs';
import { createCaptchaPrefill } from './captcha-solver.mjs';
import { createDeferredQuestions, formatQuestions } from './deferred-questions.mjs';

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

  // Vacancies whose questions are answered later are not opened until then
  const deferredQuestions = createDeferredQuestions(path.join(process.cwd(), 'data', 'deferred-questions.lino'), {
    skipQuestions: argv.skipQuestions,
  });
  if (argv.skipQuestions.length > 0) {
    console.log(`⏭️  Skipping vacancies that ask:\n${formatQuestions(argv.skipQuestions)}`);
  }
  const deferredVacancyIds = await deferredQuestions.pendingVacancyIds(await readQADatabase());
  deferredVacancyIds.forEach(markVacancyAsProcessed);
  if (deferredVacancyIds.size > 0) {
    console.log(`Loaded ${deferredVacancyIds.size} vacancy ID(s) that wait for answers in data/deferred-questions.lino`);
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
    singleTab: argv.singleTab,
  });

  // Someone answers on stdin when steps are confirmed, so missing answers can be asked for too
  if (argv.confirmSteps.length > 0) {
    enableConfirmations({ steps: argv.confirmSteps, onStop: () => shutdown('Stopped by the user') });
    console.log(`🧪 Confirming on stdin: ${argv.confirmSteps.join(', ')}`);
  }
  if (argv.maxApplications > 0) {
    console.log(`🧪 Stopping after ${argv.maxApplications} application(s)`);
  }
  let applicationsSent = 0;

  commander = makeBrowserCommander({ page: session.page, verbose: argv.verbose });
  console.log(`Using ${commander.engine} automation engine`);

  if (argv.trace) {
    await startTracing({ commander, page: session.page });
  }

  const orchestrator = createOrchestrator({
    // Nothing touches the page while hh.ru shows a captcha, except its prefilled answer; the user sends it
    commander: withConfirmations(withCaptchaGuard(commander, {
      onCaptcha: argv.captchaPrefill ? createCaptchaPrefill({ page: session.page }) : undefined,
    })),
    page: session.page,
    argv,
    qaDB: { readQADatabase, addOrUpdateQA, addIgnoredVacancyId },
    deferredQuestions,
    onPageClosed: () => shutdown('Tab close detected'),
    onApplicationSent: () => ++applicationsSent === argv.maxApplications &&
      shutdown(`Sent ${applicationsSent} application(s), the --max-applications limit`),
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
