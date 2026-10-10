/**
 * The browser side of the experience sync: reading the LinkedIn experience page, and prefilling
 * the experience forms of LinkedIn and hh.ru in a browser slot. Saving is a separate step the
 * caller takes only after the user typed `y`.
 *
 * @module experience-sites
 */

import { formatMonthYear } from './experience.mjs';
import { waitForCaptcha } from './form-slots.mjs';

export const LINKEDIN_PROFILE = 'https://www.linkedin.com/in/konard';
const LOGIN_URL = /linkedin\.com\/(authwall|login|uas\/login|checkpoint|signup|start\/join)/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a LinkedIn URL is a login or sign-up wall
 * @param {string} url
 * @returns {boolean}
 */
export const isLinkedInLoginPage = (url) => LOGIN_URL.test(String(url));

/**
 * Whether the slot has a LinkedIn session: its li_at cookie is set. Only the cookie's presence
 * is checked; its value is never read out
 * @param {Object} page - Playwright page of the slot
 * @returns {Promise<boolean>}
 */
export async function hasLinkedInSession(page) {
  const cookies = await page.context().cookies('https://www.linkedin.com').catch(() => []);
  return cookies.some((cookie) => cookie.name === 'li_at' && cookie.value !== '');
}

/**
 * The "show all experiences" page of a profile
 * @param {string} profileUrl - https://www.linkedin.com/in/<name>
 * @returns {string}
 */
export const linkedInExperienceUrl = (profileUrl) => `${profileUrl.replace(/\/+$/, '')}/details/experience/`;

/**
 * Runs in the page: the positions on LinkedIn's experience page as the text lines of each item
 * (the visible spans, in order), with nested roles for a company with several positions and the
 * edit link of each when the profile is the user's own
 * @returns {{items: Array<{lines: string[], editUrl: string|null, roles: Array<{lines: string[], editUrl: string|null}>}>, text: string, edits: Array<{label: string, url: string}>}}
 */
export function readLinkedInExperienceItems() {
  const ENTITY = '[data-view-name="profile-component-entity"]';
  const main = document.querySelector('main') ?? document.body;
  let entities = [...main.querySelectorAll(ENTITY)];
  // Older or newer markup without the entity mark: list items of the main list
  const isEntity = (element) => (entities.length > 0 ? element.matches(ENTITY) : element.matches('li'));
  if (entities.length === 0) {
    entities = [...main.querySelectorAll('li')].filter((li) => /\b\d{4}\b/.test(li.innerText));
  }
  const nestedIn = (element, root) => {
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      if (isEntity(node)) {
        return true;
      }
    }
    return false;
  };
  const linesOf = (root) => {
    const spans = [...root.querySelectorAll('span[aria-hidden="true"]')].filter((span) => !nestedIn(span, root));
    const raw = spans.length > 0
      ? spans.map((span) => span.innerText)
      : root.innerText.split('\n');
    const lines = [];
    for (const line of raw.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
      // Screen reader copies repeat the visible text
      if (lines[lines.length - 1] !== line) {
        lines.push(line);
      }
    }
    return lines;
  };
  const editUrlOf = (root) => {
    const link = [...root.querySelectorAll('a[href*="/edit/forms/"], a[href*="add-edit"], a[href*="/edit/"]')].find((a) => !nestedIn(a, root));
    return link ? new URL(link.getAttribute('href'), window.location.href).href : null;
  };
  const top = entities.filter((entity) => !entities.some((other) => other !== entity && other.contains(entity)));
  const items = top.map((entity) => {
    const roles = entities.filter((other) => other !== entity && entity.contains(other));
    return {
      lines: linesOf(entity),
      editUrl: editUrlOf(entity),
      roles: roles.map((role) => ({ lines: linesOf(role), editUrl: editUrlOf(role) })),
    };
  });
  // «Edit Senior Software Engineer at Kaiten.ru»: the edit link of each position, also when the
  // items are not recognized and the positions are read from the text
  const edits = [...new Map([...main.querySelectorAll('a[href*="/edit/forms/"][aria-label]')]
    .map((link) => [link.getAttribute('aria-label'), new URL(link.getAttribute('href'), window.location.href).href])).entries()]
    .map(([label, url]) => ({ label, url }));
  return { items, text: main.innerText, edits };
}

