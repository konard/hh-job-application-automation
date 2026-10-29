/**
 * Main orchestrator module
 * Coordinates the main application loop and state management
 *
 * This module uses the pageTrigger pattern from browser-commander for
 * cleaner, more declarative page handling with automatic lifecycle management.
 *
 * @see https://github.com/konard/hh-job-application-automation/issues/89
 */

import {
  handleLimitError,
  findAndProcessVacancyButton,
  previewNextVacancy,
  waitForButtonsAfterNavigation,
} from './vacancies.mjs';
import { handleVacancyResponsePage, saveQAPairs } from './vacancy-response.mjs';
import { checkAndRedirectIfNeeded } from './page-handlers.mjs';
import { dismissOverlays, isResponseSubmitted } from './helpers/page-helpers.mjs';
import { registerPageTriggers, saveFormAnswers } from './page-triggers.mjs';
import { ensureLoggedIn, watchHhSessions } from './login.mjs';
import { resolveApplicationStart } from './resumes.mjs';
import { checkpoint } from './tracing.mjs';
import { URL_PATTERNS, extractVacancyId, extractVacancyIdFromResponseUrl } from './hh-selectors.mjs';
import { log } from './logging.mjs';
import { isInteractive, waitForUser } from './confirmations.mjs';
import { ADAPTIVE_PACE, adaptivePace, limitHeldUntil, nextVacancyAt } from './pacing.mjs';
import { paceLine, readEvents, recordEvent } from './stats.mjs';
import { noteSkip } from './skipped-vacancies.mjs';
import { LETTER_SELECTORS, attachLetter, sendLetterByOffer } from './letter-attach.mjs';
import { coverLetterFor } from './cover-letter.mjs';
import { deferFailedSubmission, submissionRetries } from './submission-retries.mjs';
import { createApplicationResumeSelector } from './application-resume.mjs';
import { completeApplicationDraft } from './application-drafts.mjs';

const PAGE_READY_TIMEOUT = 120000;


/**
 * Create the main automation orchestrator
 * @param {Object} options
 * @param {Object} options.commander - Browser commander instance
 * @param {Object} options.page - Raw engine page
 * @param {Object} options.argv - Parsed configuration
 * @param {Object} options.qaDB - { readQADatabase, addOrUpdateQA }
 * @param {Object} [options.deferredQuestions] - Questions answered later (deferred-questions.mjs)
 * @param {Object} [options.vacancyFilters] - Vacancies filtered out automatically (vacancy-filters.mjs)
 * @param {Object} [options.skippedVacancies] - Every other skip, kept (skipped-vacancies.mjs)
 * @param {Function} options.onPageClosed - Called when the monitored page closes, regardless of cause
 * @param {Function} [options.answerInstantChat] - Answers the chat hh.ru opens after an application (instant-chat.mjs)
 * @returns {Object} Orchestrator with start method
 */
