/** Reusable HH.ru workplace editing, language copies and observation. Never saves a workplace. */
import { parseMonthYear, withStack } from './experience.mjs';
import { normalizeText } from './cv.mjs';
import {
  discardHhExperience, fillHhExperience, hhExperienceFormOpen, hhExperienceResumes,
  openHhExperienceForm, setHhExperienceResumes,
} from './experience-sites.mjs';

/** Runs in the page. Only workplace fields, never cookies or account/contact fields. */
export function readHhWorkplace() {
  const field = (selector) => document.querySelector(selector);
  const value = (selector) => field(selector)?.value ?? '';
  if (!field('input[name="position"]')) {
    return null;
  }
  const month = (part) => field(`[data-qa="resume-editor-experience-${part}-month-input"] [data-qa="trigger-values-wrapper"]`)?.textContent.trim() ?? '';
  const industry = [...document.querySelectorAll('[data-qa="trigger-root"]')].find((element) => /field of activity|сфера деятельности/i.test(element.textContent));
  const industryText = industry?.textContent.replace(/^(?:Company's field of activity|Сфера деятельности компании|Сфера деятельности)/i, '')
    .replace(/(?:and more|и ещ[её])\s*\d+\s*$/i, '').trim() ?? '';
  return {
    url: window.location.href,
    company: value('input[name="company"]'), title: value('input[name="position"]'),
    description: value('[data-qa="resume-editor-experience-description-input"]'),
    startMonth: month('start'), startYear: value('[data-qa="resume-editor-experience-start-year-input"]'),
    endMonth: month('end'), endYear: value('[data-qa="resume-editor-experience-end-year-input"]'),
    current: Boolean(field('[data-qa="resume-editor-experience-present-checkbox"]')?.checked),
    area: field('[data-qa="resume-editor-experience-area-input"] [data-qa="trigger-values-wrapper"]')?.textContent.trim() ?? '',
    website: value('[data-qa="resume-editor-experience-company-url-input"]'),
    industryText,
    resumes: [...document.querySelectorAll('[data-qa^="profile-resumes-list-checkbox-"]')].map((element) => ({
      hash: element.getAttribute('data-qa').slice('profile-resumes-list-checkbox-'.length),
      checked: Boolean((element.matches('input') ? element : element.querySelector('input'))?.checked),
    })),
  };
}

export async function readHhExperienceForm(page) {
  const form = await page.evaluate(readHhWorkplace);
  if (!form) {
    return null;
  }
  return {
    ...form,
    start: parseMonthYear(`${form.startMonth} ${form.startYear}`),
    end: form.current ? null : parseMonthYear(`${form.endMonth} ${form.endYear}`),
  };
}

/** Resolve labels containing commas without splitting them into separate industries. */
export function industryPrefix(text, candidates) {
  const normalized = String(text).trim();
  return candidates.filter((label) => normalized === label || normalized.startsWith(`${label}, `))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

export async function setHhExperienceArea(page, area) {
  const trigger = page.locator('[data-qa="resume-editor-experience-area-input"]');
  if (await trigger.locator('[data-qa="trigger-values-wrapper"]').textContent().catch(() => '') === area) {
    return;
  }
  await trigger.click();
  // The area's searchable input is labelled in the current UI language.
  const areaInput = page.locator('input[role="combobox"][aria-label="City or region"]:visible, input[role="combobox"][aria-label="Город или регион"]:visible');
  await areaInput.fill(area);
  const option = page.getByRole('option', { name: area, exact: true });
  await option.waitFor({ timeout: 10000 });
  await option.click();
}

export async function setHhExperienceIndustries(page, industries) {
  const trigger = page.locator('[data-qa="trigger-root"]').filter({ hasText: /field of activity|сфера деятельности/i }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  const reset = dialog.getByRole('button', { name: /^(reset|сбросить)$/i });
  if (await reset.isEnabled()) {
    await reset.click();
  }
  const remaining = Array.isArray(industries) ? [...industries] : [industries];
  const selected = [];
  while (remaining.length > 0) {
    const text = remaining.shift().trim();
    if (!text) {
      continue;
    }
    // First word finds whole labels, including those with internal commas.
    await dialog.locator('[data-qa="tree-selector-search-input"]').fill(text.split(/\s+/)[0]);
    // HH.ru debounces its search. Old results can remain visible for a moment.
    const result = await page.waitForFunction((remaining) => [...document.querySelectorAll('[role="dialog"] [data-qa~="tree-selector-item-text"]')]
      .map((element) => element.textContent.trim())
      .filter((label) => remaining === label || remaining.startsWith(`${label}, `))
      .sort((a, b) => b.length - a.length)[0] || false, text, { timeout: 10000 });
    const label = await result.jsonValue();
    if (selected.includes(label)) {
      throw new Error(`hh.ru: duplicate industry: ${label}`);
    }
    await dialog.getByText(label, { exact: true }).click();
    selected.push(label);
    if (text.length > label.length) {
      remaining.unshift(text.slice(label.length).replace(/^,\s*/, ''));
    }
  }
  // This applies the chooser to the local draft only. The workplace's Save is untouched.
  await dialog.getByRole('button', { name: /^(save|сохранить)$/i }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/** Apply metadata when provided; empty values stay empty. All controls affect the draft only. */
export async function fillHhExperienceMetadata(page, fields) {
  // Company entry mounts the remaining metadata controls asynchronously.
  if (fields.website !== undefined) {
    await page.locator('[data-qa="resume-editor-experience-company-url-input"]').fill(fields.website);
  }
  if (fields.area) {
    await setHhExperienceArea(page, fields.area);
  }
  if (fields.industries !== undefined || fields.industryText) {
    await setHhExperienceIndustries(page, fields.industries ?? fields.industryText);
  }
}

/**
 * An update to a shared record becomes a language-specific copy. The old record is deselected
 * in a separate reviewed step. Existing open forms are never navigated away from.
 */
export async function prepareHhCvChange(page, change, { resumeHash, port = 9351 } = {}) {
  if (await hhExperienceFormOpen(page)) {
    throw new Error('hh.ru: finish the existing form before preparing another position');
  }
  const notes = await openHhExperienceForm(page, { resumeHash, job: change.kind === 'add' ? null : change.target, port });
  if (notes.length > 0) {
    throw new Error(notes.join('; '));
  }
  const before = await readHhExperienceForm(page);
  let fields = { ...change.fields };
  if (fields.stack) {
    fields.description = withStack(before.description, fields.stack, { add: Boolean(fields.addStack) });
  }
  let followup = null;
  if (change.kind === 'detach') {
    await setHhExperienceResumes(page, before.resumes.filter((resume) => resume.checked && resume.hash !== resumeHash).map((resume) => resume.hash));
    return { kind: 'detach', before, draft: await readHhExperienceForm(page), followup, notes };
  }
  const shared = before.resumes.some((resume) => resume.checked && resume.hash !== resumeHash);
  if (change.kind === 'copy' || (change.kind === 'update' && shared)) {
    fields = { ...before, ...fields };
    followup = { kind: 'detach', target: { company: before.company, title: before.title, description: before.description }, fields: {} };
    // No user input should be discarded if they started typing while we read the source.
    if (JSON.stringify(await readHhExperienceForm(page)) !== JSON.stringify(before)) {
      throw new Error('hh.ru: the source changed while it was being read; left open for you');
    }
    await discardHhExperience(page);
    const opened = await openHhExperienceForm(page, { resumeHash, job: null, port });
    if (opened.length > 0) {
      throw new Error(opened.join('; '));
    }
    notes.push('Language-specific copy: after saving, deselect the old entry from this resume in a separate reviewed save.');
  }
  await fillHhExperience(page, fields, { notes });
  await fillHhExperienceMetadata(page, fields);
  if (change.kind === 'add' || followup) {
    await setHhExperienceResumes(page, [resumeHash]);
  }
  const draft = await readHhExperienceForm(page);
  const selected = (await hhExperienceResumes(page)).filter((resume) => resume.checked).map((resume) => resume.hash);
  if (!selected.includes(resumeHash)) {
    throw new Error('hh.ru: target resume is not selected');
  }
  return { kind: followup ? 'copy' : change.kind, before, draft, followup, notes };
}

/** Browser-side observer: captures the exact fields at the final Save click, never submits. */
export function installHhCvObserver({ readSource, binding }) {
  window.__hhCvObservers ??= {};
  const previous = window.__hhCvObservers[binding];
  if (previous) {
    document.removeEventListener('input', previous.input, true);
    document.removeEventListener('click', previous.click, true);
  }
  const read = new Function(`return (${readSource})()`); // trusted app function, no page/user code
  const observer = { lastActivity: Date.now() };
  observer.input = () => { observer.lastActivity = Date.now(); };
  observer.click = (event) => {
    observer.lastActivity = Date.now();
    if (event.target.closest?.('[data-qa="profile-layout-cancel-button"]') && read()) {
      window[binding]({ cancelled: true }).catch(() => {});
      return;
    }
    if (event.target.closest?.('[data-qa="profile-layout-save-button"]') && !event.target.closest('[role="dialog"]')) {
      const form = read();
      if (form) {
        window[binding](form).catch(() => {});
      }
    }
  };
  window.__hhCvObserver = observer;
  window.__hhCvObservers[binding] = observer;
  document.addEventListener('input', observer.input, true);
  document.addEventListener('click', observer.click, true);
}

/** Check an attempted save against exports, including dates and deselected resumes. */
export function verifyHhSavedForm(form, resumes) {
  const start = parseMonthYear(`${form.startMonth} ${form.startYear}`);
  const end = form.current ? null : parseMonthYear(`${form.endMonth} ${form.endYear}`);
  if (!start || (!form.current && !end) || form.resumes.length === 0) {
    return false;
  }
  return form.resumes.every(({ hash, checked }) => {
    const cv = resumes.find((resume) => resume.hash === hash)?.cv;
    if (!cv) {
      return false;
    }
    const exists = cv.jobs.some((job) => job.company === form.company && job.position === form.title &&
      job.start === start && job.end === end && normalizeText(job.description) === normalizeText(form.description));
    return exists === checked;
  });
}

/** Passive save monitoring. A save is reported only after the form closes, never for Cancel. */
export async function observeHhCvSaves(page, { onSaved, onState = () => {}, onError = console.error } = {}) {
  const timers = new Set();
  let stopped = false;
  let generation = 0;
  const binding = `hhCvSaveAttempt_${process.pid}_${Date.now()}`;
  await page.exposeBinding(binding, async (_source, form) => {
    if (stopped) {
      return;
    }
    if (form.cancelled) {
      generation++;
      timers.forEach(clearTimeout);
      timers.clear();
      onState({ state: 'cancelled' });
      return;
    }
    const attempt = ++generation;
    onState({ state: 'saving', form });
    let attempts = 0;
    const check = async () => {
      timers.delete(timer);
      if (stopped || attempt !== generation) {
        return;
      }
      try {
        if (!await hhExperienceFormOpen(page) && /\/resume\/|\/profile\/edit\/experience(?:\?|$)/.test(page.url())) {
          const verified = await onSaved(form);
          onState({ state: verified === false ? 'not_saved' : 'saved', form });
        } else if (++attempts < 120) {
          timer = setTimeout(check, 1000);
          timers.add(timer);
        } else {
          onState({ state: 'not_saved', form });
        }
      } catch (error) {
        onError(error);
      }
    };
    let timer = setTimeout(check, 500);
    timers.add(timer);
  });
  const config = { readSource: readHhWorkplace.toString(), binding };
  await page.addInitScript(installHhCvObserver, config);
  await page.evaluate(installHhCvObserver, config);
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}
