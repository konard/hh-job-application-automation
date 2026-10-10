/**
 * Test assignments of employers as GitHub repositories: the assignment is restated in English in
 * other words, without anything that names the employer, and becomes the first issue of a
 * repository with the name the user gives. Forms link to the repository where they ask for the
 * completed assignment.
 *
 * @module assignments
 */

import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

/** An assignment block: «Тестовое задание», «Домашнее задание», «Test task», «Test assignment» */
export const ASSIGNMENT_TITLE = /тестов\S* задани|домашн\S* задани|test (task|assignment)|take-home/i;

/** Where the repositories created for forms are remembered (logs/ stays out of git) */
export const ASSIGNMENTS_FILE = path.join(process.cwd(), 'logs', 'assignments.json');

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
 * Create the repository (when it does not exist) and the issue (when no issue has its title)
 * @param {Object} options
 * @param {string} options.repo - owner/name
 * @param {{title: string, body: string}} options.issue
 * @param {boolean} [options.isPrivate=false]
 * @returns {{repoUrl: string, issueUrl: string, created: string[]}}
 */
export function publishAssignment({ repo, issue, isPrivate = false }) {
  const created = [];
  const exists = spawnSync('gh', ['repo', 'view', repo, '--json', 'url'], { encoding: 'utf8' }).status === 0;
  if (!exists) {
    gh(['repo', 'create', repo, isPrivate ? '--private' : '--public', '--description', issue.title, '--add-readme']);
    created.push('repository');
  }
  const repoUrl = JSON.parse(gh(['repo', 'view', repo, '--json', 'url'])).url;
  const same = JSON.parse(gh(['issue', 'list', '-R', repo, '--state', 'all', '--search', `"${issue.title}" in:title`, '--json', 'title,url']))
    .find((existing) => existing.title === issue.title);
  if (same) {
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

/** A form question asking for the completed assignment («Ссылка на выполненное тестовое задание») */
export const isAssignmentLinkQuestion = (title) => ASSIGNMENT_TITLE.test(title) && /ссылк|link|url/i.test(title);
