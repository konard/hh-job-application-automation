/**
 * Test assignments of employers as GitHub repositories: the assignment is restated in English in
 * other words, without anything that names the employer, and becomes the first issue of a
 * repository with the name the user gives. The repository starts from the CI/CD template of the
 * language the vacancy expects (the templates recommended by link-assistant/hive-mind), and the
 * issue asks for the most fitting stack. Forms link to the repository where they ask for the
 * completed assignment.
 *
 * @module assignments
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

/** An assignment block: «Тестовое задание», «Домашнее задание», «Test task», «Test assignment» */
export const ASSIGNMENT_TITLE = /тестов\S* задани|домашн\S* задани|test (task|assignment)|take-home/i;

/** Where the repositories created for forms are remembered (logs/ stays out of git) */
export const ASSIGNMENTS_FILE = path.join(process.cwd(), 'logs', 'assignments.json');

/**
 * CI/CD templates by language, as recommended in link-assistant/hive-mind docs/CI-CD-BEST-PRACTICES.md
 * (JavaScript and TypeScript share one, and so do C and C++). A snapshot: loadTemplates() reads the
 * current table of that document and falls back to it.
 */
export const CI_CD_TEMPLATES = {
  javascript: 'link-foundation/js-ai-driven-development-pipeline-template',
  typescript: 'link-foundation/js-ai-driven-development-pipeline-template',
  rust: 'link-foundation/rust-ai-driven-development-pipeline-template',
  python: 'link-foundation/python-ai-driven-development-pipeline-template',
  go: 'link-foundation/go-ai-driven-development-pipeline-template',
  csharp: 'link-foundation/csharp-ai-driven-development-pipeline-template',
  java: 'link-foundation/java-ai-driven-development-pipeline-template',
  cpp: 'link-foundation/cpp-ai-driven-development-pipeline-template',
  php: 'link-foundation/php-ai-driven-development-pipeline-template',
};

export const CI_CD_GUIDE = 'https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md';

/**
 * The templates of the «Recommended CI/CD Templates» table of the hive-mind guide
 * («| JavaScript/TypeScript | [js-…-template](https://github.com/owner/js-…-template) |»)
 * @param {string} markdown
 * @returns {Object<string, string>} language → owner/name
 */
export function hiveMindTemplates(markdown) {
  const keys = { 'c#': ['csharp'], 'c/c++': ['cpp'], 'c++': ['cpp'] };
  const templates = {};
  for (const [, languages, repo] of String(markdown).matchAll(/^\|\s*([^|\n]+?)\s*\|\s*\[[^\]]+\]\(https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/?\)\s*\|/gm)) {
    const names = keys[languages.toLowerCase()] ?? languages.toLowerCase().split('/').map((name) => name.trim());
    names.filter((name) => LANGUAGE_TITLES[name]).forEach((name) => {
      templates[name] = repo;
    });
  }
  return templates;
}

/**
 * The CI/CD templates hive-mind recommends now (its guide, read with gh), else the snapshot
 * @returns {Object<string, string>} language → owner/name
 */
export function loadTemplates() {
  const result = spawnSync('gh', ['api', 'repos/link-assistant/hive-mind/contents/docs/CI-CD-BEST-PRACTICES.md', '-H', 'Accept: application/vnd.github.raw'], { encoding: 'utf8' });
  const current = result.status === 0 ? hiveMindTemplates(result.stdout) : {};
  return Object.keys(current).length > 0 ? { ...CI_CD_TEMPLATES, ...current } : CI_CD_TEMPLATES;
}

/** Names of the languages in issues */
export const LANGUAGE_TITLES = {
  javascript: 'JavaScript', typescript: 'TypeScript', rust: 'Rust', python: 'Python', go: 'Go',
  csharp: 'C#', java: 'Java', cpp: 'C++', php: 'PHP',
};