/**
 * Open the experience page in the slot, waiting while LinkedIn asks to log in (the user logs in
 * in the slot's window; nothing here reads or types a password), then load every position
 * @param {Object} page - Playwright page of the slot
 * @param {Object} [options]
 * @param {string} [options.profileUrl=LINKEDIN_PROFILE]
 * @param {number} [options.waitMinutes=30] - How long to wait for the login
 * @returns {Promise<{items: Object[], text: string, edits: Array<{label: string, url: string}>, url: string}>}
 */
export async function readLinkedInExperience(page, { profileUrl = LINKEDIN_PROFILE, waitMinutes = 30, port = 9350 } = {}) {
  const url = linkedInExperienceUrl(profileUrl);
  if (!page.url().startsWith(url)) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await waitForLinkedInLogin(page, { url, port, waitMinutes });
  await page.waitForSelector('main', { timeout: 30000 }).catch(() => {});
  // Positions load as the page scrolls; "Show more results" loads the rest
  for (let i = 0; i < 15; i++) {
    const more = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const button = [...document.querySelectorAll('main button')].find((element) => /show more results|показать больше/i.test(element.innerText));
      button?.click();
      return Boolean(button);
    });
    await sleep(more ? 2500 : 1200);
    if (!more && i >= 2) {
      break;
    }
  }
  const { items, text, edits } = await page.evaluate(readLinkedInExperienceItems);
  return { items, text, edits, url: page.url() };
}

/**
 * Wait, when the slot has no LinkedIn session (no li_at cookie) or shows a login wall, until the
 * user logs in in the slot's window, then open `url`. Login stays manual: nothing here reads,
 * types or copies a password
 * @param {Object} page
 * @param {Object} options
 * @param {string} options.url - The page to be on afterwards
 * @param {number} [options.port=9350] - Shown in the message, to find the window
 * @param {number} [options.waitMinutes=30]
 */
