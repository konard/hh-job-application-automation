/**
 * Prefill external application forms (Google Forms, a company's own job form) from what is
 * already known: contact details from the exported resume, answers saved in qa.lino, and for the
 * rest drafts written by local Claude Code from the resume and the saved answers. Nothing is ever
 * submitted: the form is left open for the user to review, change and send.
 *
 * @module form-prefill
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import { findBestMatch } from './qa-database.mjs';
import { answerText, findMatchingOption } from './qa.mjs';

/** Placeholder a draft uses where only the user knows the fact */
export const TO_CHECK = 'уточнить';

/**
 * Contact details from the exported resume (data/resume/resume.md, written by `bun run resume`)
 * @param {string} markdown
 * @returns {Object<string, string|string[]>}
 */
export function parseResumeProfile(markdown) {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean);
  const fullName = lines.find((line) => /^[А-ЯЁ][а-яё-]+ [А-ЯЁ][а-яё-]+( [А-ЯЁ][а-яё-]+)?$/.test(line)) ?? '';
  const [lastName = '', firstName = '', middleName = ''] = fullName.split(' ');
  const phone = markdown.match(/\+\d[\d\s()-]{9,}\d/)?.[0].replace(/[\s()-]/g, '') ?? '';
  const email = markdown.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? '';
  const telegram = markdown.match(/telegram:\s*(@\w+)/i)?.[1] ?? markdown.match(/(@\w{4,})/)?.[1] ?? '';
  const github = markdown.match(/https:\/\/github\.com\/[\w-]+/)?.[0] ?? '';
  const city = markdown.match(/Проживает:\s*([^\n]+)/)?.[1].trim() ?? '';
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const born = markdown.match(/родил(?:ся|ась)\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  const month = born ? MONTHS.indexOf(born[2].toLowerCase()) + 1 : 0;
  const birthDate = month > 0 ? `${born[1].padStart(2, '0')}.${String(month).padStart(2, '0')}.${born[3]}` : '';
  return { fullName, firstName, lastName, middleName, phone, email, telegram, github, city, birthDate };
}