export function createOrchestrator({
  commander, page, argv, qaDB, contacts = {}, deferredQuestions = null, vacancyFilters = null, skippedVacancies = null, vacancyInsights = null, onPageClosed,
  onApplicationSent = async () => {},
  answerInstantChat = async () => {},
}) {
  let START_URL = argv.url;
  const MESSAGE = argv.messageEn ? { ru: argv.message, en: argv.messageEn } : argv.message;
  const selectApplicationResume = argv.autoSelectResumeLanguage !== false ? createApplicationResumeSelector() : null;
  // A fixed pace when --job-application-interval is given, else the adaptive one (pacing.mjs)
  const FIXED_INTERVAL_MS = argv.jobApplicationInterval > 0 ? argv.jobApplicationInterval * 1000 : null;
  const intervalNow = () => FIXED_INTERVAL_MS ?? adaptivePace(readEvents()).intervalMs;
  if (FIXED_INTERVAL_MS === null) {
    if (!readEvents().some((event) => event.type === 'pacing_reset')) {
      recordEvent('pacing_reset', { intervalMs: ADAPTIVE_PACE.startMs });
    }
    console.log(paceLine(readEvents()));
  }

  let pageClosedByUser = false;
  let isOnVacancyPageFromResponse = false;
  // The last search page (may include pagination) to return to after an application
  let lastSearchPageUrl = START_URL;

  const getPageClosedByUser = () => pageClosedByUser;
  const waitForPageReady = (reason) => commander.waitForPageReady({ timeout: PAGE_READY_TIMEOUT, reason });

  /**
   * Wait until the URL starts with targetUrl. Returns 'redirect_needed' early when an
   * application was sent from a vacancy page opened from vacancy_response.
   */
  const waitForUrlCondition = (targetUrl, description) => commander.waitForUrlCondition({
    targetUrl,
    description,
    pageClosedCallback: getPageClosedByUser,
    customCheck: async (currentUrl) => {
      if (!isOnVacancyPageFromResponse || !URL_PATTERNS.vacancyPage.test(currentUrl)) {
        return null;
      }
      // The sessionStorage click flag is left for checkAndRedirectIfNeeded in the main loop
      if (await isResponseSubmitted(commander)) {
        console.log('Detected application submission via "Вы откликнулись" text on page!');
        return 'redirect_needed';
      }
      return null;
    },
  });

  // Applications already counted, since one can be detected by several handlers
  const sentVacancyIds = new Set();
  // The next application waits until then, so the load on hh.ru stays low; after hh.ru's daily
  // limit (of this run or one before) until the cooldown is over
  const dailyLimitUntil = limitHeldUntil(readEvents());
  // A controlled diagnostic reload must not shorten a pause already scheduled by the worker.
  const handedOffAt = Number(process.env.HH_NEXT_APPLICATION_AT_HANDOFF);
  delete process.env.HH_NEXT_APPLICATION_AT_HANDOFF;
  let nextApplicationAt = Math.max(dailyLimitUntil, Number.isFinite(handedOffAt) ? handedOffAt : 0);
  if (dailyLimitUntil > 0) {
    console.log(`💤 hh.ru's daily limit was reached: no vacancy is opened until ${new Date(dailyLimitUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
  } else if (nextApplicationAt > Date.now()) {
    console.log(`♻️  Preserved the application pause during code reload until ${new Date(nextApplicationAt).toISOString()}`);
  }
  // When work on the vacancy began (the first vacancy looked at once the pause was over): the
  // pause counts from then, so a long form does not add a whole pause on top
  let workStartedAt = null;
  let lastWorkStartedAt = null;
  // The chat of the application just sent, answered before anything else happens on the page
  let followUp = null;
  let plannedVacancy = null;

  /**
   * Schedule the next vacancy (see pacing.mjs), so the load on hh.ru stays low
   * @param {string} reason - What was just done, for the log
   * @returns {number} The pace used (ms)
   */
  function scheduleNextApplication(reason) {
    // A vacancy opened, then its application sent: one piece of work
    lastWorkStartedAt = workStartedAt ?? lastWorkStartedAt ?? Date.now();
    workStartedAt = null;
    const intervalMs = intervalNow();
    nextApplicationAt = Math.max(nextApplicationAt, nextVacancyAt({ startedAt: lastWorkStartedAt, intervalMs }));
    const took = Math.round((Date.now() - lastWorkStartedAt) / 1000);
    console.log(`⏳ ${reason} (${took} s of work); next vacancy in ${Math.round((nextApplicationAt - Date.now()) / 1000)} seconds (pace ${Math.round(intervalMs / 1000)} s${FIXED_INTERVAL_MS ? ', fixed' : ''})`);
    return intervalMs;
  }

  /**
   * Count a sent application once, checkpoint the trace and schedule the next vacancy
   * @param {string|null} vacancyId
   * @returns {Promise<boolean>} False when the application was already counted
   */
  async function afterApplicationSent(vacancyId = null) {
    if (vacancyId) {
      if (sentVacancyIds.has(vacancyId)) {
        return false;
      }
      sentVacancyIds.add(vacancyId);
      submissionRetries.forget(vacancyId);
      await completeApplicationDraft(vacancyId);
      await vacancyInsights?.applied(vacancyId).catch((error) => console.log(`⚠️  Could not update private vacancy cache: ${error.message}`));
      // It no longer waits for an answer, and is no longer a skipped vacancy
      await deferredQuestions?.forget(vacancyId)
        .catch((error) => console.error('Error updating deferred-questions.lino:', error.message));
      await skippedVacancies?.forget(vacancyId)
        .catch((error) => console.error('Error updating skipped-vacancies.lino:', error.message));
    }
    await attachLetterOnVacancyPage(vacancyId);
    await checkpoint('application-sent');
    const intervalMs = scheduleNextApplication('Application sent');
    recordEvent('application_sent', { vacancyId, ms: Date.now() - lastWorkStartedAt, intervalMs });
    // The questions in its chat (a recruiter bot asks at once) come before the next vacancy
    followUp = answerInstantChat(vacancyId)
      .catch((error) => console.log(`⚠️  Answering the chat after the application failed: ${error.message}`));
    await followUp;
    followUp = null;
    await onApplicationSent();
    return true;
  }

  /**
   * The vacancy page after a sent form offers to attach the letter when it went without it
   * («Приложить сопроводительное письмо»): it is attached there before going back to the list
   */
  async function attachLetterOnVacancyPage(vacancyId) {
    if (!vacancyId || extractVacancyId(commander.getUrl()) !== vacancyId ||
      await commander.count({ selector: LETTER_SELECTORS.pageButton }).catch(() => 0) === 0) {
      return;
    }
    console.log(`⚠️  The application to vacancy ${vacancyId} went without the cover letter: attaching it`);
    const result = await sendLetterByOffer(commander, LETTER_SELECTORS.pageButton, coverLetterFor(MESSAGE, []))
      .catch((error) => ({ attached: false, reason: error.message.split('\n')[0] }));
    if (result.attached) {
      console.log('✉️  Cover letter attached to the application (the vacancy page)');
      recordEvent('letter_attached', { vacancyId, via: 'the vacancy page' });
    } else {
      console.log(`❌ The cover letter could not be attached to vacancy ${vacancyId} (${result.reason}): attach it by hand`);
      await noteSkip(skippedVacancies, vacancyId, { reason: 'letter_not_attached', url: `https://hh.ru/vacancy/${vacancyId}` });
    }
  }

  /**
   * Letters that could not be attached on an earlier run: tried again on the vacancy page, a few a run
   */
  async function attachPendingLetters() {
    const ids = (await skippedVacancies?.lettersToAttach?.().catch(() => [])) ?? [];
    for (const vacancyId of ids.slice(0, 3)) {
      console.log(`✉️  Vacancy ${vacancyId} was sent without the cover letter: attaching it on the vacancy page`);
      const result = await attachLetter({ commander, vacancyId, letter: coverLetterFor(MESSAGE, []), returnUrl: START_URL });
      if (result.attached) {
        console.log(`✉️  Cover letter attached to vacancy ${vacancyId} (${result.via})`);
        recordEvent('letter_attached', { vacancyId, via: result.via });
        await skippedVacancies.clear(vacancyId);
      } else if (result.noOffer) {
        console.log(`✉️  Vacancy ${vacancyId} no longer offers to attach a letter (attached already)`);
        await skippedVacancies.clear(vacancyId);
      } else {
        console.log(`❌ The cover letter still could not be attached to vacancy ${vacancyId} (${result.reason}): attach it by hand at https://hh.ru/vacancy/${vacancyId}`);
      }
    }
  }

  // Set when an application was not confirmed in an unattended run: the main loop stops on it
  let stopError = null;

  /**
   * An application hh.ru did not confirm as sent (popup or full form): never move on to the
   * next vacancy while hh.ru shows something unexpected. Unattended, the run stops (the main
   * loop throws stopError); otherwise it waits for the user
   * @param {string|null} vacancyId
   */
  async function applicationNotConfirmed(vacancyId, reason = 'not_confirmed') {
    // The vacancy page watch saw «Вы откликнулись» first and went back to the list
    if (vacancyId && sentVacancyIds.has(vacancyId)) {
      return;
    }
    const detail = {
      cover_letter_unavailable: 'The cover letter field did not open after retries; the application was not sent',
      cover_letter_unverified: 'The cover letter is missing or incomplete; the application was not sent',
      submit_not_clicked: 'The submit button could not be clicked after retries; the application was not sent',
    }[reason] ?? 'hh.ru did not confirm the application';
    const message = `${detail} for vacancy ${vacancyId}. Check the browser (an error, a captcha, a message)`;
    if (!isInteractive()) {
      console.error(`❌ ${message}; stopping so that nothing else is sent`);
      stopError ??= new Error(`${message}; stopping so that nothing else is sent`);
      return;
    }
    await waitForUser(`${message}, then`);
  }

  /**
   * Wait until the next application may be sent
   */
  async function waitForApplicationSlot() {
    // Preview during the pause, before reading the vacancy or opening an application.
    // A five-hour retry which will be due takes priority over a new search card.
    if (!submissionRetries.ids().some((id) => submissionRetries.get(id).until <= nextApplicationAt)) {
      plannedVacancy = await previewNextVacancy({ commander });
    }
    const ms = nextApplicationAt - Date.now();
    if (ms > 0) {
      await commander.wait({ ms, reason: 'interval before next application' });
    }
  }

  // The full form's handler: run by the page trigger, or directly when the trigger did not start it
  let responseHandling = null;
  let handledResponseUrl = null;
  let retryingVacancyId = null;
  const vacancyResponseHandler = () => {
    // A trigger that starts late finds the form already being filled: one handler per form
    if (responseHandling && handledResponseUrl === commander.getUrl()) {
      return responseHandling;
    }
    handledResponseUrl = commander.getUrl();
    const retryId = retryingVacancyId;
    responseHandling = runVacancyResponseHandler().finally(() => {
      responseHandling = null;
      if (retryingVacancyId === retryId) retryingVacancyId = null;
    });
    return responseHandling;
  };
  const runVacancyResponseHandler = () => handleVacancyResponsePage({
    commander,
    MESSAGE,
    selectApplicationResume,
    readQADatabase: qaDB.readQADatabase,
    addOrUpdateQA: qaDB.addOrUpdateQA,
    contacts,
    // A form with a non-exact answer is sent after the user's `y` (decideSend); unattended only with this flag
    autoSubmitEnabled: argv.autoSubmitVacancyResponseForm,
    onMissingAnswers: argv.onMissingAnswers,
    ignoreVacanciesWithQuestionnaire: argv.ignoreVacanciesWithQuestionnaire,
    returnUrl: lastSearchPageUrl,
    onApplicationSent: afterApplicationSent,
    onApplicationNotConfirmed: applicationNotConfirmed,
    deferredQuestions,
    autoSendExact: argv.autoSendExactAnswers,
    vacancyFilters,
    skippedVacancies,
    retrySubmission: retryingVacancyId !== null && extractVacancyIdFromResponseUrl(commander.getUrl()) === retryingVacancyId,
    verbose: argv.verbose,
  });

  const deferVisibleSubmissionError = () => deferFailedSubmission({ commander, returnUrl: lastSearchPageUrl,
    saveAnswers: () => saveQAPairs({ commander, addOrUpdateQA: qaDB.addOrUpdateQA, strict: true }) });

  /**
   * Handle one result of findAndProcessVacancyButton
   * @returns {Promise<boolean>} False when the loop should stop
   */
  async function handleResult(result) {
    switch (result.status) {
    case 'navigation_detected':
      console.log('Navigation detected during processing, restarting with new page context...');
      return true;
    case 'not_on_target_page':
      log.debug(() => 'Not on the vacancy list, waiting for the page to be ready...');
      await waitForPageReady('not on target page');
      return true;
    case 'no_buttons_found': {
      // Waiting for a list is no work on a vacancy
      workStartedAt = null;
      const waitResult = await waitForButtonsAfterNavigation({ commander, pageClosedByUser: getPageClosedByUser });
      if (waitResult.status === 'navigation_detected') {
        console.log('Navigation detected, waiting for new page to be fully loaded...');
        await waitForPageReady('after navigation in button wait');
      }
      return waitResult.status !== 'page_closed';
    }
    case 'limit_error':
    case 'limit_error_after_submit':
      await handleLimitError({ commander, START_URL });
      return true;
    case 'direct_application_skipped':
      await commander.wait({ ms: 1000, reason: 'brief pause after skipping direct application' });
      return true;
    case 'success':
      await afterApplicationSent(result.vacancyId);
      return true;
    case 'modal_processing_failed':
      if (['not_confirmed', 'cover_letter_unavailable', 'cover_letter_unverified', 'submit_not_clicked', 'button_not_found', 'button_disabled'].includes(result.reason)) {
        await applicationNotConfirmed(result.vacancyId, result.reason);
      }
      return true;
    default:
      return true;
    }
  }

  /** Statuses after which no vacancy was opened, so no pause is needed */
  const NO_VACANCY_OPENED = new Set(['not_on_target_page', 'no_buttons_found', 'filtered_out']);
  // A vacancy filtered out after its description was requested cost a request, so it is paced too
  const openedVacancy = (result) => result.descriptionRead || !NO_VACANCY_OPENED.has(result.status);

  return {
    /**
     * Start the main automation loop
     */
    async start() {
      page.on('close', () => {
        pageClosedByUser = true;
        onPageClosed();
      });

      await ensureLoggedIn({ commander, page, argv, isPageClosed: getPageClosedByUser });
      if (pageClosedByUser) {
        return;
      }
      await checkpoint('logged-in');
      // A login made later in any hh.ru window (this one, chat, forms) reaches the others
      watchHhSessions({ port: argv.browserPort });

      // Capture an existing failed form before resume selection navigates away from it.
      // Resolving a full form's return search only fetches the CV list; it never leaves the form.
      const initialUrl = commander.getUrl();
      const preparedStart = URL_PATTERNS.vacancyResponse.test(initialUrl) ? await resolveApplicationStart(commander, START_URL) : null;
      if (preparedStart) lastSearchPageUrl = preparedStart.startUrl;
      const failedApplicationOpen = await deferVisibleSubmissionError();

      const start = preparedStart ?? (failedApplicationOpen && !URL_PATTERNS.vacancyResponse.test(commander.getUrl())
        ? { startUrl: START_URL || (URL_PATTERNS.searchVacancy.test(commander.getUrl())
          ? commander.getUrl() : 'https://hh.ru/search/vacancy?from=resumelist'), preserveCurrentForm: true }
        : await resolveApplicationStart(commander, failedApplicationOpen ? undefined : START_URL));
      if (failedApplicationOpen) start.preserveCurrentForm = commander.getUrl() === initialUrl;
      START_URL = start.startUrl;
      if (!START_URL) {
        throw new Error('No resume found on hh.ru - create one or pass --url');
      }
      lastSearchPageUrl = START_URL;
      if (start.preserveCurrentForm) {
        console.log('📄 Resuming the open application; entered answers are preserved.');
      } else if (commander.getUrl() !== START_URL) {
        await commander.goto({ url: START_URL, waitForStableUrlBefore: false });
      }
      await dismissOverlays(commander);

      // Declarative page handling (vacancy_response, vacancy and search pages)
      const cleanupTriggers = registerPageTriggers({
        commander,
        addOrUpdateQA: qaDB.addOrUpdateQA,
        handleVacancyResponsePage: vacancyResponseHandler,
        onVacancyPageFromResponse: (vacancyId) => {
          console.log(`Setting flag isOnVacancyPageFromResponse = true (vacancy ID: ${vacancyId})`);
          isOnVacancyPageFromResponse = true;
        },
        onApplicationSubmitted: (vacancyId) => {
          isOnVacancyPageFromResponse = false;
          return afterApplicationSent(vacancyId);
        },
        onSearchPageVisited: (url) => {
          lastSearchPageUrl = url;
        },
        getReturnUrl: () => lastSearchPageUrl,
      });
      process.on('exit', cleanupTriggers);

      // A native send can fail while the handler is still waiting for confirmation on stdin.
      const submissionErrors = setInterval(() => {
        deferVisibleSubmissionError().catch((error) => console.log(`⚠️  Could not defer failed application: ${error.message}`));
      }, 1000);
      submissionErrors.unref();
      process.once('exit', () => clearInterval(submissionErrors));

      if (!start.preserveCurrentForm) await attachPendingLetters();
      await this.runMainLoop();
    },

    /**
     * Run the main automation loop
     */
    async runMainLoop() {
      while (!pageClosedByUser) {
        if (stopError) {
          throw stopError;
        }
        if (followUp) {
          await followUp;
          continue;
        }
        // Ensure page is fully loaded
        if (commander.navigationManager?.isNavigating() || commander.shouldAbort()) {
          log.debug(() => 'Page is loading, waiting for it to be fully ready...');
          await waitForPageReady('ensuring page is ready before automation');
          log.debug(() => `Page ready: ${commander.getUrl()}`);
          continue;
        }

        // Generic errors are saved and skipped in RAM. Other errors keep their form open.
        if (await deferVisibleSubmissionError()) {
          await commander.wait({ ms: 1000, reason: 'submission error handling' });
          continue;
        }

        // Safety net: redirect back after an application sent from a vacancy page
        if (await checkAndRedirectIfNeeded({
          commander, isOnVacancyPageFromResponse, returnUrl: lastSearchPageUrl, onApplicationSent: afterApplicationSent,
          onUnavailable: (vacancyId) => noteSkip(skippedVacancies, vacancyId, { reason: 'vacancy_unavailable', url: commander.getUrl() }),
        })) {
          isOnVacancyPageFromResponse = false;
          await waitForPageReady('after redirect');
          continue;
        }

        if (Date.now() < nextApplicationAt) {
          await waitForApplicationSlot();
          continue;
        }

        workStartedAt ??= Date.now();
        await commander.wait({ ms: 500, reason: 'settle before processing vacancy buttons' });
        await dismissOverlays(commander);
        if (commander.shouldAbort()) {
          continue;
        }

        const retry = URL_PATTERNS.searchVacancy.test(commander.getUrl()) ? submissionRetries.takeDue() : null;
        let result;
        if (retry) {
          console.log(`🔁 Retrying vacancy ${retry.vacancyId}: its five-hour submission cooldown has expired`);
          if (vacancyInsights?.enabled && !await vacancyInsights.visit({ commander, vacancyId: retry.vacancyId, returnUrl: lastSearchPageUrl })) {
            submissionRetries.defer(retry.vacancyId, retry);
            continue;
          }
          // Force the same handler/fallback path as a newly opened full application form.
          handledResponseUrl = null;
          retryingVacancyId = retry.vacancyId;
          try {
            await commander.goto({ url: retry.url, waitForStableUrlBefore: false });
          } catch (error) {
            retryingVacancyId = null;
            submissionRetries.defer(retry.vacancyId, retry);
            console.log(`⚠️  Retry navigation failed for vacancy ${retry.vacancyId}; deferred for another five hours: ${error.message}`);
            continue;
          }
          result = { status: 'vacancy_response_detected', vacancyId: retry.vacancyId };
        } else result = await findAndProcessVacancyButton({
          commander,
          targetVacancyId: plannedVacancy?.url === commander.getUrl() ? plannedVacancy.vacancyId : null,
          MESSAGE,
          selectApplicationResume,
          ignoreVacanciesWithQuestionnaire: argv.ignoreVacanciesWithQuestionnaire,
          deferredQuestions,
          readQADatabase: qaDB.readQADatabase,
          addOrUpdateQA: qaDB.addOrUpdateQA,
          autoSendExact: argv.autoSendExactAnswers,
          autoSubmit: argv.autoSubmitVacancyResponseForm,
          onMissingAnswers: argv.onMissingAnswers,
          vacancyFilters,
          skippedVacancies,
          vacancyInsights,
          verbose: argv.verbose,
          waitForUrlCondition,
          START_URL,
          pageClosedByUser: getPageClosedByUser,
        });
        plannedVacancy = null;

        if (result.status === 'vacancy_response_detected') {
          // The page trigger fills the form; a form it did not start on is filled here, never left as it is
          const formUrl = commander.getUrl();
          for (let waited = 0; waited < 8000 && handledResponseUrl !== formUrl; waited += 500) {
            await commander.wait({ ms: 500, reason: 'the full form handler to start' });
          }
          // A handler still busy with an earlier form keeps the trigger from starting on this one
          if (handledResponseUrl !== formUrl && URL_PATTERNS.vacancyResponse.test(commander.getUrl())) {
            console.log(`⚠️  The full form was not picked up by its page handler${responseHandling ? ' (it is still busy with an earlier form)' : ''}: filling it here`);
            // What the user types is saved as the page trigger would
            const stopSaving = saveFormAnswers({ commander, addOrUpdateQA: qaDB.addOrUpdateQA });
            await vacancyResponseHandler().catch((error) => console.error('Error in vacancy response handler:', error.message));
            await stopSaving();
            // Sent in the browser: hh.ru opened its vacancy page, which the safety net checks and leaves
            const formVacancyId = extractVacancyIdFromResponseUrl(formUrl);
            if (formVacancyId && extractVacancyId(commander.getUrl()) === formVacancyId) {
              isOnVacancyPageFromResponse = true;
            }
          }
        }
        if (openedVacancy(result) && result.status !== 'success') {
          scheduleNextApplication(`Vacancy ${result.vacancyId ?? ''} opened (${result.status}${result.reason ? `: ${result.reason}` : ''})`);
        }
        if (!await handleResult(result)) {
          return;
        }
      }
    },
  };
}
