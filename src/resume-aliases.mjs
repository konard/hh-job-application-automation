/** Append only catalogued alternative spellings supported by existing résumé evidence. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createMutex } from './helpers/mutex.mjs';
import { quoteLino } from './cv.mjs';
import { containsTechnologySpelling, loadTechnologyAliases, resumeText, technologyMentions } from './vacancy-analysis.mjs';
import { openSlot } from './browser-slots.mjs';
import { seedHhSession } from './login.mjs';

export const ALIAS_HEADING = 'Технологии — варианты названий:';
const normalize = (value) => String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function planResumeAliases(resume, requested, catalog) {
  const known = new Map(technologyMentions(resumeText(resume), catalog).map((item) => [item.canonical, item]));
  const additions = [];
  const existing = resumeText(resume);
  for (const { canonical, spelling } of requested) {
    if (!known.has(canonical) || !catalog.get(canonical)?.some((name) => normalize(name) === normalize(spelling))) continue;
    if (containsTechnologySpelling(existing, spelling)) continue;
    if (!additions.some((item) => normalize(item.spelling) === normalize(spelling))) additions.push({ canonical, spelling });
  }
  const about = String(resume.about ?? '');
  if (!additions.length) return { additions, about };
  const split = about.indexOf(`\n\n${ALIAS_HEADING}\n`);
  const original = split < 0 ? about : about.slice(0, split);
  const lines = split < 0 ? [] : about.slice(split + `\n\n${ALIAS_HEADING}\n`.length).split('\n').filter(Boolean);
  // Our additive block keeps every existing line and adds only newly observed spellings.
  const added = additions.map((item) => `${item.canonical}: ${item.spelling}`);
  return { additions, about: `${original.trimEnd()}\n\n${ALIAS_HEADING}\n${[...new Set([...lines, ...added])].join('\n')}` };
}

/** Page logic separated for local-browser regression tests; the caller owns the résumé slot. */
export async function applyResumeAliases(page, { resume, aliases, catalog, backup = async () => {} }) {
  const editor = page.locator('textarea[data-qa="resume-editor-about"]');
  if (await editor.count()) throw new Error('The résumé About editor already has an open draft; left for the user');
  await page.goto(`https://hh.ru/resume/${resume.hash}`, { waitUntil: 'domcontentloaded' });
  if (await page.locator('input[name*="captcha"], [data-qa="account-login-form"]').count()) throw new Error('The résumé slot needs manual sign-in or CAPTCHA completion');
  await page.locator('[data-qa="resume-edit-button-about"]').click();
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  const before = await editor.inputValue();
  const plan = planResumeAliases({ ...resume, about: before }, aliases, catalog);
  if (!plan.additions.length) {
    await page.locator('[data-qa="resume-partial-edit-cancel"]').click();
    return { ...plan, before };
  }
  const max = Number(await editor.getAttribute('maxlength'));
  if (max > 0 && plan.about.length > max) throw new Error('Alias additions exceed the résumé About field limit');
  await backup({ before, after: plan.about, additions: plan.additions });
  if (await editor.inputValue() !== before) throw new Error('The résumé draft changed during comparison; nothing was overwritten');
  await editor.fill(plan.about);
  await page.locator('[data-qa="resume-partial-edit-save"]').click();
  await editor.waitFor({ state: 'detached', timeout: 15000 });
  const saved = await page.locator('[data-qa="resume-about-card"]').innerText();
  if (!plan.additions.every((item) => saved.includes(item.spelling))) throw new Error('The saved résumé did not confirm all alias additions');
  return { ...plan, before };
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
      const result = await applyResumeAliases(session.page, { ...request, catalog: await loadTechnologyAliases(),
        backup: async ({ before, after, additions }) => {
          const directory = path.join(path.dirname(resumeFile), 'alias-updates');
          await fs.mkdir(directory, { recursive: true });
          const text = Object.entries({ resume: request.resume.hash, vacancy: request.vacancyId, before, after,
            additions: additions.map((item) => `${item.canonical}: ${item.spelling}`).join('\n') })
            .map(([field, value]) => `${field}\n  ${quoteLino(value || ' ')}`).join('\n') + '\n';
          await fs.writeFile(path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.lino`), text);
        } });
      if (result.additions.length) {
        const latest = JSON.parse(await fs.readFile(resumeFile, 'utf8'));
        if (latest.hash === request.resume.hash) {
          await fs.writeFile(`${resumeFile}.tmp`, JSON.stringify({ ...latest, about: result.about }, null, 2) + '\n');
          await fs.rename(`${resumeFile}.tmp`, resumeFile);
        }
        log(`📝 Résumé updated with existing technology spellings: ${result.additions.map((item) => item.spelling).join(', ')}`);
      }
    } catch (error) { log(`⚠️  Résumé alias update deferred: ${error.message.split('\n')[0]}`); }
    finally { await session.release(); }
  });
}