export async function waitForLinkedInLogin(page, { url, port = 9350, waitMinutes = 30 }) {
  if (await hasLinkedInSession(page) && !isLinkedInLoginPage(page.url())) {
    return;
  }
  console.log(`🔐 Not logged in to LinkedIn: log in to LinkedIn in the slot window (port ${port}). The run goes on by itself`);
  console.log('   once you are logged in. This script never reads, types or stores your password.');
  // The sign-in form rather than the sign-up wall, coming back to `url` after the login
  await page.goto(`https://www.linkedin.com/login?session_redirect=${encodeURIComponent(url)}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const deadline = Date.now() + waitMinutes * 60000;
  let reported = Date.now();
  while (!(await hasLinkedInSession(page) && page.url().startsWith(url))) {
    if (Date.now() > deadline) {
      throw new Error(`Not logged in to LinkedIn after ${waitMinutes} minutes`);
    }
    // Logged in (the session cookie is there) but landed elsewhere, e.g. the feed: open `url`
    if (await hasLinkedInSession(page) && !isLinkedInLoginPage(page.url()) && !page.url().startsWith(url)) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    if (Date.now() - reported > 60000) {
      console.log('⏳ Still waiting for the LinkedIn login in the slot window...');
      reported = Date.now();
    }
    await sleep(3000);
  }
  console.log('✅ Logged in to LinkedIn');
}

/**
 * Runs in the page: set a form control by its label (label element, aria-label, or the text of
 * its group), firing the events frameworks listen to
 * @param {{label: string, value: string|boolean, kind: 'text'|'checkbox'|'select', group?: string}} field -
 *   label and group are regular expression sources, matched case-insensitively
 * @returns {string|null} Why it was not set, or null
 */
export function setFieldByLabel({ label, value, kind, group }) {
  const pattern = new RegExp(label, 'i');
  const groupPattern = group ? new RegExp(group, 'i') : null;
  // A checkbox without a label is named by the short text next to it («I am currently working in this role»)
  const nearText = (element) => {
    for (let node = element.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
      const text = node.innerText?.trim();
      if (text) {
        return text.length <= 120 ? text : '';
      }
    }
    return '';
  };
  const labelOf = (element) => {
    const own = [
      element.getAttribute('aria-label'),
      ...[...(element.labels ?? [])].map((item) => item.innerText),
      (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' '),
      element.getAttribute('placeholder'),
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return own || (kind === 'checkbox' ? nearText(element).replace(/\s+/g, ' ').trim() : '');
  };
  const groupOf = (element) => element.closest('fieldset')?.innerText ?? element.parentElement?.parentElement?.innerText ?? '';
  // A rich text box (LinkedIn's description) is a contenteditable with role=textbox
  const selector = kind === 'select' ? 'select' : kind === 'checkbox' ? 'input[type="checkbox"]'
    : 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"][role="textbox"]';
  const control = [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length > 0 &&
    pattern.test(labelOf(element)) && (!groupPattern || groupPattern.test(groupOf(element))));
  if (!control) {
    return `no field labelled ${label}${group ? ` in ${group}` : ''}`;
  }
  if (kind === 'checkbox') {
    // A styled checkbox is toggled by a real click on its label (the caller does it): a click
    // from the page script leaves the box and the form's state apart
    if (control.checked !== Boolean(value)) {
      control.setAttribute('data-hh-automation-toggle', '');
      return 'toggle';
    }
    return null;
  }
  if (kind === 'select') {
    const option = [...control.options].find((item) => item.text.trim().toLowerCase() === String(value).toLowerCase() || item.value === String(value));
    if (!option) {
      return `no option ${value} in ${label}`;
    }
    control.value = option.value;
  } else if (control.isContentEditable) {
    control.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, String(value));
    return null;
  } else {
    const prototype = control.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, String(value));
  }
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
  // Closes a suggestion list the typing opened
  control.blur();
  return null;
}

const fieldsOfLinkedIn = (fields) => {
  const list = [];
  const month = (date) => (date?.includes('-') ? formatMonthYear(date).split(' ')[0] : null);
  // Labels of the position form: «Job title*», «Organization*», «Location», «Description, maximum
  // 2,000 characters», «I am currently working in this role», «Start month», «Start year*»
  if (fields.title) {
    list.push({ label: '^(job )?title|^должность', value: fields.title, kind: 'text' });
  }
  if (fields.company) {
    list.push({ label: 'company|organization|компани|организаци', value: fields.company, kind: 'text' });
  }
  if (fields.location) {
    list.push({ label: '^location|^местоположение', value: fields.location, kind: 'text' });
  }
  if (fields.description) {
    list.push({ label: '^description|^описание', value: fields.description, kind: 'text' });
  }
  if ('current' in fields) {
    list.push({ label: 'currently work|сейчас работаю|в настоящее время', value: fields.current, kind: 'checkbox' });
  }
  if (fields.start) {
    if (month(fields.start)) {
      list.push({ label: '^start month|^месяц начала', value: month(fields.start), kind: 'select' });
    }
    list.push({ label: '^start year|^год начала', value: fields.start.slice(0, 4), kind: 'select' });
  }
  if (fields.end && !fields.current) {
    if (month(fields.end)) {
      list.push({ label: '^end month|^месяц окончания', value: month(fields.end), kind: 'select' });
    }
    list.push({ label: '^end year|^год окончания', value: fields.end.slice(0, 4), kind: 'select' });
  }
  return list;
};

/**
 * Toggle the checkbox setFieldByLabel marked, with a real click on its label (or on the box)
 * @param {Object} page
 * @returns {Promise<string|null>} Why it was not toggled, or null
 */
async function toggleMarked(page) {
  const marked = page.locator('[data-hh-automation-toggle]').first();
  const id = await marked.getAttribute('id').catch(() => null);
  // Found by its id: the marker is removed below, and the box is checked again after that
  const box = id ? page.locator(`[id="${id}"]`).first() : marked;
  const label = id ? page.locator(`label[for="${id}"]`).first() : null;
  const before = await box.isChecked().catch(() => null);
  if (label && await label.isVisible().catch(() => false)) {
    await label.click().catch(() => {});
  } else {
    await box.click({ force: true }).catch(() => {});
  }
  await sleep(300);
  const after = await box.isChecked().catch(() => before);
  await box.evaluate((element) => element.removeAttribute('data-hh-automation-toggle')).catch(() => {});
  return after === before ? 'the checkbox did not change' : null;
}

/**
 * Add skills to the open position form from the skill picker: each skill is typed and the
 * suggestion that is exactly it is chosen. A profile at LinkedIn's 100-skill limit only takes
 * skills already in its Skills section; the others are left for the user
 * @param {Object} page
 * @param {string[]} skills
 * @returns {Promise<{added: string[], missing: string[]}>}
 */
export async function addLinkedInSkills(page, skills) {
  const added = [];
  const missing = [];
  const input = page.locator('input[placeholder^="Skill"], input[placeholder^="Навык"]').first();
  for (const skill of skills) {
    if (!await input.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /^(Add skill|Добавить навык)$/ }).first().click().catch(() => {});
    }
    if (!await input.isVisible().catch(() => false)) {
      missing.push(skill);
      continue;
    }
    await input.fill(skill);
    await sleep(2000);
    const option = page.getByRole('option', { name: skill, exact: true }).first();
    if (await option.isVisible().catch(() => false)) {
      await option.click().catch(() => {});
      await sleep(800);
    }
    // A chosen skill shows as a checked chip; a skill outside the profile's Skills section is not taken
    const chosen = await page.evaluate((name) => [...document.querySelectorAll('input[type="checkbox"]')]
      .some((box) => box.checked && box.labels?.[0]?.innerText.trim().toLowerCase() === name.toLowerCase()), skill).catch(() => false);
    if (chosen) {
      added.push(skill);
    } else {
      if (await input.isVisible().catch(() => false)) {
        await input.fill('');
      }
      missing.push(skill);
    }
  }
  await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
  return { added, missing };
}

/**
 * Add a link to the open position form's Media (e.g. the company website), titled as given.
 * Typed like a person: LinkedIn's form breaks on a pasted link or title. Skipped when the form
 * already has a media item with this title
 * @param {Object} page
 * @param {{url: string, title: string}} link
 * @returns {Promise<string>} '' when added or already there, else what went wrong
 */
export async function addLinkedInMedia(page, { url, title }) {
  const existing = page.locator('dialog[open], [role="dialog"]').getByText(title, { exact: true });
  if (await existing.count().catch(() => 0) > 0) {
    return '';
  }
  const linkItem = page.getByRole('menuitem', { name: /^(Add a link|Добавить ссылку)$/ });
  for (let attempt = 0; attempt < 5 && !await linkItem.isVisible().catch(() => false); attempt++) {
    await page.getByRole('button', { name: /^(Add media|Добавить медиа\p{L}*)$/u }).first().click().catch(() => {});
    await sleep(1500);
  }
  if (!await linkItem.isVisible().catch(() => false)) {
    return 'no «Add media» → «Add a link» in the form';
  }
  await linkItem.click();
  const input = page.locator('input[aria-label^="Paste or type a link"], input[aria-label*="ссылк"]').first();
  await input.pressSequentially(url, { delay: 30 });
  await page.getByRole('button', { name: /^(Add|Добавить)$/ }).first().click();
  const titleInput = page.getByLabel(/^(Title|Название)\*?$/).first();
  if (!await titleInput.waitFor({ timeout: 20000 }).then(() => true, () => false)) {
    await page.getByRole('button', { name: /^(Back|Назад)$/ }).first().click().catch(() => {});
    return `LinkedIn could not preview ${url}`;
  }
  await sleep(1000);
  await titleInput.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(title, { delay: 30 });
  await sleep(500);
  await page.getByRole('button', { name: /^(Save|Сохранить)$/ }).last().click();
  await sleep(3000);
  return await existing.count().catch(() => 0) > 0 ? '' : `the link ${url} did not show in Media`;
}

/**
 * Close the suggestion list a typed field opened, the way a person does: the suggestion that is
 * exactly the typed value is chosen, else the form's heading is clicked; no field is left focused
 * @param {Object} page
 * @param {string} [value] - The value just typed
 */
export async function closeSuggestions(page, value) {
  const listbox = page.locator('[role="listbox"]:visible').first();
  if (value && await listbox.isVisible().catch(() => false)) {
    const option = listbox.getByRole('option', { name: String(value), exact: true }).first();
    if (await option.isVisible().catch(() => false)) {
      await option.click().catch(() => {});
    }
  }
  if (await listbox.isVisible().catch(() => false)) {
    await page.locator('h2:visible').first().click().catch(() => {});
  }
  await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
}

/**
 * Open LinkedIn's position form (the position's edit form, or a new one) and prefill it.
 * Skills are picked from the profile's skills, and the company website is added as a media link
 * @param {Object} page
 * @param {Object} change - Of planSync
 * @param {Object} [options]
 * @param {string} [options.profileUrl=LINKEDIN_PROFILE]
 * @returns {Promise<string[]>} Notes: fields that could not be set
 */
export async function prefillLinkedInPosition(page, change, { profileUrl = LINKEDIN_PROFILE, port = 9350 } = {}) {
  const url = change.target?.editUrl ?? `${profileUrl.replace(/\/+$/, '')}/add-edit/POSITION/`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForLinkedInLogin(page, { url, port });
  await page.waitForSelector('[role="dialog"] input, form input, input[placeholder="Role title"]', { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const notes = [];
  // Saving a change is not news for the network: «Notify network» is switched off
  const notifyOff = await page.evaluate(() => {
    const toggle = [...document.querySelectorAll('[role="switch"]')].find((element) => /notify your network|уведом/i.test(element.getAttribute('aria-label') ?? element.parentElement?.innerText ?? ''));
    if (toggle?.getAttribute('aria-checked') === 'true') {
      toggle.click();
      return true;
    }
    return false;
  }).catch(() => false);
  if (notifyOff) {
    notes.push('LinkedIn: «Notify network» switched off');
  }
  for (const field of fieldsOfLinkedIn(change.fields)) {
    let problem = await page.evaluate(setFieldByLabel, field).catch((error) => error.message.split('\n')[0]);
    if (problem === 'toggle') {
      problem = await toggleMarked(page);
    }
    if (problem) {
      notes.push(`LinkedIn: ${problem}`);
    }
    // Unchecking «currently working» shows the end date fields
    if (field.kind === 'checkbox') {
      await sleep(700);
    }
    // A typed title, company or place opens LinkedIn's suggestions
    if (field.kind === 'text' && !problem) {
      await sleep(800);
      await closeSuggestions(page, field.value);
    }
  }
  await closeSuggestions(page);
  if (change.fields.skills?.length) {
    const { added, missing } = await addLinkedInSkills(page, change.fields.skills);
    if (added.length) {
      notes.push(`LinkedIn: skills added: ${added.join(', ')}`);
    }
    if (missing.length) {
      notes.push(`LinkedIn: not among the profile's skills (LinkedIn allows 100), add them yourself if needed: ${missing.join(', ')}`);
    }
  }
  if (change.fields.website) {
    const title = change.target?.company ?? change.fields.company ?? change.source?.company ?? '';
    const problem = await addLinkedInMedia(page, { url: change.fields.website, title });
    notes.push(problem ? `LinkedIn: ${problem}` : `LinkedIn: media link ${change.fields.website} («${title}»)`);
  }
  return notes;
}