/** How a vacancy names a language */
const LANGUAGE_PATTERNS = {
  typescript: /\btype\s?script\b|\bts\b/i,
  javascript: /\bjava\s?script\b|\bnode(\.?js)?\b|\breact\b|\bvue\b|\bangular\b/i,
  rust: /\brust\b/i,
  python: /\bpython\b|\bdjango\b|\bfastapi\b|\bflask\b|\bpandas\b/i,
  go: /\bgolang\b|\bgo\b(?=\s*(\(|,|\/|developer|разработ|программ|backend|бэкенд|бекенд))|\bна go\b/i,
  csharp: /c#|\.net\b|\basp\.net\b|\bdotnet\b/i,
  java: /\bjava\b(?!\s?script)|\bspring\b|\bkotlin\b/i,
  cpp: /c\+\+|\bcpp\b|\bqt\b/i,
  php: /\bphp\b|\blaravel\b|\bsymfony\b|\byii\b|\bbitrix\b(?!24)/i,
};

/**
 * Languages a vacancy names, most mentioned first
 * @param {string} text - Vacancy title, skills and description
 * @returns {string[]} Keys of CI_CD_TEMPLATES
 */
export function namedLanguages(text) {
  return Object.entries(LANGUAGE_PATTERNS)
    .map(([language, pattern]) => [language, (String(text).match(new RegExp(pattern.source, 'gi')) ?? []).length])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([language]) => language);
}

/**
 * The prompt that picks the stack for an assignment: the language the vacancy names, otherwise
 * the most fitting one, and the technologies, without anything that names the employer
 * @param {Object} options
 * @param {string} options.vacancy - Vacancy title, skills and description (may be empty)
 * @param {string} options.assignment
 * @param {string[]} options.named - Languages the vacancy names (namedLanguages)
 * @returns {string}
 */
export function stackPrompt({ vacancy, assignment, named }) {
  return `Pick the technology stack for doing the test assignment below, as the job vacancy expects it.
- language: one of ${Object.keys(CI_CD_TEMPLATES).join(', ')}.${named.length ? ` The vacancy names: ${named.join(', ')}; use the main one of them.` : ' The vacancy names no language: choose the most fitting one for the assignment and the vacancy.'}
- stack: the frameworks, databases, AI and integration technologies to use, in English, one line (generic names only: no company or brand of the employer).
- reason: one sentence in English why this stack fits, without naming the employer.
- deliverable: "document" when the assignment asks for a written answer (a concept, analysis, design or presentation) and does not require code; otherwise "code".
Output only JSON: {"language": "...", "stack": "...", "reason": "...", "deliverable": "code|document"}

=== Vacancy ===
${vacancy || '(not known)'}

=== Assignment ===
${assignment}
`;
}

/**
 * The stack from a model answer, or null
 * @param {string} answer
 * @returns {{language: string, stack: string, reason: string}|null}
 */
export function parseStack(answer) {
  const json = String(answer ?? '').match(/\{[\s\S]*\}/)?.[0];
  try {
    const stack = JSON.parse(json);
    const language = String(stack.language ?? '').toLowerCase().replace('c#', 'csharp').replace('c++', 'cpp');
    return CI_CD_TEMPLATES[language]
      ? {
        language,
        stack: String(stack.stack ?? '').trim(),
        reason: String(stack.reason ?? '').trim(),
        deliverable: stack.deliverable === 'document' ? 'document' : 'code',
      }
      : null;
  } catch {
    return null;
  }
}

/** Names of the languages an answer can be written in, by the script of the original */
export const answerLanguage = (original) => {
  const letters = String(original).match(/\p{L}/gu) ?? [];
  return letters.filter((letter) => /[а-яё]/i.test(letter)).length > letters.length / 2 ? 'Russian' : 'English';
};

/**
 * The section of the issue that asks for the stack and the CI/CD of the template. A written
 * deliverable (a concept, a presentation) asks for no code: the stack is what the document proposes.
 * @param {{language: string, stack: string, reason: string, deliverable?: string}} stack
 * @param {Object} [options]
 * @param {string} [options.template] - owner/name of the CI/CD template (default: the snapshot's)
 * @param {string} [options.answerIn] - The language the employer reads the answer in
 * @returns {string}
 */
