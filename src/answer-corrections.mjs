/** Explicit owner corrections override transcript variants, including edited messages and bot summaries. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeQuestion } from './qa-database.mjs';
import { ANSWER_SEPARATOR } from './qa.mjs';
import { withFileLock } from './helpers/mutex.mjs';

export const ANSWER_CORRECTIONS_FILE = path.join(os.homedir(), '.hh-automation', 'answers', 'corrections.json');
const empty = () => ({ version: 1, answers: [], rejected: [] });
const sameAnswer = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function validate(data) {
  if (data?.version !== 1 || !Array.isArray(data.answers) || !Array.isArray(data.rejected) ||
    data.answers.some(a => typeof a.question !== 'string' || !a.question.trim() || typeof a.answer !== 'string' || !a.answer.trim()) ||
    data.rejected.some(a => typeof a !== 'string' || !a.trim())) throw new Error('Invalid saved answer corrections');
  return data;
}

export function compileAnswerCorrections(data = empty()) {
  validate(data);
  return { answers: data.answers, approved: new Map(data.answers.map(a => [normalizeQuestion(a.question), a.answer])),
    rejected: [...new Set(data.rejected.map(sameAnswer))] };
}

// Generic Q&A readers stay independent of the owner's private state; app entry points opt in.
const emptyPolicy = compileAnswerCorrections();
export const emptyAnswerCorrections = { read: async () => emptyPolicy };

export function allowedCorrectedAnswer(question, answer, policy) {
  if (Array.isArray(answer)) return true;
  const normalized = sameAnswer(answer);
  if (policy.rejected.some(rejected => normalized === rejected || (rejected.length >= 32 && normalized.includes(rejected)))) return false;
  const approved = policy.approved.get(normalizeQuestion(question));
  return approved === undefined || normalized === sameAnswer(approved);
}

/** Keep other facts/checkbox answers intact; never rewrite historical transcripts. */
export function applyAnswerCorrections(answers, policy) {
  const result = new Map();
  for (const [question, value] of answers) {
    const approved = policy.approved.get(normalizeQuestion(question));
    if (approved !== undefined) result.set(question, approved);
    else if (Array.isArray(value)) result.set(question, value);
    else {
      const kept = String(value).split(ANSWER_SEPARATOR).filter(answer => allowedCorrectedAnswer(question, answer, policy));
      if (kept.length) result.set(question, kept.join(ANSWER_SEPARATOR));
    }
  }
  for (const { question, answer } of policy.answers) result.set(question, answer);
  return result;
}

export function createAnswerCorrections(file = ANSWER_CORRECTIONS_FILE) {
  let cache;
  const readRaw = () => fs.readFile(file, 'utf8').then(text => validate(JSON.parse(text))).catch(error => {
    if (error.code === 'ENOENT') return empty();
    throw error;
  });
  return {
    async read() {
      const stat = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const signature = stat ? `${stat.mtimeMs}:${stat.size}` : 'missing';
      if (cache?.signature !== signature) cache = { signature, policy: compileAnswerCorrections(await readRaw()) };
      return cache.policy;
    },
    async update({ answers = [], rejected = [] }) {
      validate({ version: 1, answers, rejected });
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      return withFileLock(file, async () => {
        const previous = await readRaw();
        const entries = new Map(previous.answers.map(a => [normalizeQuestion(a.question), a]));
        for (const answer of answers) entries.set(normalizeQuestion(answer.question), answer);
        const data = { version: 1, answers: [...entries.values()], rejected: [...new Set([...previous.rejected, ...rejected])] };
        const policy = compileAnswerCorrections(data);
        if (data.answers.some(a => !allowedCorrectedAnswer(a.question, a.answer, policy))) throw new Error('An approved answer contains rejected content');
        const temporary = `${file}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
        await fs.rename(temporary, file);
        cache = undefined;
        return policy;
      });
    },
  };
}

export const answerCorrections = createAnswerCorrections();
