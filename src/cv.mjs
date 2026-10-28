/**
 * The resume (CV) as an indented .lino file, one per language, easy to read and to compare side
 * by side (examples/cv.ru.lino, examples/cv.en.lino), and the changes that bring an hh.ru resume
 * in line with such a file. Pure functions: the browsers live in cv-sync.mjs.
 *
 * resume
 *   language ru
 *   title 'Программист/Разработчик/Руководитель'
 *   skills
 *     'PHP'
 *   about
 *     'A line of the text'
 *     ' '                      (an empty line)
 *   jobs
 *     job
 *       company 'ООО "ЕВИРМА"'
 *       position 'Tech Lead'
 *       start 2026-05
 *       end present
 *       description
 *         'A line of the text'
 *
 * @module cv
 */

import { Parser } from 'links-notation';
import { companySimilarity, detectLanguage, parsePeriod } from './experience.mjs';

/** hh.ru's export puts the heading of «Обо мне» into its text */
const ABOUT_HEADING = /^(обо мне|about me|about)\s*\n+/i;

/**
 * A text as a quoted .lino value: in the quote it does not hold (', ", `), else with ' doubled
 * @param {string} text
 * @returns {string}
 */
export function quoteLino(text) {
  const value = String(text ?? '');
  const quote = ["'", '"', '`'].find((mark) => !value.includes(mark));
  return quote ? `${quote}${value}${quote}` : `'${value.replace(/'/g, "''")}'`;
}

/** A text as the lines of an indented block; an empty line as ' ' (an empty quote would read as an escaped one) */
const textLines = (text, indent) => String(text ?? '').trim().split('\n')
  .map((line) => `${indent}${line.trim() ? quoteLino(line.trimEnd()) : "' '"}`);

/** Lines trimmed, runs of empty lines as one: texts that differ only in spacing are the same */
export const normalizeText = (text) => String(text ?? '').split('\n').map((line) => line.trim()).join('\n')
  .replace(/\n{3,}/g, '\n\n').trim();

/**
 * The language of an export of `bun run resume`: hh.ru names its labels in the resume's language
 * @param {Object} resume - resume.json
 * @returns {'ru'|'en'}
 */
export function resumeLanguage(resume) {
  if (/^resume updated|^updated/i.test(resume?.updated ?? '')) {
    return 'en';
  }
  if (/^резюме обновлено/i.test(resume?.updated ?? '')) {
    return 'ru';
  }
  return detectLanguage(`${resume?.title ?? ''} ${(resume?.jobs ?? []).map((job) => job.position).join(' ')}`);
}

/**
 * A resume of `bun run resume` (resume.json) as a CV: no contacts, no hash, no dates of the export
 * @param {Object} resume
 * @returns {{language: string, title: string, name: string, skills: string[], about: string, jobs: Object[]}}
 */
export function resumeToCv(resume) {
  return {
    language: resumeLanguage(resume),
    title: String(resume.title ?? '').trim(),
    name: String(resume.name ?? '').trim(),
    skills: (resume.keySkills ?? []).map((skill) => String(skill).trim()).filter(Boolean),
    about: normalizeText(String(resume.about ?? '').trim().replace(ABOUT_HEADING, '')),
    jobs: (resume.jobs ?? []).map((job) => {
      const { start, end, current } = parsePeriod(job.period);
      return {
        company: String(job.company ?? '').trim(),
        position: String(job.position ?? '').trim(),
        start,
        end: current ? null : end,
        description: normalizeText(job.description),
      };
    }),
  };
}

/**
 * The CV as an indented .lino file
 * @param {Object} cv - Of resumeToCv
 * @returns {string}
 */