/** Phone as people write it: +7 958 200-05-67 */
export function formatPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11
    ? `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
    : phone;
}

// What a contact question asks for, in the order the values are written
const CONTACT_PARTS = [
  { key: 'name', test: /фио|имя|фамили|full name|\bname\b/i },
  { key: 'birthDate', test: /дата рождения|date of birth|birth ?date/i },
  { key: 'phone', test: /телефон|phone|номер для связи|whatsapp/i },
  { key: 'telegram', test: /telegram|телеграм|\bтг\b|\btg\b/i },
  { key: 'email', test: /e-?mail|почт/i },
  { key: 'links', test: /резюме|\bcv\b|портфолио|профессиональный профиль|linkedin|github|гитхаб/i },
  { key: 'city', test: /город|локаци|страна прожив|где вы (находитесь|живете|проживаете)|location|\bcity\b/i },
];

/**
 * The links a question asks for: a named site (LinkedIn, GitHub) only its own links, "резюме"
 * alone the resume, otherwise all of them
 * @param {string} title
 * @param {string[]} links
 * @returns {string[]}
 */
export function linksFor(title, links) {
  if (/linkedin/i.test(title)) {
    return links.filter((link) => /linkedin\.com/i.test(link));
  }
  if (/github|гитхаб|репозитори/i.test(title)) {
    return links.filter((link) => /github\.com/i.test(link));
  }
  if (/резюме|\bcv\b/i.test(title) && !/портфолио|профил|github|гитхаб/i.test(title)) {
    return links.filter((link) => /\/resume\//i.test(link)).slice(0, 1);
  }
  return links;
}

/**
 * The answer to a contact question (name, phone, Telegram, email, resume links, city), or null.
 * Questions longer than a contact question ("Опишите проект…") are not contact questions
 * @param {string} title - Question title
 * @param {Object} profile - parseResumeProfile() plus links
 * @returns {{answer: string, missing: string[]}|null}
 */
export function contactAnswer(title, profile) {
  if (title.length > 160) {
    return null;
  }
  const parts = CONTACT_PARTS.filter(({ test }) => test.test(title));
  if (parts.length === 0) {
    return null;
  }
  const missing = [];
  const values = parts.map(({ key }) => {
    let value;
    if (key === 'name') {
      if (/фамили/i.test(title) && !/имя|фио/i.test(title)) {
        value = profile.lastName;
      } else if (/фио/i.test(title)) {
        value = profile.fullName;
      } else if (parts.length === 1 && !/фамили/i.test(title)) {
        value = profile.firstName;
      } else {
        value = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
      }
    } else if (key === 'phone') {
      value = profile.phone && formatPhone(profile.phone);
    } else if (key === 'telegram') {
      value = profile.telegram && (parts.length > 1 ? `Telegram: ${profile.telegram}` : profile.telegram);
    } else if (key === 'links') {
      value = linksFor(title, profile.links ?? []).join(parts.length > 1 ? ', ' : '\n');
    } else {
      value = profile[key];
    }
    if (!value) {
      missing.push(key);
    }
    return value;
  }).filter(Boolean);
  return values.length > 0 ? { answer: values.join(', '), missing } : null;
}

/**
 * The options of a choice question that a saved answer names, matched as on hh.ru forms
 * @param {string[]} options
 * @param {string|string[]} saved
 * @returns {string[]}
 */
export function pickOptions(options, saved) {
  const items = options.map((optionText) => ({ optionText }));
  const picked = [saved].flat().map((answer) => findMatchingOption(items, answer)?.optionText).filter(Boolean);
  return [...new Set(picked)];
}

/**
 * Decide the answers that are known without a draft
 * @param {Array<{id: string, kind: string, title: string, options?: string[]}>} fields
 * @param {Object} sources
 * @param {Object} sources.profile
 * @param {Map<string, string|string[]>} sources.qaMap
 * @returns {Array<Object>} The fields with {answer|choices, source, note} or {open: true}
 */
export function planAnswers(fields, { profile, qaMap }) {
  return fields.map((field) => {
    if (field.kind === 'file') {
      return /резюме|\bcv\b/i.test(field.title) && profile.resumeFile
        ? { ...field, file: profile.resumeFile, source: 'resume file' }
        : { ...field, open: true, note: 'file' };
    }
    const isChoice = field.kind === 'radio' || field.kind === 'checkbox' || field.kind === 'select';
    if (!isChoice) {
      const contact = contactAnswer(field.title, profile);
      if (contact) {
        return { ...field, answer: contact.answer, source: 'profile', note: contact.missing.length ? `no ${contact.missing.join(', ')} in the profile` : '' };
      }
    }
    let match = findBestMatch(field.title, qaMap);
    // A question asking for a link takes only a saved answer with a link
    if (match && /ссылк|\blink\b|\burl\b/i.test(field.title) && !/https?:\/\/|www\.|\w\.(ru|com|io|org|me)\b/i.test(answerText(match.answer))) {
      match = null;
    }
    if (match) {
      if (isChoice) {
        const choices = pickOptions(field.options ?? [], match.answer);
        if (choices.length > 0) {
          return { ...field, choices, source: `qa.lino ${match.score.toFixed(2)}`, matched: match.question };
        }
      } else {
        const answer = answerText(match.answer);
        return { ...field, answer, source: `qa.lino ${match.score.toFixed(2)}`, matched: match.question };
      }
    }
    return { ...field, open: true };
  });
}

/**
 * Saved Q&A pairs closest to a question, as context for a draft
 * @returns {string}
 */
export function relatedAnswers(question, qaMap, limit = 8) {
  return findBestMatch(question, qaMap, { threshold: 0, returnAll: true })
    .slice(0, limit)
    .map(({ question: saved, answer }) => `Вопрос: ${saved}\nОтвет: ${answerText(answer)}`)
    .join('\n\n');
}

/**
 * The prompt for a draft answer: only facts from the resume and the saved answers
 * @returns {string}
 */
export function draftPrompt({ form, field, resume, related }) {
  const choice = field.options?.length
    ? `\nЭто вопрос с вариантами. Ответь ТОЛЬКО точным текстом одного варианта${field.kind === 'checkbox' ? ' (или нескольких, по одному на строке)' : ''}:\n${field.options.map((option) => `- ${option}`).join('\n')}\n`
    : '';
  return `Я кандидат и заполняю анкету работодателя. Напиши мой ответ на один вопрос анкеты, от первого лица, на русском.
