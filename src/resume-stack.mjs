/**
 * Collect the technology stack from a resume (CV): key skills, the per-job
 * "Используемые технологии" style lists and the "Технические навыки" section
 *
 * @module resume-stack
 */

/** Labels that introduce a per-job technology list, such as "Использовавшиеся навыки: C#, WPF" */
const JOB_STACK_LABEL = /^(?:используемые технологии|использовавшиеся навыки|навыки, технологии и инструменты|технологии|стек(?: технологий)?)\s*:\s*(.*)$/i;

/**
 * Technologies recognised in free text even when the resume never lists them,
 * such as "Claude Code" in "автоматизация с использованием ИИ через Claude Code"
 */
export const COMMON_TECH_TERMS = [
  'Claude Code', 'Codex', 'Copilot', 'ChatGPT', 'OpenAI', 'Anthropic', 'LLM', 'MCP',
  'CI/CD', 'Sentry', 'Jenkins', 'TeamCity', 'Terraform', 'Ansible', 'AWS', 'GCP', 'Yandex Cloud',
  'Kafka', 'RabbitMQ', 'NATS', 'ClickHouse', 'Cassandra', 'Oracle', 'Memcached', 'gRPC', 'WebSocket',
  'Laravel', 'Symfony', 'Yii', 'Django', 'FastAPI', 'Flask', 'Spring Boot', 'NestJS', 'Svelte', 'Nuxt', 'Redux',
  'Swift', 'Flutter', 'Dart', 'React Native', 'Scala', 'Elixir', 'Erlang', 'Ruby', 'Nim', 'Zig', 'Solidity',
  'Jira', 'Confluence', 'YouTrack', 'Figma', 'ClickUp', 'Discord', 'Playwright', 'Puppeteer',
];

/** "Технические навыки" categories that are not technologies */
const NON_TECHNICAL_CATEGORIES = new Set(['личные']);

/**
 * Split a comma or semicolon separated list, keeping parenthesised groups such as
 * "C# (.NET Core, .NET Framework)" as a single item
 * @param {string} text
 * @returns {string[]}
 */
export function splitList(text) {
  const items = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    if ((char === ',' || char === ';') && depth <= 0) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((item) => item.trim().replace(/\.$/, '').trim()).filter(Boolean);
}

/**
 * Remove case-insensitive duplicates, keeping the first spelling
 * @param {string[]} items
 * @returns {string[]}
 */
export function uniqueTerms(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.toLowerCase();
    return !seen.has(key) && seen.add(key);
  });
}

const isStackLabel = (row) => JOB_STACK_LABEL.test(row);

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

/**
 * Technologies listed in a job description after a label such as "Используемые технологии:".
 * The list may follow the label on the same line or on the next one.
 * @param {string} description
 * @returns {string[]}
 */
export function parseJobStack(description) {
  const rows = lines(description);
  return uniqueTerms(rows.flatMap((row, index) => {
    const match = row.match(JOB_STACK_LABEL);
    if (!match) {
      return [];
    }
    return splitList(match[1] || rows[index + 1] || '');
  }));
}

/**
 * Categories of the "Технические навыки" section: "Языки:" followed by the list on the next line
 * @param {string} text - Resume text, such as the "Обо мне" section
 * @returns {Object<string, string[]>}
 */
export function parseTechnicalSkills(text) {
  const rows = lines(text);
  const start = rows.findIndex((row) => /^технические навыки:?$/i.test(row));
  if (start === -1) {
    return {};
  }
  const categories = {};
  for (let index = start + 1; index < rows.length - 1; index += 2) {
    const label = rows[index].match(/^([^:,]{2,40}):$/);
    if (!label) {
      break;
    }
    if (!NON_TECHNICAL_CATEGORIES.has(label[1].toLowerCase())) {
      categories[label[1]] = uniqueTerms(splitList(rows[index + 1]));
    }
  }
  return categories;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Known terms mentioned in free text, such as "PHP" in "сервисы на PHP и GO".
 * Longer terms are matched first and masked, so "MS SQL" does not also count as "SQL".
 * One-letter terms are skipped, since "C" also matches the Latin "c" typed instead of "с".
 * @param {string} text
 * @param {string[]} terms
 * @returns {string[]} In the order of `terms`
 */
export function findMentionedTerms(text, terms) {
  let rest = text;
  const found = new Set();
  for (const term of [...terms].filter((item) => item.length > 1).sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}#+.])${escapeRegExp(term)}(?![\\p{L}\\p{N}#+])`, 'giu');
    if (pattern.test(rest)) {
      found.add(term);
      rest = rest.replace(pattern, ' ');
    }
  }
  return terms.filter((term) => found.has(term));
}