export function stackSection({ language, stack, reason, deliverable = 'code' }, { template = CI_CD_TEMPLATES[language], answerIn = 'English' } = {}) {
  const named = `**${LANGUAGE_TITLES[language]}**${stack ? ` (${stack})` : ''}`;
  const base = `The repository is based on the [${template.split('/')[1]}](https://github.com/${template}) CI/CD template ([CI/CD best practices](${CI_CD_GUIDE})): keep all its checks passing, and replace the template's README with one about this project that links to the result first.`;
  const written = answerIn === 'English' ? '' : ` Write the deliverable itself in **${answerIn}**, the language the assignment was given in.`;
  if (deliverable === 'document') {
    return `## Deliverable and stack

The result is a written document, not code (code, service setup and detailed architecture are out of scope): put it in \`docs/\` as Markdown, with diagrams as Mermaid and screenshots as image files next to it, and keep it within the length limit above.${written}
Where the proposal names technologies, prefer the most fitting stack: ${named}.${reason ? ` ${reason}` : ''} Prefer what can be bought or connected over what must be built. Any small prototype or data check added later uses this stack.

${base}`;
  }
  return `## Stack

Do it with the most fitting stack for this assignment: ${named}.${reason ? ` ${reason}` : ''}
Any code, prototype or data processing in this repository uses this stack, and the written deliverables live next to it.${written}

${base}`;
}

/**
 * Runs in the page: an hh.ru vacancy (title, company, skills, description)
 * @returns {{title: string, company: string, skills: string[], description: string}}
 */
export function readVacancy() {
  return {
    title: document.querySelector('[data-qa="vacancy-title"]')?.innerText.trim() ?? '',
    company: document.querySelector('[data-qa="vacancy-company-name"]')?.innerText.trim() ?? '',
    skills: [...document.querySelectorAll('[data-qa="skills-element"]')].map((element) => element.innerText.trim()),
    description: document.querySelector('[data-qa="vacancy-description"]')?.innerText.trim() ?? '',
  };
}

/** The vacancy as text for prompts and language detection */
export const vacancyText = (vacancy) => vacancy
  ? [vacancy.title, vacancy.skills?.length ? `Skills: ${vacancy.skills.join(', ')}` : '', vacancy.description].filter(Boolean).join('\n')
  : '';

/**
 * Runs in the page: the text of the test assignment of a form (the longest block whose first lines
 * name it), or null
 * @returns {{title: string, text: string}|null}
 */
export function readAssignment() {
  const pattern = /тестов\S* задани|домашн\S* задани|test (task|assignment)|take-home/i;
  const blocks = [...document.querySelectorAll('[role="listitem"], section, fieldset, article')]
    .map((element) => element.innerText.trim())
    .filter((text) => text.length > 300 && pattern.test(text.split('\n').slice(0, 2).join(' ')));
  const text = blocks.sort((a, b) => b.length - a.length)[0];
  return text ? { title: text.split('\n')[0].trim(), text } : null;
}

/**
 * Names of the employer to keep out of the issue, with their joined and inflected forms:
 * «Натур Пласт» → Натур Пласт, Натурпласт (and «Натурпласта», matched by its stem)
 * @param {string[]} names - Company names (the form title before «—», the company of a chat, …)
 * @param {string} [text] - The assignment: «quoted» names next to «компания» are added
 * @returns {string[]} Lowercase stems
 */
export function employerStems(names, text = '') {
  const quoted = [...String(text).matchAll(/«([^»\n]{3,40})»/g)].map((match) => match[1])
    .filter((name) => /^[A-ZА-ЯЁ]/.test(name) && name.split(/\s+/).length <= 3);
  const variants = [...names, ...quoted]
    .map((name) => String(name).trim()).filter((name) => name.length >= 3)
    .flatMap((name) => [name, name.replace(/[\s-]+/g, '')]);
  // Without a case ending, so «Натурпласта» and «Натурпластом» are found too
  return [...new Set(variants.map((name) => name.toLowerCase().replace(/[аяоеуюыиь]$/, '')))].filter((stem) => stem.length >= 4);
}

/**
 * The prompt that restates an assignment as a GitHub issue
 * @param {string} text - The assignment as the employer wrote it
 * @param {string[]} names - Employer names to leave out
 * @returns {string}
 */
export function issuePrompt(text, names) {
  return `Restate the test assignment below as a GitHub issue in English.
- Write it in your own words and your own structure: it must not be a sentence-by-sentence translation of the original.
- Leave out everything that identifies the employer: the company name${names.length ? ` (${names.join(', ')})` : ''} and its brands, people, links, the form, and how to send the result to them. Call it "the company" and describe it only generically (for example, "a retailer selling on marketplaces").
- Keep every requirement, deliverable, format and time limit, and the evaluation criteria.
- Use Markdown headings and lists in the body.
Output only JSON: {"title": "short issue title", "body": "issue body in Markdown"}

=== Assignment ===
${text}
`;
}