/** Fields each site's form takes from a change; the rest (e.g. hh.ru per-job skills) are notes */
const FILLABLE = {
  linkedin: ['title', 'company', 'location', 'description', 'start', 'end', 'current', 'skills'],
  hh: ['title', 'company', 'description', 'start', 'end', 'current'],
};

/**
 * Whether a change sets anything in the target site's form (else it is only notes for the user)
 * @param {Object} change - Of planSync
 * @param {'linkedin'|'hh'} site
 * @returns {boolean}
 */
export const hasFillableFields = (change, site) => Object.keys(change.fields).some((field) => FILLABLE[site].includes(field));

/**
 * Save LinkedIn's open position form (only after the user's `y`), then wait for the dialog to close
 * @param {Object} page
 */
export async function saveLinkedInPosition(page) {
  const saveBtn = page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Сохранить")').first();
  await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveBtn.click();
  // Wait for the dialog to close after a successful save
  await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
}

const HH = {
  experienceCard: '[data-qa="profile-experience-company-card"]',
  editButton: '[data-qa^="edit-experience-button-"]',
  company: 'input[name="company"]',
  position: 'input[name="position"]',
  startYear: '[data-qa="resume-editor-experience-start-year-input"]',
  endYear: '[data-qa="resume-editor-experience-end-year-input"]',
  present: '[data-qa="resume-editor-experience-present-checkbox"]',
  description: '[data-qa="resume-editor-experience-description-input"]',
  monthSelect: '[data-qa="magritte-select-activator"]',
  save: '[data-qa="profile-layout-save-button"]',
  cancel: '[data-qa="profile-layout-cancel-button"]',
};

