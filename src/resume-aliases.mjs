/** Prepare canonical technology labels with vacancy-observed aliases inline; owner saves. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createMutex } from './helpers/mutex.mjs';
import { quoteLino, resumeToCv } from './cv.mjs';
import { loadTechnologyAliases, observedTechnologyNames } from './vacancy-analysis.mjs';
import { createVacancyCache } from './vacancy-cache.mjs';
import { auditCvTechnologies } from './cv-technologies.mjs';
import { openHhAboutEditor, prefillHhAboutDraft } from './hh-cv-editor.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openSlot } from './browser-slots.mjs';
import { seedHhSession } from './login.mjs';

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

export function createResumeAliasUpdater({ fromPort = 9322, port = 9352,
  resumeFile = path.join(process.cwd(), 'data/resume/resume.json'), log = console.log,
  open = openSlot, seed = seedHhSession } = {}) {
  const exclusive = createMutex();
  return (request) => exclusive(async () => {
    const session = await open({ name: 'resume-alias-slot', port });
    try {
      // Session seeding visits the profile page, so protect a user's open draft before it runs.
      if (await session.page.locator('textarea[data-qa="resume-editor-about"]').count()) {
        log('⚠️  The résumé About editor has an open draft; automatic alias update deferred');
        return;
      }
      if (!await seed({ page: session.page, fromPort, log })) return;
      const catalog = await loadTechnologyAliases();
      const observed = observedTechnologyNames(await createVacancyCache().all(), catalog);
      const result = await applyResumeAliases(session.page, { ...request, aliases: [...observed, ...request.aliases], catalog,
        backup: async ({ before, after, additions }) => {
          const directory = path.join(path.dirname(resumeFile), 'alias-updates');
          await fs.mkdir(directory, { recursive: true });
          const text = Object.entries({ resume: request.resume.hash, vacancy: request.vacancyId, before, after,
            additions: additions.map((item) => `${item.canonical}: ${item.spelling}`).join('\n') })
            .map(([field, value]) => `${field}\n  ${quoteLino(value || ' ')}`).join('\n') + '\n';
          await fs.writeFile(path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.lino`), text);
        } });
      if (result.pending) {
        // A separate passive process outlives this request's CDP connection. Only the owner
        // can save; it then exports actual saved data, never this pending draft.
        const child = spawn(process.execPath, [fileURLToPath(new URL('./cv-sync.mjs', import.meta.url)), 'watch',
          '--hh-port', String(port), '--out', 'examples', '--once', '--state-file', `logs/experience/alias-watch-${port}.json`],
        { detached: true, stdio: 'ignore', cwd: process.cwd() });
        child.unref();
        log(`📝 Résumé draft prepared with inline name variants in slot ${port}; review it and click Save. No automatic Save.`);
      }
    } catch (error) { log(`⚠️  Résumé alias update deferred: ${error.message.split('\n')[0]}`); }
    finally { await session.release(); }
  });
}
