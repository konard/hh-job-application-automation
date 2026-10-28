/** Local, evidence-based technology comparison. Equivalent names never imply a new skill. */
import path from 'node:path';
import { createQADatabase, stringSimilarity } from './qa-database.mjs';
import { collectStack } from './resume-stack.mjs';

export const TECHNOLOGY_ALIASES_FILE = path.join(process.cwd(), 'data/technology-aliases.lino');
const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const key = (text) => String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const regex = (term) => new RegExp(`(?<![\\p{L}\\p{N}#+])${term === 'Go' ? '(?:Go|GO)' : escape(term).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}#+])`, ['Go', 'npm'].includes(term) ? 'gu' : 'giu');
export const containsTechnologySpelling = (text, spelling) => regex(spelling).test(text);

export async function loadTechnologyAliases(file = TECHNOLOGY_ALIASES_FILE) {
  return new Map([...await createQADatabase(file).readQADatabase()].map(([canonical, aliases]) =>
    [canonical, [...new Set([canonical, ...[aliases].flat()])]]));
}

/** Long names consume their span: React Native and .NET Core do not invent React/.NET evidence. */
export function technologyMentions(text, aliases) {
  const variants = [...aliases].flatMap(([canonical, names]) => names.map((name) => ({ canonical, name })))
    .sort((a, b) => b.name.length - a.name.length);
  let remaining = String(text ?? '');
  const found = new Map();
  for (const { canonical, name } of variants) {
    const pattern = regex(name);
    for (const match of remaining.matchAll(pattern)) {
      const spellings = found.get(canonical) ?? new Set();
      spellings.add(match[0].replace(/\s+/g, ' ').trim());
      found.set(canonical, spellings);
    }
    remaining = remaining.replace(pattern, (match) => ' '.repeat(match.length));
  }
  return [...found].map(([canonical, spellings]) => ({ canonical, spellings: [...spellings] }));
}

export const resumeText = (resume) => [resume.title, ...(resume.keySkills ?? []), resume.about,
  ...(resume.jobs ?? []).flatMap((job) => [job.position, job.description])].filter(Boolean).join('\n');

/** Uppercase NPM alone can name either product; only the full contextual labels resolve it. */
export function ambiguousTechnologyNames(text) {
  const rest = String(text).replace(/Nginx Proxy Manager\s*(?:\(NPM\))?/gi, '').replace(/npm\s*\(JS\/TS\)/gi, '');
  return /(?<![\p{L}\p{N}])NPM(?![\p{L}\p{N}])/u.test(rest)
    ? [{ spelling: 'NPM', candidates: ['npm (JS/TS)', 'Nginx Proxy Manager'] }] : [];
}

/** Exact observed spellings in the private corpus, once per vacancy and ignoring duplicate IDs. */
export function observedTechnologyNames(vacancies, aliases) {
  const counts = new Map(), seen = new Set();
  for (const vacancy of vacancies) {
    if (vacancy.id && seen.has(vacancy.id)) continue;
    if (vacancy.id) seen.add(vacancy.id);
    const body = [...vacancy.skills ?? [], vacancy.description ?? ''].join('\n');
    for (const { canonical, spellings } of technologyMentions(body, aliases)) {
      for (const spelling of new Set(spellings.map(key))) {
        const names = counts.get(canonical) ?? new Map();
        const previous = names.get(spelling);
        names.set(spelling, { canonical, spelling: previous?.spelling ?? spellings.find((name) => key(name) === spelling), vacancies: (previous?.vacancies ?? 0) + 1 });
        counts.set(canonical, names);
      }
    }
  }
  return [...counts.values()].flatMap((names) => [...names.values()]).sort((a, b) => b.vacancies - a.vacancies || a.spelling.localeCompare(b.spelling));
}

