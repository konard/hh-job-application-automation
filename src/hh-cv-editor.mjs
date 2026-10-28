/** Reusable HH.ru workplace editing, language copies and observation. Never saves a workplace. */
import { companySimilarity, parseMonthYear, withStack } from './experience.mjs';
import { normalizeText } from './cv.mjs';
import {
  discardHhExperience, fillHhExperience, hhCvFormOpen, hhExperienceResumes,
  openHhExperienceForm, setHhExperienceResumes,
} from './experience-sites.mjs';

// HH.ru's text export collapses runs of horizontal whitespace inside paragraphs.
const exportText = (text) => normalizeText(text).replace(/[^\S\n]+/g, ' ');

/** Runs in the page. Only workplace fields, never cookies or account/contact fields. */
export function readHhWorkplace({ includeAbout = false } = {}) {
  const field = (selector) => document.querySelector(selector);
  const value = (selector) => field(selector)?.value ?? '';
  if (!field('input[name="position"]')) {
    const about = field('textarea[data-qa="resume-editor-about"]');
    if (includeAbout && about) {
      const url = new URL(window.location.href);
      const resumeHash = url.pathname.match(/\/resume\/(?:edit\/)?([a-z0-9]+)(?:\/|$)/i)?.[1] ?? url.searchParams.get('resumeFrom') ?? url.searchParams.get('resume');
      return { kind: 'about', url: url.href, resumeHash, about: about.value };
    }
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

export async function readHhCvForm(page) {
  const form = await page.evaluate(readHhWorkplace, { includeAbout: true });
  if (!form || form.kind === 'about') return form;
  return { ...form, start: parseMonthYear(`${form.startMonth} ${form.startYear}`),
    end: form.current ? null : parseMonthYear(`${form.endMonth} ${form.endYear}`) };
}

/** Cancel an unchanged app-opened About editor after a failed preparation, never an edited draft. */
export async function discardUnchangedHhAbout(page, { resumeHash, expectedAbout }) {
  const form = await readHhCvForm(page);
  if (form?.kind !== 'about' || form.resumeHash !== resumeHash || form.about !== expectedAbout) {
    throw new Error('hh.ru: About draft changed; it was not discarded');
  }
  await page.locator('[data-qa="resume-partial-edit-cancel"]').click();
  await page.locator('textarea[data-qa="resume-editor-about"]').waitFor({ state: 'detached', timeout: 15000 });
}

/** Open only this CV's About field, check its current value, and leave Save to the owner. */
export async function prepareHhAboutChange(page, change, { resumeHash }) {
  if (await hhCvFormOpen(page)) throw new Error('hh.ru: finish the existing CV draft before editing About');
  await page.goto(`https://hh.ru/resume/${encodeURIComponent(resumeHash)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await page.locator('input[name*="captcha"], [data-qa="account-login-form"]').count()) {
    throw new Error('hh.ru: the CV slot needs manual sign-in or CAPTCHA completion');
  }
  await page.locator('[data-qa="resume-edit-button-about"]').click();
  return prefillHhAboutDraft(page, change, { resumeHash });
}

/** Also supports recovering an unchanged app-opened editor after a preparation error. */
export async function prefillHhAboutDraft(page, change, { resumeHash }) {
  const editor = page.locator('textarea[data-qa="resume-editor-about"]');
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  // SSR makes the textarea visible before React attaches onChange. Filling too early can
  // look successful, then be reset to the old value during hydration.
  await page.waitForFunction(() => {
    const field = document.querySelector('textarea[data-qa="resume-editor-about"]');
    return field && Object.keys(field).some((name) => name.startsWith('__reactProps$') && typeof field[name]?.onChange === 'function');
  }, null, { timeout: 20000 });
  const before = await readHhCvForm(page);
  if (before?.kind !== 'about' || before.resumeHash !== resumeHash) throw new Error('hh.ru: About editor belongs to a different CV');
  if (change.target?.about !== undefined && exportText(before.about) !== exportText(change.target.about)) {
    throw new Error('hh.ru: saved About text changed since the audit; current draft left untouched');
  }
  const wanted = String(change.fields.about);
  const max = Number(await editor.getAttribute('maxlength'));
  if (max > 0 && wanted.length > max) throw new Error(`hh.ru: About draft exceeds its ${max}-character limit`);
  if (await editor.inputValue() !== before.about) throw new Error('hh.ru: About was edited during comparison; left untouched');
  await editor.fill(wanted);
  const controlledValue = await editor.evaluate((field) => field[Object.keys(field).find((name) => name.startsWith('__reactProps$'))]?.value);
  if (controlledValue !== wanted) {
    // Some HH.ru builds update the DOM on bulk input without updating controlled state.
    // A native keystroke and its undo go through the same onChange path as owner typing.
    await editor.press('Space');
    await editor.press('Backspace');
  }
  await page.waitForFunction((wanted) => {
    const field = document.querySelector('textarea[data-qa="resume-editor-about"]');
    const props = field?.[Object.keys(field).find((name) => name.startsWith('__reactProps$'))];
    return field?.value === wanted && props?.value === wanted;
  }, wanted, { timeout: 5000 });
  await editor.blur();
  await page.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
  const draft = await readHhCvForm(page);
  if (draft.about !== wanted) throw new Error('hh.ru: About prefill did not match the requested text');
  return { kind: 'about', before, draft, followup: null, notes: [] };
}

/** A matched card is insufficient: the opened form must be the requested record too. */
export function assertHhExperienceTarget(form, target) {
  if (!form || !target || companySimilarity(form.company, target.company) !== 1 ||
    (target.entryId && form.url?.match(/\/experience\/(\d+)(?:[/?#]|$)/)?.[1] !== String(target.entryId)) ||
    (target.title && normalizeText(form.title) !== normalizeText(target.title)) ||
    (target.description !== undefined && normalizeText(form.description) !== normalizeText(target.description))) {
    throw new Error('hh.ru: opened workplace does not match the requested record; no fields changed');
  }
}

/** Roll back an app-owned checkbox draft, refusing to overwrite subsequent user edits. */
export async function restoreHhExperienceSelection(page, { before, draft }) {
  const current = await readHhExperienceForm(page);
  if (JSON.stringify(current) !== JSON.stringify(draft)) {
    throw new Error('hh.ru: draft changed after preparation; user edits left untouched');
  }
  await setHhExperienceResumes(page, before.resumes.filter((resume) => resume.checked).map((resume) => resume.hash));
  return readHhExperienceForm(page);
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
  if (change.kind === 'about') {
    const existing = await readHhCvForm(page);
    if (existing?.kind === 'about' && existing.resumeHash === resumeHash && existing.about === change.fields.about) {
      return { kind: 'about', before: existing, draft: existing, followup: null, notes: ['Reattached to the exact prepared About draft; no fields changed.'] };
    }
    return prepareHhAboutChange(page, change, { resumeHash });
  }
  if (await hhCvFormOpen(page)) {
    throw new Error('hh.ru: finish the existing form before preparing another position');
  }
  const notes = await openHhExperienceForm(page, { resumeHash, job: change.kind === 'add' ? null : change.target, port });
  if (notes.length > 0) {
    throw new Error(notes.join('; '));
  }
  const before = await readHhExperienceForm(page);
  if (change.kind !== 'add') {
    assertHhExperienceTarget(before, change.target);
  }
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
    const entryId = before.url.match(/\/experience\/(\d+)/)?.[1];
    followup = { kind: 'detach', target: { company: before.company, title: before.title, description: before.description, ...(entryId ? { entryId } : {}) }, fields: {} };
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
  const read = new Function(`return (${readSource})({ includeAbout: true })`); // trusted app function, no page/user code
  const observer = { lastActivity: Date.now() };
  observer.input = () => { observer.lastActivity = Date.now(); };
  observer.click = (event) => {
    observer.lastActivity = Date.now();
    if (event.target.closest?.('[data-qa="profile-layout-cancel-button"], [data-qa="resume-partial-edit-cancel"]') && read()) {
      window[binding]({ cancelled: true }).catch(() => {});
      return;
    }
    const aboutSave = event.target.closest?.('[data-qa="resume-partial-edit-save"]');
    if (aboutSave || (event.target.closest?.('[data-qa="profile-layout-save-button"]') && !event.target.closest('[role="dialog"]'))) {
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
  if (form.kind === 'about') {
    const cv = resumes.find((resume) => resume.hash === form.resumeHash)?.cv;
    return Boolean(cv && exportText(cv.about) === exportText(form.about));
  }
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
        if (!await hhCvFormOpen(page) && /\/resume\/|\/profile\/edit\/experience(?:\?|$)/.test(page.url())) {
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