/**
 * The issue from a model answer: JSON, possibly inside a code fence
 * @param {string} answer
 * @returns {{title: string, body: string}|null}
 */
export function parseIssue(answer) {
  const json = String(answer ?? '').match(/\{[\s\S]*\}/)?.[0];
  try {
    const issue = JSON.parse(json);
    return typeof issue.title === 'string' && typeof issue.body === 'string' && issue.title.trim() && issue.body.trim()
      ? { title: issue.title.trim(), body: issue.body.trim() }
      : null;
  } catch {
    return null;
  }
}

/**
 * What is wrong with an issue before it is published: an employer name, text not in English,
 * or the original wording kept
 * @param {{title: string, body: string}} issue
 * @param {Object} options
 * @param {string[]} options.stems - From employerStems
 * @param {string} options.original - The assignment as the employer wrote it
 * @returns {string[]} Problems; empty when it can be published
 */
export function issueProblems(issue, { stems, original }) {
  const text = `${issue.title}\n${issue.body}`;
  const lower = text.toLowerCase();
  const problems = stems.filter((stem) => lower.includes(stem)).map((stem) => `names the employer («${stem}…»)`);
  const letters = text.match(/\p{L}/gu) ?? [];
  const cyrillic = letters.filter((letter) => /[а-яё]/i.test(letter)).length;
  if (cyrillic > letters.length * 0.02) {
    problems.push('is not in English');
  }
  // Six words in a row from the original: its wording is kept (names of products aside)
  const words = (value) => value.toLowerCase().match(/[\p{L}\d]+/gu) ?? [];
  const originalWords = words(original);
  const shingles = new Set(originalWords.map((_, index) => originalWords.slice(index, index + 6).join(' ')).filter((shingle) => shingle.split(' ').length === 6));
  const issueWords = words(text);
  if (issueWords.some((_, index) => shingles.has(issueWords.slice(index, index + 6).join(' ')))) {
    problems.push('repeats the original wording');
  }
  return problems;
}

/**
 * Run gh; throws with its error output
 * @param {string[]} args
 * @param {Object} [options]
 * @param {string} [options.input]
 * @returns {string}
 */
function gh(args, { input } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input });
  if (result.status !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

/**
 * Whether a repository already has a CI/CD pipeline (GitHub Actions workflows)
 * @param {string} repo
 * @returns {boolean}
 */
const hasWorkflows = (repo) => spawnSync('gh', ['api', `repos/${repo}/contents/.github/workflows`], { encoding: 'utf8' }).status === 0;

/**
 * Start an empty repository from a template that is not marked as a GitHub template: the
 * template's history is pushed as its main branch
 * @param {string} repo
 * @param {string} template
 */
function seedFromTemplate(repo, template) {
  const dir = spawnSync('mktemp', ['-d', path.join(os.tmpdir(), 'assignment-XXXXXX')], { encoding: 'utf8' }).stdout.trim();
  gh(['repo', 'clone', template, dir, '--', '--single-branch']);
  for (const args of [['remote', 'set-url', 'origin', `https://github.com/${repo}.git`], ['push', 'origin', 'HEAD:main']]) {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args[0]}: ${(result.stderr || result.stdout).trim()}`);
    }
  }
}

/**
 * Bring a template's files into an existing repository: its history is merged in (nothing of the
 * repository is lost), the template's version of a file both have (README) is taken
 * @param {string} repo
 * @param {string} template
 */
function applyTemplate(repo, template) {
  const dir = spawnSync('mktemp', ['-d', path.join(os.tmpdir(), 'assignment-XXXXXX')], { encoding: 'utf8' }).stdout.trim();
  const git = (...args) => {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args[0]}: ${(result.stderr || result.stdout).trim()}`);
    }
  };
  gh(['repo', 'clone', repo, dir]);
  git('remote', 'add', 'template', `https://github.com/${template}.git`);
  git('fetch', 'template', 'main');
  git('merge', 'template/main', '--allow-unrelated-histories', '-X', 'theirs', '-m', `Start from the ${template} CI/CD template`);
  git('push', 'origin', 'HEAD');
}

/**
 * Create the repository (when it does not exist) from the CI/CD template, or bring the template
 * into a repository without a pipeline, and create the issue (or update the one with its title)
 * @param {Object} options
 * @param {string} options.repo - owner/name
 * @param {{title: string, body: string}} options.issue
 * @param {string} [options.template] - owner/name of the CI/CD template
 * @param {number} [options.issueNumber] - The issue created for this assignment before: updated
 * @param {boolean} [options.isPrivate=false]
 * @returns {{repoUrl: string, issueUrl: string, created: string[]}}
 */
