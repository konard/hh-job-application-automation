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
import { spawn } from 'child_process';
import { isNavigationError, isTimeoutError, makeBrowserCommander } from 'browser-commander';
import { createQADatabase } from './qa-database.mjs';
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
import { createVacancyFilters } from './vacancy-filters.mjs';
import { createSkippedVacancies } from './skipped-vacancies.mjs';
import { expandContacts, loadContacts, withContacts } from './contacts.mjs';

const qaDatabase = createQADatabase(path.join(process.cwd(), 'data', 'qa.lino'));

let session = null;
let commander = null;
let chatProcess = null;
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
    if (chatProcess) {
      chatProcess.kill('SIGTERM');
      chatProcess = null;
    }
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
  // Answers and the cover letter use {{telegram}}-style placeholders for data/contacts.lino
  const contacts = await loadContacts(path.join(process.cwd(), 'data', 'contacts.lino'));
  const { readQADatabase, addOrUpdateQA } = withContacts(qaDatabase, contacts);
  argv.message = expandContacts(argv.message, contacts);
  const deferredVacancyIds = await deferredQuestions.pendingVacancyIds(await readQADatabase());
  deferredVacancyIds.forEach(markVacancyAsProcessed);
  if (deferredVacancyIds.size > 0) {
    console.log(`Loaded ${deferredVacancyIds.size} vacancy ID(s) that wait for answers in data/deferred-questions.lino`);
  }

  // Vacancies that are not programming jobs, or cannot be applied to, are not opened
  const vacancyFilters = createVacancyFilters({
    rulesPath: path.join(process.cwd(), 'data', 'vacancy-filters.lino'),
    filteredPath: path.join(process.cwd(), 'data', 'filtered-vacancies.lino'),
  });
  const filteredVacancyIds = await vacancyFilters.filteredVacancyIds();
  filteredVacancyIds.forEach(markVacancyAsProcessed);
  if (filteredVacancyIds.size > 0) {
    console.log(`Loaded ${filteredVacancyIds.size} vacancy ID(s) filtered out before (data/filtered-vacancies.lino)`);
  }

  // Every other skip is kept with its reason; final ones (and transient ones skipped twice) are not opened
  const skippedVacancies = createSkippedVacancies(path.join(process.cwd(), 'data', 'skipped-vacancies.lino'));
  const migrated = await skippedVacancies.importIgnoredVacancyIds(path.join(process.cwd(), 'data', 'ignored-vacancy-ids.txt'));
  if (migrated > 0) {
    console.log(`Moved ${migrated} questionnaire vacancy ID(s) from data/ignored-vacancy-ids.txt to data/skipped-vacancies.lino`);
  }
  const skippedVacancyIds = await skippedVacancies.skippedVacancyIds({
    ignoreQuestionnaires: argv.ignoreVacanciesWithQuestionnaire,
  });
  skippedVacancyIds.forEach(markVacancyAsProcessed);
  const externalSite = [...(await skippedVacancies.read()).values()].filter(({ reason }) => reason === 'external_site');
  if (skippedVacancyIds.size > 0) {
    console.log(`Loaded ${skippedVacancyIds.size} vacancy ID(s) skipped before (data/skipped-vacancies.lino; ` +
      `${externalSite.length} to apply on the employer's site, see bun run skipped)`);
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
    // Nothing touches the page while hh.ru shows a captcha, except its answer: Haiku's reading is sent
    // once (--captcha-auto-send), after that it is only prefilled and the user sends it
    commander: withConfirmations(withCaptchaGuard(commander, {
      onCaptcha: argv.captchaPrefill
        ? createCaptchaPrefill({ page: session.page, sendOnce: argv.captchaAutoSend })
        : undefined,
    })),
    page: session.page,
    argv,
    qaDB: { readQADatabase, addOrUpdateQA },
    deferredQuestions,
    vacancyFilters,
    skippedVacancies,
    onPageClosed: () => shutdown('Tab close detected'),
    onApplicationSent: () => ++applicationsSent === argv.maxApplications &&
      shutdown(`Sent ${applicationsSent} application(s), the --max-applications limit`),
  });

  if (argv.processChats) {
    const intervalSeconds = argv.chatsIntervalMinutes * 60;
    const chatScriptPath = new URL('./answer-chats.mjs', import.meta.url).pathname;
    chatProcess = spawn(process.execPath, [chatScriptPath, '--auto', `--poll=${intervalSeconds}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    chatProcess.stdout.on('data', (data) => process.stdout.write(data));
    chatProcess.stderr.on('data', (data) => process.stderr.write(data));
    chatProcess.on('exit', (code) => {
      chatProcess = null;
      if (code !== 0 && !shuttingDown) {
        console.log(`⚠️  Chat processor exited with code ${code}`);
      }
    });
    console.log(`💬 Chat processor started (checking unread chats every ${argv.chatsIntervalMinutes} min)`);
  }

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
