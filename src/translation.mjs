/**
 * Translation of work experience by three translators, each run on every text, shown side by
 * side for review (like the captcha prefill reads one picture with two models):
 *
 * - Claude Code with Haiku (claude-haiku-5-5, the latest Haiku) and Codex with the latest Luna
 *   model (resolved from `codex debug models` as the captcha prefill does) get the texts of a
 *   batch as a JSON array and answer with a JSON array
 * - Formal AI (https://github.com/link-assistant/formal-ai, the `formal-ai` CLI) gets each text
 *   on its own: `formal-ai chat --prompt 'Translate "<text>" to English'`, with its live
 *   Wiktionary/Wikidata lookups on (FORMAL_AI_LIVE_API=1; it is offline by default)
 *
 * The chosen translation is Haiku's, else Luna's, else Formal AI's. A Formal AI answer that is no
 * translation (an error, an empty answer, "I could not translate…", text left in the source
 * language) is a failure: failures are reported to the Formal AI repository as GitHub issues,
 * after searching for an open issue on the same failure (then a comment adds the new version's
 * evidence once instead of a duplicate issue).
 *
 * Results are cached in data/resume/translations.json, so a text is translated once.
 *
 * @module translation
 */

import fs, { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { CLAUDE_MODEL, READER_EFFORT, resolveLunaModel, run } from './captcha-solver.mjs';
import { detectLanguage, textSimilarity } from './experience.mjs';

export const TRANSLATORS = ['haiku', 'luna', 'formal-ai'];
export const TRANSLATOR_NAMES = { haiku: 'Haiku', luna: 'Luna', 'formal-ai': 'Formal AI' };
export const FORMAL_AI_REPO = 'link-assistant/formal-ai';
const LANGUAGE_NAMES = { en: 'English', ru: 'Russian' };
const BATCH_CHARS = 6000;
const LLM_TIMEOUT_MS = 300000;
const FORMAL_AI_TIMEOUT_MS = 120000;
/** Marks the issues and comments this tool writes, so they are found again */
export const ISSUE_MARKER = 'hh-job-application-automation formal-ai-failure';

/**
 * The prompt for a batch: the texts as a JSON array, the answer a JSON array of the same length
 * @param {string[]} texts
 * @param {'en'|'ru'} to
 * @returns {string}
 */
export function batchPrompt(texts, to) {
  const from = to === 'en' ? 'ru' : 'en';
  return `Translate each string of the JSON array below from ${LANGUAGE_NAMES[from]} to ${LANGUAGE_NAMES[to]}. ` +
    'They are parts of my own resume (job titles and work experience descriptions). Keep technology, product ' +
    'and company names as they are, keep the line breaks and list markers, use the usual professional terms. ' +
    `Output ONLY a JSON array of ${texts.length} translated strings, in the same order, with no comments.\n\n` +
    JSON.stringify(texts);
}

/**
 * The translations in a model's reply to batchPrompt
 * @param {string} reply
 * @param {number} count - Number of texts sent
 * @returns {string[]|null} Null when the reply holds no JSON array of that many strings
 */
export function parseBatchReply(reply, count) {
  const text = String(reply ?? '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) && parsed.length === count && parsed.every((item) => typeof item === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Split texts into batches of at most `limit` characters (a longer text gets its own batch)
 * @param {string[]} texts
 * @param {number} [limit]
 * @returns {string[][]}
 */
export function batchTexts(texts, limit = BATCH_CHARS) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const text of texts) {
    if (current.length > 0 && size + text.length > limit) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

/**
 * Why an answer is no translation of the source, or null when it is one
 * @param {string} source
 * @param {string|null} output
 * @param {'en'|'ru'} to
 * @returns {string|null}
 */
export function translationFailure(source, output, to) {
  const answer = String(output ?? '').trim();
  if (!answer) {
    return 'empty answer';
  }
  if (/could not (translate|identify a source phrase)|translation gap/i.test(answer)) {
    return `not translated: ${answer.split('\n')[0].slice(0, 200)}`;
  }
  if (/^response:[\w-]+$/i.test(answer)) {
    return `placeholder answer: ${answer}`;
  }
  if (/web search requested|поиск в интернете запрошен/i.test(answer)) {
    return `misrouted to a web search: ${answer.split('\n')[0].slice(0, 200)}`;
  }
  const unquoted = answer.replace(/^["«“]|["»”]$/g, '').trim();
  if (unquoted.toLowerCase() === String(source).trim().toLowerCase() && detectLanguage(source) !== to) {
    return 'the source text was returned untranslated';
  }
  if (detectLanguage(unquoted) !== to && detectLanguage(source) !== to) {
    return `the answer is not in ${LANGUAGE_NAMES[to]}`;
  }
  return null;
}

/**
 * The kind of a failure, for one issue per kind
 * @param {string} reason - Of translationFailure, or an error message
 * @param {string} [text] - The source text
 * @returns {'gap'|'short-phrase'|'empty'|'placeholder'|'untranslated'|'wrong-language'|'error'}
 */
export function failureKind(reason, text = '') {
  if (/^not translated/.test(reason)) {
    // A job title of a few words (each translated on its own) is a narrower gap than a sentence
    return text && String(text).trim().split(/\s+/).length <= 4 ? 'short-phrase' : 'gap';
  }
  if (/^empty answer/.test(reason)) {
    return 'empty';
  }
  if (/^placeholder/.test(reason)) {
    return 'placeholder';
  }
  if (/^misrouted/.test(reason)) {
    return 'misrouted';
  }
  if (/untranslated/.test(reason)) {
    return 'untranslated';
  }
  if (/not in (English|Russian)/.test(reason)) {
    return 'wrong-language';
  }
  return 'error';
}

/**
 * The translation to use and how the translators agree
 * @param {Array<{name: string, text: string|null, error?: string}>} variants - In order of preference
 * @returns {{chosen: string|null, chosenBy: string|null, agree: boolean}}
 */
export function combineTranslations(variants) {
  const valid = variants.filter((variant) => variant.text && !variant.error);
  const [first, second] = valid;
  return {
    chosen: first?.text ?? null,
    chosenBy: first?.name ?? null,
    agree: Boolean(first && second && textSimilarity(first.text, second.text) >= 0.6),
  };
}

/** Haiku: one batch through Claude Code, outside the repository so only the prompt is its context */
async function haikuBatch(texts, to, { model = CLAUDE_MODEL } = {}) {
  const reply = await run('claude', ['-p', batchPrompt(texts, to), '--model', model, '--effort', READER_EFFORT,
    '--allowedTools', '', '--output-format', 'text'], { cwd: os.tmpdir(), timeout: LLM_TIMEOUT_MS });
  return parseBatchReply(reply, texts.length) ?? (() => {
    throw new Error(`no JSON array of ${texts.length} translations in the reply: ${reply.trim().slice(0, 160)}`);
  })();
}

/** Luna: one batch through Codex, read-only in a private temporary directory */
async function lunaBatch(texts, to, { model } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hh-translate-'));
  try {
    const answerFile = path.join(dir, 'answer.txt');
    await run('codex', ['exec', '-m', model ?? await resolveLunaModel(), '-c', `model_reasoning_effort=${READER_EFFORT}`,
      '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-o', answerFile, batchPrompt(texts, to)],
    { cwd: dir, timeout: LLM_TIMEOUT_MS });
    const reply = await readFile(answerFile, 'utf8');
    return parseBatchReply(reply, texts.length) ?? (() => {
      throw new Error(`no JSON array of ${texts.length} translations in the reply: ${reply.trim().slice(0, 160)}`);
    })();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The Formal AI prompt for a text: the quoted form its translation handler recognizes
 * @param {string} text
 * @param {'en'|'ru'} to
 * @returns {string}
 */
export function formalAiPrompt(text, to) {
  // An inner double quote would end the quoted source early
  return `Translate "${String(text).replace(/"/g, '\'\'')}" to ${LANGUAGE_NAMES[to]}`;
}

/**
 * The command line shown in reports and issues for a Formal AI translation, quoted for a POSIX
 * shell (single quotes keep the line breaks of the text)
 * @param {string} text
 * @param {'en'|'ru'} to
 * @returns {string}
 */
export const formalAiCommand = (text, to) => `FORMAL_AI_LIVE_API=1 formal-ai chat --silent --prompt '${formalAiPrompt(text, to).replace(/'/g, '\'\\\'\'')}'`;

/**
 * The installed Formal AI version ("0.352.1"), or null when the CLI is missing
 * @returns {Promise<string|null>}
 */
export async function formalAiVersion() {
  return run('formal-ai', ['--version'], { timeout: 30000 })
    .then((output) => output.trim().split(/\s+/).pop())
    .catch(() => null);
}

/** Formal AI: one text, answered on stdout */
async function formalAiText(text, to) {
  const answer = await run('formal-ai', ['chat', '--silent', '--prompt', formalAiPrompt(text, to)],
    { cwd: os.tmpdir(), timeout: FORMAL_AI_TIMEOUT_MS, env: { FORMAL_AI_LIVE_API: '1' } });
  return answer.trim().replace(/^"(.*)"$/s, '$1');
}

/**
 * Whether a Formal AI failure is Formal AI's own, so it is reported: not a wrong command line
 * (clap's "try '--help'"), a timeout or a missing binary on this machine
 * @param {string} reason
 * @returns {boolean}
 */
export function isFormalAiFault(reason) {
  return !/try '--help'|ETIMEDOUT|SIGTERM|timed out|ENOENT/i.test(reason);
}

const cacheKey = (text, to) => `${to}\u0001${text}`;

/**
 * A translator over the cache file
 * @param {Object} [options]
 * @param {string[]} [options.translators=TRANSLATORS]
 * @param {string|null} [options.cachePath] - JSON cache (data/resume/translations.json); null: no cache
 * @param {string} [options.haikuModel=CLAUDE_MODEL]
 * @param {string} [options.lunaModel] - Default: the latest Luna
 * @param {Object} [options.engines] - For tests: { haiku(texts, to), luna(texts, to), formalAi(text, to), formalAiVersion() }
 * @returns {Promise<{translate: Function, variantsOf: Function, translationsOf: Function, chosen: Function, failures: Function, models: Object}>}
 */
export async function createTranslator({
  translators = TRANSLATORS, cachePath = null, haikuModel = CLAUDE_MODEL, lunaModel = null, engines = {},
} = {}) {
  const cache = cachePath ? JSON.parse(await fs.readFile(cachePath, 'utf8').catch(() => '{}')) : {};
  const models = {
    haiku: haikuModel,
    luna: translators.includes('luna') ? (lunaModel ?? (engines.luna ? 'test-luna' : await resolveLunaModel())) : null,
    'formal-ai': translators.includes('formal-ai') ? await (engines.formalAiVersion ?? formalAiVersion)() : null,
  };
  const haiku = engines.haiku ?? ((texts, to) => haikuBatch(texts, to, { model: models.haiku }));
  const luna = engines.luna ?? ((texts, to) => lunaBatch(texts, to, { model: models.luna }));
  const formalAi = engines.formalAi ?? formalAiText;
  /** Failures of Formal AI met in this run: { text, to, reason, output, command } */
  const formalAiFailures = [];

  const entry = (text, to) => (cache[cacheKey(text, to)] ??= {});
  // Cached answers count for the same model only; Formal AI's for the same version
  const cached = (text, to, name) => {
    const result = cache[cacheKey(text, to)]?.[name];
    return result && result.model === models[name] ? result : null;
  };
  // Every translator's answer is judged the same way (Haiku sometimes returns the text as is)
  const judged = (text, to, name, output) => {
    const reason = translationFailure(text, output, to);
    return { model: models[name], text: reason ? null : output, output, ...(reason ? { error: reason } : {}) };
  };

  async function runBatches(name, engine, texts, to) {
    // A failed call (no answer) is asked again; an answer is judged again
    const missing = texts.filter((text) => {
      const output = cached(text, to, name)?.output ?? cached(text, to, name)?.text;
      if (typeof output === 'string') {
        entry(text, to)[name] = judged(text, to, name, output);
      }
      return typeof output !== 'string';
    });
    for (const batch of batchTexts(missing)) {
      try {
        const answers = await engine(batch, to);
        batch.forEach((text, index) => {
          entry(text, to)[name] = judged(text, to, name, answers[index]);
        });
      } catch (error) {
        console.log(`⚠️  ${TRANSLATOR_NAMES[name]} failed on ${batch.length} text(s): ${error.message.slice(0, 300)}`);
        batch.forEach((text) => {
          entry(text, to)[name] = { model: models[name], text: null, error: error.message.slice(0, 300) };
        });
      }
    }
  }

  async function runFormalAi(texts, to) {
    for (const text of texts) {
      let result = cached(text, to, 'formal-ai');
      // The raw answer is kept, so the verdict is the current one also for cached answers
      const judge = (output) => judged(text, to, 'formal-ai', output);
      if (result && 'output' in result) {
        result = entry(text, to)['formal-ai'] = judge(result.output);
      } else {
        try {
          result = entry(text, to)['formal-ai'] = judge(await formalAi(text, to));
        } catch (error) {
          // Not cached: a timeout or a broken install is retried on the next run
          result = { model: models['formal-ai'], text: null, output: '', error: `error: ${error.message.slice(0, 300)}` };
        }
      }
      if (result.error) {
        formalAiFailures.push({
          text, to, reason: result.error, output: result.output ?? '', command: formalAiCommand(text, to),
          reportable: isFormalAiFault(result.error),
        });
      }
    }
  }

  /**
   * Translate every text not yet in `to` with each translator (in parallel per translator)
   * @param {string[]} texts
   * @param {'en'|'ru'} to
   */
  async function translate(texts, to) {
    const todo = [...new Set(texts.filter((text) => text && detectLanguage(text) !== to))];
    if (todo.length === 0) {
      return;
    }
    console.log(`🌐 Translating ${todo.length} text(s) to ${LANGUAGE_NAMES[to]} with ${translators.map((name) => `${TRANSLATOR_NAMES[name]}${models[name] ? ` (${models[name]})` : ''}`).join(', ')}...`);
    await Promise.all([
      translators.includes('haiku') && runBatches('haiku', haiku, todo, to),
      translators.includes('luna') && runBatches('luna', luna, todo, to),
      translators.includes('formal-ai') && (models['formal-ai'] ? runFormalAi(todo, to) : Promise.resolve(console.log('⚠️  Formal AI is not installed (cargo install formal-ai), it is skipped'))),
    ]);
    if (cachePath) {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    }
  }

  /** Every translator's result for a text, in order of preference */
  const variantsOf = (text, to = detectLanguage(text) === 'ru' ? 'en' : 'ru') => translators
    .filter((name) => name !== 'formal-ai' || models['formal-ai'])
    .map((name) => {
      const result = cache[cacheKey(text, to)]?.[name];
      return { name: `${TRANSLATOR_NAMES[name]}${models[name] ? ` (${models[name]})` : ''}`, text: result?.text ?? null, error: result?.error ?? (result ? undefined : 'not translated yet') };
    });

  return {
    translate,
    variantsOf,
    /** The valid translations of a text (for comparing across languages) */
    translationsOf: (text, to) => variantsOf(text, to).map((variant) => variant.text).filter(Boolean),
    /** The translation to use (the text itself when it is already in `to`) */
    chosen: (text, to) => (!text || detectLanguage(text) === to ? text : combineTranslations(variantsOf(text, to)).chosen ?? text),
    /** Formal AI's failures; keeping a text as is counts only when the other translators changed it */
    failures: () => formalAiFailures.map((failure) => {
      const same = (name) => String(cache[cacheKey(failure.text, failure.to)]?.[name]?.output ?? '').trim().toLowerCase() === failure.text.trim().toLowerCase();
      const keptByAll = failureKind(failure.reason) === 'untranslated' && ['haiku', 'luna'].filter((name) => translators.includes(name)).every(same);
      return keptByAll ? { ...failure, reportable: false } : failure;
    }),
    models,
  };
}

/** Per failure kind: searches for an existing issue, and what its title or body must say to be one */
const KNOWN_FAILURES = {
  gap: {
    searches: ['"translation gap"', '"could not translate"', '"could not identify a source phrase"'],
    matches: /could not translate|translation gap|could not identify a source phrase|translation of an arbitrary sentence/i,
    summary: 'phrases and sentences are not translated ("I could not translate … translation gap")',
  },
  'short-phrase': {
    searches: ['"kind=short-phrase"', 'short phrases of known words'],
    matches: /short phrases of known words|kind=short-phrase/i,
    summary: 'short phrases of known words (job titles) are not translated',
  },
  empty: {
    searches: ['translate "empty answer"', 'translation empty output'],
    matches: /translat[\s\S]*(empty (answer|output|reply)|no answer)/i,
    summary: 'a translation request gets an empty answer',
  },
  placeholder: {
    searches: ['"response:translate"'],
    matches: /response:translate/i,
    summary: 'a translation request is answered with the placeholder "response:translate"',
  },
  misrouted: {
    searches: ['"Web search requested"', '"description of a web search"'],
    matches: /web search requested|description of a web search|try_budget_search/i,
    summary: 'a translation request is answered with a web search request instead of a translation',
  },
  untranslated: {
    searches: ['translation returns the input unchanged'],
    matches: /translat[\s\S]*(unchanged|untranslated|echo)/i,
    summary: 'the source text is returned untranslated',
  },
  'wrong-language': {
    searches: ['translation answer wrong language'],
    matches: /translat[\s\S]*wrong (target )?language/i,
    summary: 'the answer is not a translation in the requested language',
  },
  error: {
    searches: ['translate error panic'],
    matches: /translat[\s\S]*(panic|crash|exit code)/i,
    summary: 'the translation command fails',
  },
};

/**
 * The searches that find an existing issue on a failure kind, ours first
 * @param {string} kind
 * @returns {string[]}
 */
export function issueSearches(kind) {
  return [`"${ISSUE_MARKER} kind=${kind}"`, ...(KNOWN_FAILURES[kind]?.searches ?? [])];
}

/**
 * Whether an issue is about this kind of failure (filed by this tool, or saying the same)
 * @param {{title: string, body?: string}} issue
 * @param {string} kind
 * @returns {boolean}
 */
export function issueMatchesFailure(issue, kind) {
  const text = `${issue.title ?? ''}\n${issue.body ?? ''}`;
  return text.includes(`${ISSUE_MARKER} kind=${kind}`) || Boolean(KNOWN_FAILURES[kind]?.matches.test(text));
}

const fence = (text) => `\`\`\`\n${String(text).replace(/```/g, '`​``')}\n\`\`\``;

/**
 * Evidence of failures: per input the command, the answer and what other translators gave
 * @param {Array<{text: string, to: string, reason: string, output: string, command: string, others?: string[]}>} failures
 * @param {number} [limit=6]
 * @returns {string}
 */
export function failureEvidence(failures, limit = 6) {
  const shown = [...failures].sort((a, b) => a.text.length - b.text.length).slice(0, limit);
  const parts = shown.map((failure, index) => [
    `#### ${index + 1}. ${failure.reason}`,
    '',
    'Input (work experience text from my public resume):',
    fence(failure.text),
    'Command:',
    fence(failure.command),
    'Output:',
    fence(failure.output || '(empty)'),
    ...(failure.others?.length ? ['Other translators gave:', ...failure.others.map((other) => `- ${other}`)] : []),
  ].join('\n'));
  if (failures.length > shown.length) {
    parts.push(`…and ${failures.length - shown.length} more input(s) with the same failure.`);
  }
  return parts.join('\n\n');
}

/**
 * A new issue on a kind of failure
 * @param {Object} options
 * @param {string} options.kind
 * @param {string} options.version - Formal AI version
 * @param {Object[]} options.failures - Of one kind
 * @param {Object|null} [options.closedIssue] - A closed issue on the same failure (a regression)
 * @returns {{title: string, body: string}}
 */
export function buildIssue({ kind, version, failures, closedIssue = null }) {
  const to = LANGUAGE_NAMES[failures[0]?.to] ?? 'English';
  const summary = KNOWN_FAILURES[kind]?.summary ?? kind;
  return {
    title: `Translation to ${to}: ${summary} (formal-ai ${version})`,
    body: [
      `Translating work experience (job titles and descriptions from a resume) with \`formal-ai ${version}\` ` +
        `(\`cargo install formal-ai\`, macOS) fails: ${summary}. ${failures.length} of the texts sent failed this way.`,
      '',
      ...(closedIssue ? [`This looks like a regression of #${closedIssue.number} (closed).`, ''] : []),
      '### Expected behavior',
      '',
      `The text translated to ${to}, like the other translators run on the same input (shown below) do.`,
      '',
      '### Evidence',
      '',
      failureEvidence(failures),
      '',
      'Found by the experience sync of https://github.com/konard/hh-job-application-automation, which runs Formal AI ' +
        'next to Claude Haiku and Codex Luna on every text.',
      '',
      `<!-- ${ISSUE_MARKER} kind=${kind} version=${version} -->`,
    ].join('\n'),
  };
}

/**
 * A comment adding a new version's evidence to an existing issue on the same failure
 * @returns {string}
 */
export function buildIssueComment({ kind, version, failures }) {
  return [
    `Still reproducible with \`formal-ai ${version}\` on work experience texts (${failures.length} input(s) failed this way):`,
    '',
    failureEvidence(failures, 3),
    '',
    `<!-- ${ISSUE_MARKER} kind=${kind} version=${version} -->`,
  ].join('\n');
}

/**
 * Report Formal AI failures to its repository: per kind, a comment on an open issue about the
 * same failure (once per version), else a new issue. Uses the `gh` CLI
 * @param {Object} options
 * @param {Object[]} options.failures
 * @param {string} options.version
 * @param {string} [options.repo=FORMAL_AI_REPO]
 * @param {boolean} [options.dryRun=false] - Only say what would be filed
 * @param {Function} [options.gh] - For tests: (args) => Promise<string>
 * @returns {Promise<Array<{kind: string, action: string, url: string|null}>>}
 */
export async function reportFormalAiFailures({ failures, version, repo = FORMAL_AI_REPO, dryRun = false, gh = (args) => run('gh', args, { timeout: 60000 }) }) {
  const byKind = new Map();
  failures.filter((failure) => failure.reportable !== false).forEach((failure) => {
    const kind = failureKind(failure.reason, failure.text);
    byKind.set(kind, [...(byKind.get(kind) ?? []), failure]);
  });
  const results = [];
  const toComment = new Map();
  for (const [kind, list] of byKind) {
    const found = new Map();
    for (const search of issueSearches(kind)) {
      const issues = JSON.parse(await gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', search,
        '--limit', '20', '--json', 'number,title,body,state,url']).catch(() => '[]') || '[]');
      issues.filter((issue) => issueMatchesFailure(issue, kind)).forEach((issue) => found.set(issue.number, issue));
    }
    // This tool's own issue first, then one about translation, then the oldest
    const rank = (issue) => (`${issue.body}`.includes(`${ISSUE_MARKER} kind=${kind}`) ? 0 : /translat/i.test(issue.title) ? 1 : 2);
    const open = [...found.values()].filter((issue) => issue.state === 'OPEN').sort((a, b) => rank(a) - rank(b) || a.number - b.number)[0];
    if (open) {
      const comments = JSON.parse(await gh(['issue', 'view', String(open.number), '--repo', repo, '--json', 'comments']).catch(() => '{}') || '{}').comments ?? [];
      const reported = [open.body, ...comments.map((comment) => comment.body)].some((text) => String(text).includes(`kind=${kind} version=${version}`));
      if (reported) {
        results.push({ kind, action: `already reported for ${version}`, url: open.url });
      } else {
        // Kinds landing on one issue share one comment, posted below
        const comment = toComment.get(open.number) ?? { issue: open, parts: [], kinds: [] };
        comment.parts.push(buildIssueComment({ kind, version, failures: list }));
        comment.kinds.push(kind);
        toComment.set(open.number, comment);
      }
      continue;
    }
    const closed = [...found.values()].find((issue) => issue.state !== 'OPEN') ?? null;
    const issue = buildIssue({ kind, version, failures: list, closedIssue: closed });
    if (dryRun) {
      results.push({ kind, action: 'would file', url: null, title: issue.title });
      continue;
    }
    const url = (await gh(['issue', 'create', '--repo', repo, '--title', issue.title, '--body', issue.body])).trim();
    results.push({ kind, action: 'filed', url });
  }
  for (const { issue, parts, kinds } of toComment.values()) {
    const url = dryRun ? issue.url : (await gh(['issue', 'comment', String(issue.number), '--repo', repo, '--body', parts.join('\n\n---\n\n')])).trim();
    kinds.forEach((kind) => results.push({ kind, action: dryRun ? 'would comment' : 'commented', url: url || issue.url }));
  }
  return results;
}