const REQUIRED = /^(?:требования|основные требования|что (?:мы )?(?:ожидаем|жд[её]м)|мы (?:ожидаем|ищем)|нам важно|вам потребуется|необходимые навыки|requirements|must[- ]have|what you (?:bring|need)|qualifications)\s*[:：]?$/iu;
const PREFERRED = /^(?:будет плюсом|желательно|преимуществом будет|nice[- ]to[- ]have|preferred|bonus)\s*[:：]?$/iu;
const OTHER = /^(?:обязанности|задачи|чем предстоит заниматься|что предстоит делать|мы предлагаем|условия|о компании|responsibilities|what we offer|benefits|about us)\s*[:：]?$/iu;
const REQUIREMENT_SIGNALS = [
  ['English', /английск|\benglish\b/iu],
  ['Commercial experience', /коммерческ\p{L}*\s+опыт|опыт\p{L}*\s+коммерческ|commercial\s+experience/iu],
  ['Higher education', /высшее\s+(?:техническое\s+)?образован|bachelor|master.?s degree|university degree/iu],
  ['Automated testing', /автоматиз\p{L}*\s+тест|unit[- ]?test|юнит[- ]?тест|интеграцион\p{L}*\s+тест/iu],
  ['Microservices', /микросервис|microservice/iu],
  ['System design / architecture', /архитектур|system design|software architecture/iu],
  ['Distributed systems', /распредел[её]нн\p{L}*\s+систем|distributed systems/iu],
  ['Algorithms / data structures', /алгоритм|структур\p{L}*\s+данных|algorithms|data structures/iu],
  ['Team leadership', /руковод\p{L}*\s+команд|управлен\p{L}*\s+команд|team lead|team management/iu],
  ['Code review', /код[- ]?ревью|code review/iu],
  ['Documentation', /документаци|documentation/iu],
  ['CI/CD', /ci\s*[/\\-]\s*cd|непрерывн\p{L}*\s+(?:интеграц|доставк)/iu],
];

export function vacancyRequirements(description) {
  const required = [], preferred = [];
  let section = null;
  for (const raw of String(description ?? '').split('\n')) {
    const line = raw.trim();
    if (REQUIRED.test(line)) { section = required; continue; }
    if (PREFERRED.test(line)) { section = preferred; continue; }
    if (OTHER.test(line)) { section = null; continue; }
    if (line && section) {
      const target = section === required && /будет плюсом|желательно|необязател|nice[- ]to[- ]have|preferred|bonus/iu.test(line) ? preferred : section;
      target.push(line.replace(/^[•*\-–]\s*/, ''));
    }
  }
  return { required, preferred };
}

export function compareVacancyToResume(vacancy, resume, aliases) {
  aliases = new Map(aliases);
  for (const skill of vacancy.skills ?? []) {
    if (skill.length > 1 && skill !== 'NPM' && !technologyMentions(skill, aliases).length) aliases.set(skill, [skill]);
  }
  const sections = vacancyRequirements(vacancy.description);
  const explicit = [...vacancy.skills ?? [], ...sections.required].join('\n');
  const scope = explicit.trim() ? 'listed skills and requirements' : 'technologies mentioned in the description';
  const wanted = technologyMentions(explicit.trim() ? explicit : vacancy.description, aliases);
  const body = resumeText(resume);
  const stack = collectStack(resume).all;
  const known = technologyMentions(body, aliases);
  const byCanonical = new Map(known.map((item) => [item.canonical, item]));
  const matched = wanted.filter((item) => byCanonical.has(item.canonical));
  const missing = wanted.filter((item) => !byCanonical.has(item.canonical));
  const variants = matched.flatMap((item) => item.spellings
    .filter((spelling) => !regex(spelling).test(body))
    .map((spelling) => ({ canonical: item.canonical, spelling, evidence: byCanonical.get(item.canonical).spellings })));
  const similarNames = missing.flatMap((item) => {
    const candidates = stack.filter((name) => name.length >= 5 && item.canonical.length >= 5)
      .map((name) => ({ name, similarity: stringSimilarity(key(name), key(item.canonical)) }))
      .filter((candidate) => candidate.similarity >= 0.8).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
    return candidates.length ? [{ technology: item.canonical, candidates: candidates.map((candidate) => candidate.name) }] : [];
  });
  return { scope, matched, missing, aliases: variants, similarNames, ambiguousNames: ambiguousTechnologyNames(explicit.trim() ? explicit : vacancy.description), total: wanted.length,
    coverage: wanted.length ? Math.round(100 * matched.length / wanted.length) : null, ...sections };
}