/**
 * Runs in the page: click the edit button of the hh.ru experience card of a company and title
 * (cards hold "company / duration / title / period"), after expanding the list
 * @param {{company: string, title: string, editButton: string, card: string}} target
 * @returns {boolean}
 */
export function clickHhExperienceEdit({ company, title, editButton, card }) {
  const norm = (text) => String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const cards = [...document.querySelectorAll(card)];
  const match = cards.find((element) => norm(element.innerText).includes(norm(company)) && norm(element.innerText).includes(norm(title))) ??
    cards.find((element) => norm(element.innerText).includes(norm(company)));
  const button = match?.querySelector(editButton) ?? match?.parentElement?.querySelector(editButton);
  button?.click();
  return Boolean(button);
}

/**
 * Open hh.ru's form for a job of the resume (its edit form, or a new one) and prefill it
 * @param {Object} page
 * @param {Object} change - Of planSync
 * @param {Object} options
 * @param {string} options.resumeHash
 * @returns {Promise<string[]>} Notes: fields that could not be set
 */
export async function prefillHhExperience(page, change, { resumeHash }) {
  const notes = [];
  await page.goto(`https://hh.ru/resume/${resumeHash}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // While hh.ru shows a captcha nothing is touched: the user solves it in the slot
  if (!await waitForCaptcha(page, console.log)) {
    return ['hh.ru: the captcha was not solved, nothing prefilled'];
  }
  await page.waitForSelector(HH.experienceCard, { timeout: 30000 }).catch(() => {});
  // The list shows the latest jobs until it is expanded
  await page.evaluate(() => [...document.querySelectorAll('[data-qa="resume-list-card-experience"] button')]
    .filter((button) => /развернуть|показать (все|ещё)/i.test(button.innerText)).forEach((button) => button.click()));
  await sleep(1000);
  if (change.kind === 'update') {
    const found = await page.evaluate(clickHhExperienceEdit, {
      company: change.target.company, title: change.target.title, editButton: HH.editButton, card: HH.experienceCard,
    });
    if (!found) {
      return [`hh.ru: no experience card of ${change.target.company} found on the resume page`];
    }
  } else {
    const added = await page.evaluate(() => {
      const button = [...document.querySelectorAll('[data-qa="resume-list-card-experience"] button, [data-qa="resume-list-card-experience"] a')]
        .find((element) => /^добавить/i.test(element.innerText.trim()));
      button?.click();
      return Boolean(button);
    });
    if (!added) {
      return ['hh.ru: the «Добавить» button of the experience list was not found'];
    }
  }
  await page.waitForSelector(HH.position, { timeout: 30000 }).catch(() => notes.push('hh.ru: the experience form did not open'));
  await sleep(1000);
  const fill = async (selector, value) => {
    const field = page.locator(selector).first();
    if (await field.count() === 0) {
      notes.push(`hh.ru: no field ${selector}`);
      return;
    }
    await field.fill(String(value));
  };
  const { fields } = change;
  if (fields.company && change.kind === 'add') {
    await fill(HH.company, fields.company);
  }
  if (fields.title) {
    await fill(HH.position, fields.title);
  }
  if (fields.description) {
    await fill(HH.description, fields.description);
  }
  if (fields.start) {
    await fill(HH.startYear, fields.start.slice(0, 4));
    await chooseHhMonth(page, 0, fields.start, notes);
  }
  if ('current' in fields) {
    const present = page.locator(HH.present).first();
    if (await present.count() > 0 && await present.isChecked() !== Boolean(fields.current)) {
      await present.click({ force: true });
    }
  }
  if (fields.end && !fields.current) {
    await fill(HH.endYear, fields.end.slice(0, 4));
    await chooseHhMonth(page, 1, fields.end, notes);
  }
  if (fields.skills?.length) {
    notes.push(`hh.ru: skills are kept for the whole resume («Навыки»), check that it has: ${fields.skills.join(', ')}`);
  }
  if (change.kind === 'add') {
    notes.push('hh.ru: fill «Город или регион» and the industry of the new job yourself if hh.ru asks for them');
  }
  return notes;
}

/** Choose the month of hh.ru's start (0) or end (1) date in its custom select */
async function chooseHhMonth(page, index, date, notes) {
  if (!date.includes('-')) {
    return;
  }
  const name = formatMonthYear(date, 'ru').split(' ')[0];
  // The visible trigger shows "Месяц" and the chosen month; its combobox input is hidden
  const trigger = page.locator(`${HH.monthSelect}:visible`).filter({ hasText: /^\s*Месяц/ }).nth(index);
  if (await trigger.count() === 0) {
    notes.push(`hh.ru: set the ${index === 0 ? 'start' : 'end'} month (${name}) yourself`);
    return;
  }
  const current = await trigger.locator('[data-qa="trigger-values-wrapper"]').innerText().catch(() => '');
  if (current.trim().toLowerCase() === name.toLowerCase()) {
    return;
  }
  await trigger.click();
  const option = page.getByRole('option', { name, exact: true }).first();
  if (await option.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await option.click();
  } else {
    await page.keyboard.press('Escape');
    notes.push(`hh.ru: set the ${index === 0 ? 'start' : 'end'} month (${name}) yourself`);
  }
}

/**
 * Save hh.ru's open experience form (only after the user's `y`), then wait for it to close
 * @param {Object} page
 */
export async function saveHhExperience(page) {
  const saveBtn = page.locator(HH.save).first();
  await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
  await saveBtn.click();
  // Wait for the form to close: the position input disappears after a successful save
  await page.waitForSelector(HH.position, { state: 'detached', timeout: 15000 }).catch(() => {});
}

/**
 * Leave hh.ru's experience form without saving: «Отменить», then «Не надо» in hh.ru's
 * «Сохранить изменения?» question
 * @param {Object} page
 */
export async function discardHhExperience(page) {
  await page.locator(HH.cancel).first().click().catch(() => {});
  const discard = page.getByRole('button', { name: 'Не надо', exact: true });
  if (await discard.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await discard.click();
  }
}

/**
 * Close LinkedIn's position form without saving (Escape, then "Discard" when it asks)
 * @param {Object} page
 */
export async function discardLinkedInPosition(page) {
  await page.keyboard.press('Escape').catch(() => {});
  // The form opened as its own page does not close on Escape: its close button does
  const close = page.locator('button[aria-label="Dismiss"], button[aria-label="Закрыть"]').first();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
  }
  const discard = page.locator('button:has-text("Discard"), button:has-text("Отменить изменения")').first();
  if (await discard.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    await discard.click();
  }
}
