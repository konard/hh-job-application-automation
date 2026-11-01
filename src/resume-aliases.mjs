/** Prepare canonical technology labels with vacancy-observed aliases inline; owner saves. */
import { resumeToCv } from './cv.mjs';
import { auditCvTechnologies } from './cv-technologies.mjs';
import { openHhAboutEditor, prefillHhAboutDraft } from './hh-cv-editor.mjs';
import { ensureCvAliasSync } from './cv-alias-sync.mjs';

export const ALIAS_HEADING = 'Технологии — варианты названий:';

export function planResumeAliases(resume, requested, catalog) {
  const proposal = auditCvTechnologies([resumeToCv(resume)], catalog, { observed: requested }).proposals[0];
  return { additions: proposal.missingAliases, about: proposal.about };
}

/** Page logic separated for local-browser regression tests; the caller owns the résumé slot. */
export async function applyResumeAliases(page, { resume, aliases, catalog, backup = async () => {} }) {
  const editor = page.locator('textarea[data-qa="resume-editor-about"]');
  if (await editor.count()) throw new Error('The résumé About editor already has an open draft; left for the user');
  await openHhAboutEditor(page, { resumeHash: resume.hash });
  const before = await editor.inputValue();
  const plan = planResumeAliases({ ...resume, about: before }, aliases, catalog);
  if (plan.about === before) {
    await page.locator('[data-qa="resume-partial-edit-cancel"]').click();
    return { ...plan, before };
  }
  const max = Number(await editor.getAttribute('maxlength'));
  if (max > 0 && plan.about.length > max) throw new Error('Alias additions exceed the résumé About field limit');
  await backup({ before, after: plan.about, additions: plan.additions });
  if (await editor.inputValue() !== before) throw new Error('The résumé draft changed during comparison; nothing was overwritten');
  await prefillHhAboutDraft(page, { kind: 'about', target: { about: before }, fields: { about: plan.about } }, { resumeHash: resume.hash });
  return { ...plan, before, pending: true };
}

export function createResumeAliasUpdater({ fromPort = 9322, port = 9352, log = console.log, start = ensureCvAliasSync } = {}) {
  return async () => {
    try { return await start({ fromPort, port, log }); }
    catch (error) { log(`⚠️  Résumé alias update deferred: ${error.message.split('\n')[0]}`); }
  };
}