export function publishAssignment({ repo, issue, template, issueNumber, isPrivate = false }) {
  const created = [];
  const exists = spawnSync('gh', ['repo', 'view', repo, '--json', 'url'], { encoding: 'utf8' }).status === 0;
  if (!exists) {
    const isTemplate = template && JSON.parse(gh(['api', `repos/${template}`])).is_template;
    // Never an empty repository: a GitHub template is used as one, any other one is pushed into it
    gh(['repo', 'create', repo, isPrivate ? '--private' : '--public', '--description', issue.title,
      ...(isTemplate ? ['--template', template] : template ? [] : ['--add-readme'])]);
    if (template && !isTemplate) {
      seedFromTemplate(repo, template);
    }
    created.push(template ? `repository from ${template}` : 'repository');
  } else if (template && !hasWorkflows(repo)) {
    applyTemplate(repo, template);
    created.push(`${template} files`);
  }
  const repoUrl = JSON.parse(gh(['repo', 'view', repo, '--json', 'url'])).url;
  const same = issueNumber
    ? JSON.parse(gh(['issue', 'view', String(issueNumber), '-R', repo, '--json', 'number,title,body,url']))
    : JSON.parse(gh(['issue', 'list', '-R', repo, '--state', 'all', '--search', `"${issue.title}" in:title`, '--json', 'number,title,body,url']))
      .find((existing) => existing.title === issue.title);
  if (same) {
    if (same.title !== issue.title || same.body.trim() !== issue.body.trim()) {
      gh(['issue', 'edit', String(same.number), '-R', repo, '--title', issue.title, '--body-file', '-'], { input: issue.body });
      created.push('issue update');
    }
    return { repoUrl, issueUrl: same.url, created };
  }
  const issueUrl = gh(['issue', 'create', '-R', repo, '--title', issue.title, '--body-file', '-'], { input: issue.body });
  created.push('issue');
  return { repoUrl, issueUrl, created };
}

/**
 * Repositories created for forms: form URL -> {repo, repoUrl, issueUrl}
 * @param {string} [file=ASSIGNMENTS_FILE]
 * @returns {Promise<Object>}
 */
export async function readAssignments(file = ASSIGNMENTS_FILE) {
  return JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
}

/**
 * Remember the repository of a form's assignment
 * @param {string} source - Form URL (or the file the assignment came from)
 * @param {Object} record - {repo, repoUrl, issueUrl}
 * @param {string} [file=ASSIGNMENTS_FILE]
 */
export async function rememberAssignment(source, record, file = ASSIGNMENTS_FILE) {
  const all = await readAssignments(file);
  all[source] = { ...record, at: new Date().toISOString() };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(all, null, 2)}\n`);
}

/** Vacancies of forms sent in hh.ru chats: form URL -> vacancy URL (logs/ stays out of git) */
export const FORM_VACANCIES_FILE = path.join(process.cwd(), 'logs', 'form-vacancies.json');

/**
 * Remember which vacancy a form belongs to (the chat it was sent in)
 * @param {string[]} formUrls - The link from the chat and the page it led to
 * @param {string} vacancyUrl
 * @param {string} [file=FORM_VACANCIES_FILE]
 */
export async function rememberFormVacancy(formUrls, vacancyUrl, file = FORM_VACANCIES_FILE) {
  const all = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
  formUrls.filter(Boolean).forEach((url) => {
    all[url] = vacancyUrl;
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(all, null, 2)}\n`);
}

/**
 * The vacancy a form belongs to, when known
 * @param {string} formUrl
 * @param {string} [file=FORM_VACANCIES_FILE]
 * @returns {Promise<string|null>}
 */
export async function formVacancy(formUrl, file = FORM_VACANCIES_FILE) {
  const all = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
  return all[formUrl] ?? Object.entries(all).find(([url]) => formUrl.startsWith(url) || url.startsWith(formUrl))?.[1] ?? null;
}

/** A form question asking for the completed assignment («Ссылка на выполненное тестовое задание») */
export const isAssignmentLinkQuestion = (title) => ASSIGNMENT_TITLE.test(title) && /ссылк|link|url/i.test(title);
