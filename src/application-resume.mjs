/** Choose and verify the CV attached to this application, before any submission. */
import { isClearlyEnglish } from './cover-letter.mjs';
import { pickResume, loadApplicationResumes } from './resumes.mjs';

const TITLE = '[data-qa="resume-title"][data-hh-application-resume="true"]';
const OPTION_LIST = '[data-qa="magritte-select-option-list"]';

/** Only employer questions and vacancy text belong here, never the applicant's CV salary. */
export function applicationResumeLanguage({ questions = [], context = [] } = {}) {
  const text = [...questions, ...context].join('\n');
  if (/\bUSD[TC]?\b|\bdollars?\b|доллар|\$\s*\d|\d[\d\s.,]*\s*\$/iu.test(text)) return 'en';
  if (isClearlyEnglish(questions)) return 'en';
  if (/[а-яё]/iu.test(questions.join(' '))) return 'ru';
  if (isClearlyEnglish(context)) return 'en';
  return /[а-яё]/iu.test(context.join(' ')) ? 'ru' : null;
}

/** Runs in the page. Mark just the current chooser title, excluding titles in its options. */
export function readApplicationResumeChoices({ vacancyId } = {}) {
  // Survives handler retries and worker restarts, but not a document reload.
  const state = window.__hhApplicationResume ??= { documentId: window.crypto.randomUUID(), selections: {} };
  const applicationId = String(vacancyId ?? new URL(window.location.href).searchParams.get('vacancyId') ?? window.location.href);
  const titles = [...document.querySelectorAll('[data-qa="resume-title"]')];
  const title = titles.find((element) => !element.closest('[role="option"]'));
  title?.setAttribute('data-hh-application-resume', 'true');
  const options = [...document.querySelectorAll('[role="option"][data-qa^="magritte-select-option-"]')].map((option) => {
    const input = option.querySelector('input[type="radio"]');
    return { hash: input?.value ?? '', checked: Boolean(input?.checked),
      title: option.querySelector('[data-qa="resume-title"]')?.textContent.trim() ?? '' };
  }).filter((option) => /^[a-z0-9]+$/i.test(option.hash));
  return { title: title?.textContent.trim() ?? '', options, documentId: state.documentId,
    applicationId, selection: state.selections[applicationId] ?? null };
}

/** Cached exports identify language; an English-looking job title alone proves no CV language. */
export function chooseApplicationResume(options, resumes, language) {
  const known = new Map(resumes.map((resume) => [resume.hash, resume]));
  const candidates = options.filter((option) => known.get(option.hash)?.language === language)
    .map((option) => ({ ...known.get(option.hash), ...option }));
  return candidates.find((option) => option.checked) ?? pickResume(candidates).resume ?? null;
}

export function createApplicationResumeSelector({ readResumes = loadApplicationResumes, log = console.log } = {}) {
  const pending = new Map();
  return async ({ commander, questions = [], context = [], vacancyId }) => {
    const language = applicationResumeLanguage({ questions, context });
    if (!language) return { ready: true, language: null };
    const read = () => commander.evaluate({ fn: readApplicationResumeChoices, args: [{ vacancyId }] });
    const initial = await read();
    if (initial.selection?.ready) return initial.selection;
    const key = `${initial.documentId}:${initial.applicationId}`;
    if (pending.has(key)) return pending.get(key);
    const run = async () => {
      const resumes = await readResumes();
      // The chooser can be below the questionnaire. DOM activation avoids moving the viewport.
      const click = (selector) => commander.clickButton({ selector, activation: 'dom', scroll: 'none',
        waitForNavigation: false, waitAfterClick: 0 });
      const save = async (result) => {
        await commander.evaluate(({ documentId, applicationId, result }) => {
          const state = window.__hhApplicationResume;
          if (state?.documentId === documentId) state.selections[applicationId] = result;
        }, { documentId: initial.documentId, applicationId: initial.applicationId, result });
        return result;
      };
      const selectedResume = (choices) => {
        const checked = choices.options.find((option) => option.checked);
        if (checked) return resumes.find((resume) => resume.hash === checked.hash);
        const matches = resumes.filter((resume) => resume.title?.trim() === choices.title);
        return matches.length === 1 ? matches[0] : null;
      };
      let choices = initial;
      const current = selectedResume(choices);
      if (current?.language === language) {
        if (choices.options.length) await click(TITLE);
        return save({ ready: true, language, hash: current.hash });
      }
      // A manual correction can recover a failed check without reopening the chooser.
      if (initial.selection) return initial.selection;
      if (!choices.title) {
        log(`📄 Cannot verify the ${language.toUpperCase()} CV: the application has no résumé chooser. Please select it manually; nothing was sent.`);
        return { ready: false, language };
      }
      try {
        if (!choices.options.length) {
          await click(TITLE);
          await commander.waitForSelector({ selector: OPTION_LIST, timeout: 10000 });
          choices = await read();
        }
        const desired = chooseApplicationResume(choices.options, resumes, language);
        if (!desired) {
          await click(TITLE);
          log(`📄 No verified ${language.toUpperCase()} CV is available in this application. Export both CVs with bun run cv -- export; nothing was sent.`);
          return save({ ready: false, language });
        }
        if (!desired.checked) await click(`[data-qa="magritte-select-option-${desired.hash}"]`);
        choices = await read();
        const selected = selectedResume(choices);
        // Verify the resulting title or an existing checked option; never reopen to check.
        if (choices.options.length) await click(TITLE);
        if (selected?.hash !== desired.hash) {
          log(`📄 ${language.toUpperCase()} CV selection did not take effect; nothing was sent.`);
          return save({ ready: false, language });
        }
        log(`📄 Application CV: ${language.toUpperCase()} · ${desired.title} (${desired.hash})`);
        return save({ ready: true, language, hash: desired.hash });
      } catch (error) {
        await save({ ready: false, language });
        throw error;
      }
    };
    const operation = run();
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  };
}