/**
 * Free text of a job description: everything except the technology lists
 * @param {string} description
 * @returns {string}
 */
export function jobProse(description) {
  const rows = lines(description);
  return rows.filter((row, index) => !isStackLabel(row) &&
    !(index > 0 && /:\s*$/.test(rows[index - 1]) && isStackLabel(rows[index - 1]))).join('\n');
}

/**
 * Collect the stack of a resume
 * @param {Object} resume
 * @param {string[]} [resume.keySkills] - hh.ru "Навыки" tags
 * @param {Array<{company: string, position: string, period: string, description: string}>} [resume.jobs]
 * @param {string} [resume.about] - "Обо мне" text
 * @returns {{keySkills: string[], technicalSkills: Object<string, string[]>, jobs: Array, all: string[]}}
 */
export function collectStack({ keySkills = [], jobs = [], about = '' }) {
  const technicalSkills = parseTechnicalSkills(about);
  const listed = jobs.map((job) => ({ ...job, stack: parseJobStack(job.description) }));
  const known = uniqueTerms([...Object.values(technicalSkills).flat(), ...keySkills, ...listed.flatMap((job) => job.stack)]);
  const vocabulary = uniqueTerms([...known, ...COMMON_TECH_TERMS]);
  const withMentions = listed.map(({ description, stack, ...job }) => {
    const listedKeys = new Set(stack.map((term) => term.toLowerCase()));
    const mentioned = findMentionedTerms(jobProse(description), vocabulary).filter((term) => !listedKeys.has(term.toLowerCase()));
    return { ...job, stack, mentioned };
  });
  const all = uniqueTerms([...known, ...withMentions.flatMap((job) => job.mentioned)]);
  return { keySkills: uniqueTerms(keySkills), technicalSkills, jobs: withMentions, all };
}

/**
 * Render the collected stack as Markdown
 * @param {ReturnType<typeof collectStack>} stack
 * @param {Object} [meta]
 * @param {string} [meta.title] - Desired position
 * @param {string} [meta.updated] - "Резюме обновлено …" text
 * @returns {string}
 */
export function formatStackMarkdown(stack, { title = '', updated = '' } = {}) {
  const list = (items) => items.join(', ');
  const parts = [`# Stack${title ? `: ${title}` : ''}`];
  if (updated) {
    parts.push(`_${updated}_`);
  }
  parts.push(`## All technologies (${stack.all.length})\n\n${list(stack.all)}`);
  if (stack.keySkills.length > 0) {
    parts.push(`## Key skills\n\n${list(stack.keySkills)}`);
  }
  const categories = Object.entries(stack.technicalSkills);
  if (categories.length > 0) {
    parts.push(`## Технические навыки\n\n${categories.map(([name, items]) => `- **${name}:** ${list(items)}`).join('\n')}`);
  }
  if (stack.jobs.length > 0) {
    parts.push(`## By job\n\n${stack.jobs.map((job) => {
      const heading = `### ${job.company}${job.position ? ` — ${job.position}` : ''}${job.period ? ` (${job.period})` : ''}`;
      const rows = [
        job.stack.length > 0 && `- **Listed:** ${list(job.stack)}`,
        job.mentioned.length > 0 && `- **Mentioned:** ${list(job.mentioned)}`,
      ].filter(Boolean);
      return [heading, rows.length > 0 ? rows.join('\n') : '- No technologies listed'].join('\n\n');
    }).join('\n\n')}`);
  }
  return `${parts.join('\n\n')}\n`;
}