/** Also recognize explicitly listed technologies already in the user's résumé. */
export function withResumeVocabulary(aliases, resume) {
  const expanded = new Map(aliases);
  for (const name of collectStack(resume).all) {
    if (name.length > 1 && name.length < 70 && name !== 'NPM' && !technologyMentions(name, aliases).length) expanded.set(name, [name]);
  }
  return expanded;
}

export function formatVacancyMatch(vacancy, comparison) {
  const names = (items) => items.map((item) => item.canonical).join(', ') || '—';
  return [
    `🔎 Résumé comparison · ${vacancy.id}: ${vacancy.title}`,
    `   Technology coverage: ${comparison.coverage === null ? 'no recognized technologies' : `${comparison.matched.length}/${comparison.total} (${comparison.coverage}%)`} · ${comparison.scope}`,
    `   Present: ${names(comparison.matched)}`,
    `   No résumé evidence: ${names(comparison.missing)}`,
    `   Equivalent spellings to add: ${comparison.aliases.map((item) => `${item.spelling} = ${item.canonical} (${item.evidence.join(', ')})`).join('; ') || '—'}`,
    ...(comparison.similarNames.length ? [`   Similar names to review: ${comparison.similarNames.map((item) => `${item.technology} ≈ ${item.candidates.join(', ')}`).join('; ')}`] : []),
    ...(comparison.ambiguousNames?.length ? [`   Ambiguous names to review: ${comparison.ambiguousNames.map((item) => `${item.spelling}: ${item.candidates.join(' / ')}`).join('; ')}`] : []),
  ].join('\n');
}

export function vacancyStatistics(vacancies, resume, aliases) {
  const technologies = new Map(), requirements = new Map(), signals = new Map(), ambiguousNames = new Map();
  const comparisons = [];
  const histogram = (field) => [...vacancies.reduce((counts, vacancy) => {
    if (vacancy[field]) counts.set(vacancy[field], (counts.get(vacancy[field]) ?? 0) + 1);
    return counts;
  }, new Map())].map(([value, count]) => ({ value, vacancies: count })).sort((a, b) => b.vacancies - a.vacancies);
  for (const vacancy of vacancies) {
    const comparison = compareVacancyToResume(vacancy, resume, aliases);
    comparisons.push(comparison);
    for (const item of comparison.ambiguousNames) {
      const previous = ambiguousNames.get(item.spelling);
      ambiguousNames.set(item.spelling, { ...item, vacancies: (previous?.vacancies ?? 0) + 1 });
    }
    const requiredText = comparison.required.length ? comparison.required.join('\n') : vacancy.description;
    for (const [name, pattern] of REQUIREMENT_SIGNALS) if (pattern.test(requiredText)) signals.set(name, (signals.get(name) ?? 0) + 1);
    const missing = new Set(comparison.missing.map((item) => item.canonical));
    for (const item of [...comparison.matched, ...comparison.missing]) {
      const row = technologies.get(item.canonical) ?? { technology: item.canonical, vacancies: 0, missingFromResume: missing.has(item.canonical), spellings: {} };
      row.vacancies += 1;
      for (const spelling of new Set(item.spellings)) row.spellings[spelling] = (row.spellings[spelling] ?? 0) + 1;
      technologies.set(item.canonical, row);
    }
    for (const line of new Set(comparison.required.map((line) => key(line)))) requirements.set(line, (requirements.get(line) ?? 0) + 1);
  }
  return { vacancies: vacancies.length,
    applied: vacancies.filter((vacancy) => vacancy.status === 'applied').length,
    experience: histogram('experience'), employment: histogram('employment'), locations: histogram('location'),
    technologies: [...technologies.values()].sort((a, b) => b.vacancies - a.vacancies || a.technology.localeCompare(b.technology)),
    requirements: [...requirements].map(([requirement, count]) => ({ requirement, vacancies: count })).sort((a, b) => b.vacancies - a.vacancies),
    requirementCategories: [...signals].map(([requirement, count]) => ({ requirement, vacancies: count })).sort((a, b) => b.vacancies - a.vacancies),
    aliases: [...new Map(comparisons.flatMap((comparison) => comparison.aliases)
      .map((item) => [key(item.spelling), item])).values()],
    similarNames: [...new Map(comparisons.flatMap((comparison) => comparison.similarNames)
      .map((item) => [key(item.technology), item])).values()],
    ambiguousNames: [...ambiguousNames.values()],
  };
}
