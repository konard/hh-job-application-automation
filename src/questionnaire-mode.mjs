/** Optional no-questions mode. Eligibility and the revisit queue live only in this process. */
import { extractPageQuestions } from './qa.mjs';
import { readApplicationDraft, saveApplicationDraft, writeApplicationDraft } from './application-drafts.mjs';
import { withdrawPrompt } from './confirmations.mjs';

export function createQuestionnaireMode({ enabled = false, log = console.log } = {}) {
  const waiting = new Map();
  const listeners = new Set();
  return {
    get enabled() { return enabled; },
    setEnabled(value) {
      if (enabled === Boolean(value)) return;
      enabled = Boolean(value);
      log(enabled
        ? '⏭️  No-questions mode enabled: questionnaires wait in RAM; saved skip lists are unchanged.'
        : `📝 Questionnaires enabled again: ${waiting.size} vacancy(s) queued for another visit.`);
      for (const listener of listeners) listener(enabled);
    },
    remember(vacancyId, details = {}) {
      const id = String(vacancyId ?? '');
      if (!/^\d+$/.test(id)) throw new Error('A questionnaire held in RAM needs a vacancy ID');
      waiting.set(id, { ...details, vacancyId: id,
        url: /^https:\/\/hh\.ru\/applicant\/vacancy_response\?/.test(details.url ?? '') ? details.url
          : `https://hh.ru/applicant/vacancy_response?vacancyId=${id}&startedWithQuestion=false` });
    },
    ids: () => [...waiting.keys()],
    takeNext() {
      if (enabled) return null;
      const entry = waiting.values().next().value ?? null;
      if (entry) waiting.delete(entry.vacancyId);
      return entry;
    },
    forget: (id) => waiting.delete(String(id)),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export const questionnaireMode = createQuestionnaireMode();

/** Interrupt only the questionnaire prompt currently waiting for the user. */
export async function questionnairePrompt(ask, mode = questionnaireMode) {
  if (mode.enabled) return 'withdrawn';
  const stop = mode.onChange((enabled) => { if (enabled) withdrawPrompt('no-questions mode enabled'); });
  try { return await ask(); } finally { stop(); }
}

/** Save first, then leave a questionnaire without writing a permanent/deferred skip. */
export async function skipQuestionnaireForNow({ commander, vacancyId, saveAnswers, leave,
  mode = questionnaireMode, saveDraft = saveApplicationDraft,
  readDraft = readApplicationDraft, writeDraft = writeApplicationDraft }) {
  if (!mode.enabled) return false;
  const url = commander.getUrl();
  if (!(await extractPageQuestions({ evaluate: commander.evaluate })).length) return false;
  if (commander.getUrl() !== url) return false;
  await saveAnswers();
  if (commander.getUrl() !== url || !mode.enabled) return false;
  const previous = await readDraft(vacancyId);
  await saveDraft({ commander, vacancyId, requiresReview: false,
    error: previous?.error ?? { code: 'questionnaire_paused', text: 'Questionnaires temporarily disabled for this run' } });
  // Keep an earlier error/review requirement for the next visit, without leaving an error
  // marker on the live form that could race its submission-error watcher while navigating.
  if (previous?.requiresReview) {
    const captured = await readDraft(vacancyId);
    await writeDraft({ ...captured, requiresReview: true, error: previous.error });
  }
  if (commander.getUrl() !== url || !mode.enabled) return false;
  mode.remember(vacancyId, { url });
  console.log(`⏭️  Vacancy ${vacancyId}: questionnaire skipped in RAM (no-questions mode); answers preserved.`);
  await leave();
  return true;
}
