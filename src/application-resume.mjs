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
export function readApplicationResumeChoices() {
  const titles = [...document.querySelectorAll('[data-qa="resume-title"]')];
  const title = titles.find((element) => !element.closest('[role="option"]'));
  title?.setAttribute('data-hh-application-resume', 'true');
  const options = [...document.querySelectorAll('[role="option"][data-qa^="magritte-select-option-"]')].map((option) => {
    const input = option.querySelector('input[type="radio"]');
    return { hash: input?.value ?? '', checked: Boolean(input?.checked),
      title: option.querySelector('[data-qa="resume-title"]')?.textContent.trim() ?? '' };
  }).filter((option) => /^[a-z0-9]+$/i.test(option.hash));
  return { title: title?.textContent.trim() ?? '', options };
}

/** Cached exports identify language; an English-looking job title alone proves no CV language. */
export function chooseApplicationResume(options, resumes, language) {
  const known = new Map(resumes.map((resume) => [resume.hash, resume]));
  const candidates = options.filter((option) => known.get(option.hash)?.language === language)
    .map((option) => ({ ...known.get(option.hash), ...option }));
  return candidates.find((option) => option.checked) ?? pickResume(candidates).resume ?? null;
}

export function createApplicationResumeSelector({ readResumes = loadApplicationResumes, log = console.log } = {}) {
  return async ({ commander, questions = [], context = [] }) => {
    const language = applicationResumeLanguage({ questions, context });
    if (!language) return { ready: true, language: null };
    const read = () => commander.evaluate({ fn: readApplicationResumeChoices });
    const click = (selector) => commander.clickButton({ selector, scrollIntoView: true });
    let choices = await read();
    if (!choices.title) {
      log(`📄 Cannot verify the ${language.toUpperCase()} CV: the application has no résumé chooser. Please select it manually; nothing was sent.`);
      return { ready: false, language };
    }
    await click(TITLE);
    await commander.waitForSelector({ selector: OPTION_LIST, timeout: 10000 });
    choices = await read();
    const desired = chooseApplicationResume(choices.options, await readResumes(), language);
    if (!desired) {
      await click(TITLE);
      log(`📄 No verified ${language.toUpperCase()} CV is available in this application. Export both CVs with bun run cv -- export; nothing was sent.`);
      return { ready: false, language };
    }
    if (!desired.checked) {
      await click(`[data-qa="magritte-select-option-${desired.hash}"]`);
      await read();
      await click(TITLE);
      await commander.waitForSelector({ selector: OPTION_LIST, timeout: 10000 });
    }
    const selected = (await read()).options.find((option) => option.checked);
    await click(TITLE);
    if (selected?.hash !== desired.hash) {
      log(`📄 ${language.toUpperCase()} CV selection did not take effect; nothing was sent.`);
      return { ready: false, language };
    }
    log(`📄 Application CV: ${language.toUpperCase()} · ${desired.title} (${desired.hash})`);
    return { ready: true, language, hash: desired.hash };
  };
}