Используй ТОЛЬКО факты из моего резюме и моих прошлых ответов ниже. Ничего не выдумывай: где нужного факта нет (цифры, даты, названия, ссылки),
поставь пометку «[${TO_CHECK}: что именно]», я заполню сам. Пиши по делу, без вступлений и без повторения вопроса.
Выведи только текст ответа.

Анкета: ${form.title}
${form.description ? `Описание анкеты: ${form.description}\n` : ''}
Вопрос: ${field.title}
${field.description ? `Пояснение к вопросу: ${field.description}\n` : ''}${choice}
=== Моё резюме ===
${resume}

=== Мои прошлые ответы на похожие вопросы ===
${related || '(нет)'}
`;
}

/**
 * Draft an answer with local Claude Code (claude -p), which only reads the prompt
 * @param {string} prompt
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=240000]
 * @returns {Promise<string|null>}
 */
export function askClaude(prompt, { timeoutMs = 240000 } = {}) {
  return new Promise((resolve) => {
    // Outside the repository, so only the prompt is its context
    const child = spawn('claude', ['-p', '--output-format', 'text', '--allowedTools', ''], { stdio: ['pipe', 'pipe', 'pipe'], cwd: os.tmpdir() });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && output.trim() ? output.trim() : null);
    });
    child.stdin.end(prompt);
  });
}

/**
 * Runs in the page: the form's questions, each with its controls marked by data-prefill-id
 * (an attribute, nothing visible). Works with Google Forms (aria-labelledby, role=radio) and
 * plain forms (label, legend, placeholder)
 * @returns {{title: string, description: string, fields: Array<Object>, hasNextPage: boolean}}
 */
export function readFormFields() {
  const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const textOf = (element) => clean(element?.innerText ?? element?.textContent);
  const GENERIC = /^(мой ответ|your answer|ответ|введите (текст|ответ)|выберите|choose)$/i;
  const byIds = (ids) => (ids ?? '').split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean);
  const shown = (element) => element.type === 'file' || element.getClientRects().length > 0;
  const tidy = (title) => clean(title).replace(/^\d+\.\s*/, '').replace(/\s*\*$/, '');

  const labelOf = (element) => {
    const labelled = byIds(element.getAttribute('aria-labelledby'));
    if (labelled.length > 0) {
      return { title: labelled[0], description: labelled.slice(1).join(' ') };
    }
    const forLabel = element.id && document.querySelector(`label[for="${window.CSS.escape(element.id)}"]`);
    const label = textOf(forLabel) || textOf(element.closest('label'));
    if (label) {
      return { title: label, description: '' };
    }
    const aria = clean(element.getAttribute('aria-label'));
    if (aria && !GENERIC.test(aria)) {
      return { title: aria, description: '' };
    }
    // The nearest container with a heading or label that is not this control's own option
    for (let container = element.parentElement, depth = 0; container && depth < 6; container = container.parentElement, depth++) {
      const heading = container.querySelector('[role="heading"], legend, h1, h2, h3, h4, h5, label');
      if (heading && !heading.contains(element) && textOf(heading)) {
        return { title: textOf(heading), description: '' };
      }
    }
    return { title: clean(element.placeholder), description: '' };
  };

  const kindOf = (element) => {
    const role = element.getAttribute('role');
    if (role === 'radio' || element.type === 'radio') return 'radio';
    if (role === 'checkbox' || element.type === 'checkbox') return 'checkbox';
    if (element.tagName === 'SELECT' || role === 'listbox') return 'select';
    if (element.tagName === 'TEXTAREA') return 'textarea';
    if (element.type === 'file') return 'file';
    return 'text';
  };
  const optionText = (element) => clean(element.getAttribute('aria-label') || element.getAttribute('data-value') ||
    textOf(element.closest('label')) || (element.id && textOf(document.querySelector(`label[for="${window.CSS.escape(element.id)}"]`))) ||
    element.value);

  const controls = [...document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), textarea, select, [role="radio"], [role="checkbox"], [role="listbox"]',
  )].filter((element) => shown(element) && !element.disabled && !element.closest('header, footer, nav'));

  const fields = [];
  const groups = new Map();
  let next = 0;
  for (const element of controls) {
    const kind = kindOf(element);
    // A native checkbox drawn by a role=checkbox wrapper is the same control
    if (element.tagName === 'INPUT' && element.closest('[role="radio"], [role="checkbox"]')) {
      continue;
    }
    const id = `pf-${next++}`;
    element.setAttribute('data-prefill-id', id);
    if (kind === 'radio' || kind === 'checkbox') {
      const groupElement = element.closest('[role="radiogroup"], [role="group"], [role="list"], fieldset') ?? element.parentElement;
      const key = element.name || groupElement;
      if (!groups.has(key)) {
        const label = groupElement?.getAttribute('aria-labelledby') ? labelOf(groupElement)
          : groupElement?.tagName === 'FIELDSET' && groupElement.querySelector('legend')
            ? { title: textOf(groupElement.querySelector('legend')), description: '' }
            : labelOf(groupElement ?? element);
        const field = { kind, ...label, options: [], optionIds: [] };
        groups.set(key, field);
        fields.push(field);
      }
      const field = groups.get(key);
      field.options.push(optionText(element));
      field.optionIds.push(id);
      continue;
    }
    const field = { id, kind, ...labelOf(element) };
    if (kind === 'select' && element.tagName === 'SELECT') {
      field.options = [...element.options].map((option) => clean(option.text)).filter(Boolean);
    }
    field.value = element.value ?? '';
    fields.push(field);
  }
  for (const field of fields) {
    // The explanation under the title (Google Forms: the rest of the question's list item)
    const control = document.querySelector(`[data-prefill-id="${field.id ?? field.optionIds[0]}"]`);
    const item = control?.closest('[role="listitem"]');
    if (item && !field.description) {
      let rest = textOf(item);
      for (const part of [field.title, ...(field.options ?? []), 'Мой ответ', 'Your answer']) {
        rest = rest.replace(part, ' ');
      }
      field.description = clean(rest.replace(/^\s*\*\s*/, ''));
    }
    field.title = tidy(field.title);
    field.id ??= field.optionIds[0];
  }
  const nextButton = [...document.querySelectorAll('[role="button"], button')]
    .some((button) => /^(далее|next)$/i.test(textOf(button)));
  return {
    title: clean(document.querySelector('[role="heading"][aria-level="1"], h1')?.innerText ?? document.title),
    description: '',
    fields: fields.filter((field) => field.title),
    hasNextPage: nextButton,
  };
}

/**
 * Load the resume and profile for a prefill
 * @param {Object} paths
 * @returns {Promise<{profile: Object, resume: string}>}
 */
export async function loadProfile({ resumeMarkdown, resumeJson, resumeFile, coverLetter, contacts = {}, profileOverrides }) {
  const resume = await fs.readFile(resumeMarkdown, 'utf8').catch(() => '');
  const json = JSON.parse(await fs.readFile(resumeJson, 'utf8').catch(() => '{}'));
  const letter = coverLetter ? await fs.readFile(coverLetter, 'utf8').catch(() => '') : '';
  const profile = parseResumeProfile(resume);
  // The hh.ru resume, then the GitHub profiles of the resume and the cover letter
  const github = [profile.github, ...(letter.match(/(?:https:\/\/)?github\.com\/[\w-]+/g) ?? [])]
    .filter(Boolean).map((link) => (link.startsWith('http') ? link : `https://${link}`));
  const fromContacts = [contacts.linkedin, ...[contacts.github ?? []].flat()].filter(Boolean)
    .map((link) => (link.startsWith('http') ? link : `https://${link}`));
  const links = [...new Set([json.url, ...github, ...fromContacts].filter(Boolean))];
  // data/contacts.lino wins over the resume: it is the one place contacts are changed
  const known = Object.fromEntries(Object.entries({
    telegram: contacts.telegram, phone: contacts.phone, email: contacts.email, fullName: contacts.full_name,
  }).filter(([, value]) => typeof value === 'string' && value));
  const hasResumeFile = await fs.access(resumeFile).then(() => true, () => false);
  return {
    resume,
    profile: { ...profile, ...known, links, resumeFile: hasResumeFile ? resumeFile : null, ...profileOverrides },
  };
}
