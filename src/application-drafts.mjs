/** Private recovery copies of failed applications. Never stored under data/ or committed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const APPLICATION_DRAFTS_DIR = path.join(process.cwd(), 'logs', 'application-drafts');
const draftFile = (id, directory) => {
  if (!/^\d+$/.test(String(id))) throw new Error('An application draft needs a vacancy ID');
  return path.join(directory, `${id}.json`);
};

export async function readApplicationDraft(vacancyId, directory = APPLICATION_DRAFTS_DIR) {
  try { return JSON.parse(await fs.readFile(draftFile(vacancyId, directory), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function writeApplicationDraft(draft, directory = APPLICATION_DRAFTS_DIR) {
  const file = draftFile(draft.vacancyId, directory);
  const before = await readApplicationDraft(draft.vacancyId, directory);
  const content = (entry) => JSON.stringify({ ...entry, capturedAt: undefined });
  if (before && content(before) === content(draft)) return { file, written: false };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(draft, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  return { file, written: true };
}

/** Include the letter and custom-choice text as well as the checked option values. */
export async function saveApplicationDraft({ commander, vacancyId, error, directory = APPLICATION_DRAFTS_DIR }) {
  const draft = await commander.evaluate(({ vacancyId, error }) => {
    const form = document.querySelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]') ??
      [...document.querySelectorAll('[data-qa-popup-error-code]')].find((e) => e.getClientRects().length)?.closest('form');
    if (!form) throw new Error('Cannot back up the failed application: its form is missing');
    const actualId = new URL(window.location.href).searchParams.get('vacancyId') ?? form.querySelector('input[name="vacancy_id"]')?.value;
    if (actualId && actualId !== String(vacancyId)) throw new Error('The application changed before its backup');
    const fields = [...form.querySelectorAll('textarea,input,select')].filter((e) =>
      !['hidden', 'password', 'submit', 'button', 'file'].includes(e.type) && !/captcha|csrf|xsrf|token|password/i.test(e.name) &&
      !e.closest('[role="option"][data-qa^="magritte-select-option-"]')).map((e) => ({
      tag: e.tagName.toLowerCase(), name: e.name, qa: e.getAttribute('data-qa'), value: e.value,
      ...(['radio', 'checkbox'].includes(e.type) ? { checked: e.checked } : {}),
      question: e.closest('[data-qa="task-body"]')?.querySelector('[data-qa="task-question"]')?.textContent.trim() ?? '',
    }));
    if (!fields.length) throw new Error('Cannot back up an empty failed application');
    // A dismissed error banner must not permit the next automatic send on this document.
    form.setAttribute('data-hh-application-error', JSON.stringify({ ...error, vacancyId: String(vacancyId) }));
    return { vacancyId: String(vacancyId), url: window.location.href, fields, error, requiresReview: true,
      capturedAt: new Date().toISOString() };
  }, { vacancyId, error: { code: error.code, text: error.text } });
  return writeApplicationDraft(draft, directory);
}

export async function completeApplicationDraft(vacancyId, directory = APPLICATION_DRAFTS_DIR) {
  const draft = await readApplicationDraft(vacancyId, directory);
  if (draft?.requiresReview) await writeApplicationDraft({ ...draft, requiresReview: false }, directory);
}

/** Restore a recovery copy for review only; never click Send or a CV selector. */
export async function restoreApplicationDraft({ commander, draft, overwrite = false }) {
  return commander.evaluate(({ draft, overwrite }) => {
    const url = new URL(window.location.href);
    if (url.hostname !== 'hh.ru' || url.searchParams.get('vacancyId') !== String(draft.vacancyId)) {
      throw new Error('Refusing to restore answers to another application');
    }
    const form = document.querySelector('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]');
    if (!form) throw new Error('The application form is missing');
    let restored = 0;
    for (const field of draft.fields) {
      const elements = [...form.querySelectorAll('textarea,input,select')].filter((e) =>
        !['hidden', 'password', 'file'].includes(e.type) && e.name === field.name &&
        (!field.tag || e.tagName.toLowerCase() === field.tag) && (!field.qa || e.getAttribute('data-qa') === field.qa));
      for (const element of elements) {
        if ('checked' in field) {
          if (!field.checked || element.value !== field.value) continue;
          if (!overwrite && elements.some((e) => e.checked)) continue;
          element.click();
        } else {
          if (!field.value || (!overwrite && element.value)) continue;
          const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
            : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, field.value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        restored++;
      }
    }
    form.setAttribute('data-hh-application-error', JSON.stringify({ vacancyId: String(draft.vacancyId),
      code: draft.error?.code ?? 'unknown', text: draft.error?.text ?? 'Restored failed application; manual review required' }));
    return { restored };
  }, { draft, overwrite });
}