export function formatCvLino(cv) {
  const lines = ['resume', `  language ${cv.language}`];
  if (cv.name) {
    lines.push(`  name ${quoteLino(cv.name)}`);
  }
  lines.push(`  title ${quoteLino(cv.title)}`);
  if (cv.skills.length > 0) {
    lines.push('  skills', ...cv.skills.map((skill) => `    ${quoteLino(skill)}`));
  }
  if (cv.about) {
    lines.push('  about', ...textLines(cv.about, '    '));
  }
  lines.push('  jobs');
  for (const job of cv.jobs) {
    lines.push('    job', `      company ${quoteLino(job.company)}`, `      position ${quoteLino(job.position)}`);
    if (job.start) {
      lines.push(`      start ${job.start}`);
    }
    lines.push(`      end ${job.end ?? 'present'}`);
    if (job.description) {
      lines.push('      description', ...textLines(job.description, '        '));
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The ids of a parsed line: ['company', 'ООО "ЕВИРМА"'] */
const idsOf = (group) => (group.element?.values ?? []).map((value) => value.id ?? '');

/** The text of a block of quoted lines (' ' is an empty line) */
const blockText = (group) => (group.children ?? []).map((child) => idsOf(child).join(' ').trim()).join('\n').trim();

/**
 * Read a CV .lino file (of formatCvLino; hand edits welcome)
 * @param {string} text
 * @returns {Object} As resumeToCv returns
 */
export function parseCvLino(text) {
  const [root] = new Parser().parseGroups(String(text));
  if (!root || idsOf(root)[0] !== 'resume') {
    throw new Error('A CV file starts with the line "resume"');
  }
  const cv = { language: '', title: '', name: '', skills: [], about: '', jobs: [] };
  for (const group of root.children ?? []) {
    const [key, ...values] = idsOf(group);
    const value = values.join(' ').trim();
    if (key === 'skills') {
      cv.skills = (group.children ?? []).map((child) => idsOf(child).join(' ').trim()).filter(Boolean);
    } else if (key === 'about') {
      cv.about = blockText(group);
    } else if (key === 'jobs') {
      cv.jobs = (group.children ?? []).map((jobGroup) => {
        const job = { company: '', position: '', start: null, end: null, description: '' };
        for (const field of jobGroup.children ?? []) {
          const [name, ...rest] = idsOf(field);
          const fieldValue = rest.join(' ').trim();
          if (name === 'description') {
            job.description = blockText(field);
          } else if (name === 'end') {
            job.end = /^(present|now|настоящее время)$/i.test(fieldValue) || !fieldValue ? null : fieldValue;
          } else if (name in job) {
            job[name] = fieldValue || null;
          }
        }
        return job;
      });
    } else if (['language', 'title', 'name'].includes(key)) {
      cv[key] = value;
    }
  }
  return cv;
}

const sameText = (a, b) => normalizeText(a) === normalizeText(b);
const listDiff = (from, to) => {
  const has = new Set(to.map((item) => item.toLowerCase()));
  return from.filter((item) => !has.has(item.toLowerCase()));
};

/** The jobs of two CVs paired: same company and start first, then the same company */
function pairJobs(current, wanted) {
  const left = [...current];
  const pairs = [];
  const added = [];
  for (const job of wanted) {
    const index = [
      // A language-specific copy can coexist with the old shared record until its next
      // reviewed save. Pair the exact saved copy first rather than overwriting either one.
      left.findIndex((item) => companySimilarity(item.company, job.company) === 1 && item.start === job.start &&
        item.end === job.end && item.position === job.position && sameText(item.description, job.description)),
      left.findIndex((item) => companySimilarity(item.company, job.company) === 1 && item.start === job.start &&
        item.position === job.position && detectLanguage(item.description) === detectLanguage(job.description)),
      left.findIndex((item) => companySimilarity(item.company, job.company) === 1 && item.start === job.start),
      left.findIndex((item) => companySimilarity(item.company, job.company) === 1),
    ].find((found) => found >= 0);
    if (index === undefined) {
      added.push(job);
    } else {
      pairs.push({ current: left[index], wanted: job });
      left.splice(index, 1);
    }
  }
  return { pairs, added, removed: left };
}

/**
 * The changes that bring an hh.ru resume (current) in line with a CV file (wanted), in the shape
 * prefillHhExperience takes, and notes for what is edited elsewhere on hh.ru
 * @param {Object} current - resumeToCv of a fresh export
 * @param {Object} wanted - parseCvLino of the file
 * @returns {{changes: Object[], notes: string[]}}
 */
export function planCvImport(current, wanted, { detachExtra = false } = {}) {
  const { pairs, added, removed } = pairJobs(current.jobs, wanted.jobs);
  const changes = [];
  for (const pair of pairs) {
    const fields = {};
    if (pair.current.position !== pair.wanted.position) {
      fields.title = pair.wanted.position;
    }
    if (pair.current.start !== pair.wanted.start || pair.current.end !== pair.wanted.end) {
      Object.assign(fields, { start: pair.wanted.start, end: pair.wanted.end, current: !pair.wanted.end });
    }
    if (!sameText(pair.current.description, pair.wanted.description)) {
      fields.description = pair.wanted.description;
    }
    if (Object.keys(fields).length > 0) {
      changes.push({
        kind: 'update', target: { company: pair.current.company, title: pair.current.position, description: pair.current.description }, source: pair.wanted, fields, notes: [],
      });
    }
  }
  for (const job of added) {
    changes.push({
      kind: 'add',
      target: null,
      source: job,
      fields: { company: job.company, title: job.position, start: job.start, end: job.end, current: !job.end, description: job.description },
      notes: [],
    });
  }
  // Detaching changes this resume's selection; it never deletes the profile's workplace.
  if (detachExtra) {
    removed.forEach((job) => changes.push({ kind: 'detach', target: { company: job.company, title: job.position, description: job.description }, fields: {}, source: job, notes: [] }));
  }
  const notes = detachExtra ? [] : removed.map((job) => `${job.company} (${job.position}) is on hh.ru but not in the file: remove it there yourself if it should go`);
  if (wanted.title && current.title !== wanted.title) {
    notes.push(`The resume's title on hh.ru is «${current.title}», the file has «${wanted.title}»: change it in the resume's «Желаемая должность»`);
  }
  const missingSkills = listDiff(wanted.skills, current.skills);
  const extraSkills = listDiff(current.skills, wanted.skills);
  if (missingSkills.length > 0) {
    notes.push(`«Навыки» on hh.ru lack: ${missingSkills.join(', ')}`);
  }
  if (extraSkills.length > 0) {
    notes.push(`«Навыки» on hh.ru have, the file does not: ${extraSkills.join(', ')}`);
  }
  if (wanted.about && !sameText(current.about, wanted.about)) {
    changes.push({ kind: 'about', target: { about: current.about }, fields: { about: wanted.about }, source: wanted, notes: [] });
  }
  return { changes, notes };
}

/**
 * One change for people: the job and the fields it sets
 * @param {Object} change - Of planCvImport
 * @returns {string}
 */
export function formatCvChange(change) {
  if (change.kind === 'about') return `✏️  About me: ${change.fields.about.length} characters, reviewed Save required`;
  const job = change.kind === 'add' ? change.fields : change.target;
  const lines = [`${change.kind === 'detach' ? '↪️  Deselect from this resume' : change.kind === 'add' ? '➕ New job' : '✏️  Update'}: ${job.company} (${job.title})`];
  const { fields } = change;
  if (fields.title && change.kind === 'update') {
    lines.push(`   position: «${change.target.title}» → «${fields.title}»`);
  }
  if ('current' in fields) {
    lines.push(`   period: ${fields.start ?? '?'} — ${fields.end ?? 'present'}`);
  }
  if (fields.description) {
    lines.push(`   description: ${fields.description.split('\n').length} line(s), from «${fields.description.slice(0, 60).replace(/\n/g, ' ')}…»`);
  }
  return lines.join('\n');
}

/**
 * The hh.ru resume a CV file goes to: the one of the hash, else the one with its title, else the
 * only one in its language
 * @param {Array<{hash: string, cv: Object}>} resumes - Exported
 * @param {Object} wanted - parseCvLino of the file
 * @param {string} [hash]
 * @returns {{hash: string, cv: Object}|null}
 */
export function pickResumeFor(resumes, wanted, hash = '') {
  if (hash) {
    return resumes.find((resume) => resume.hash === hash) ?? null;
  }
  const sameLanguage = resumes.filter((resume) => resume.cv.language === wanted.language);
  return resumes.find((resume) => resume.cv.title === wanted.title) ?? (sameLanguage.length === 1 ? sameLanguage[0] : null);
}

const PRIVATE = [
  ['an email address', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
  ['a phone number', /\+?\d[\d\s()-]{9,}\d/],
  ['a Telegram link', /t\.me\/|telegram\.me\//i],
  ['a birth date', /дата рождения|родил(ся|ась)|date of birth|\bborn\b/i],
  ['a salary', /желаемая зарплата|desired salary|\d[\d\s]*\s?(₽|руб|\$|usd|eur)/i],
];

/**
 * What of the private details (contacts, birth date, salary) a CV text holds: the kinds, never the values
 * @param {string} text
 * @returns {string[]}
 */
export const privateDetails = (text) => PRIVATE.filter(([, pattern]) => pattern.test(String(text))).map(([kind]) => kind);
