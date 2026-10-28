/** Evidence-based, bilingual technology inventories and About drafts. No browser writes. */
import { collectStack, findMentionedTerms, JOB_STACK_HEADINGS, rawJobStack, splitList } from './resume-stack.mjs';
import { containsTechnologySpelling, technologyMentions } from './vacancy-analysis.mjs';
import { companyKey, companySimilarity } from './experience.mjs';

const key = (value) => String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const CATEGORY_NAMES = {
  platforms: { ru: 'Платформы', en: 'Platforms', aliases: ['платформы', 'platforms'] },
  languages: { ru: 'Языки', en: 'Languages', aliases: ['языки', 'languages'] },
  tools: { ru: 'Инструменты', en: 'Tools', aliases: ['инструменты', 'tools'] },
  methods: { ru: 'Методологии', en: 'Methods', aliases: ['методологии', 'methods', 'methodologies'] },
  technologies: { ru: 'Технологии', en: 'Technologies', aliases: ['технологии', 'technologies'] },
  databases: { ru: 'Базы данных', en: 'Databases', aliases: ['базы данных', 'databases'] },
};
const ALIAS_HEADER = /^(?:технологии\s*[—–-]\s*варианты названий|technology name variants|technology aliases)\s*:/i;
const PERSONAL_HEADER = /^(?:личные|personal)\s*:/i;
const EXTRA_ALIASES = new Map([
  ['Claude Code', ['Anthropic Claude Code CLI', 'Claude Code CLI']],
  ['Codex', ['OpenAI Codex CLI', 'Codex CLI']],
  ['GitHub Copilot', ['Copilot']],
  ['Telerik', ['Teleric']],
  ['Cutter', ['Cuter']],
  ['Hasura Storage', ['HasuraStorage']],
  ['Microsoft Access', ['MS Access', 'Access']],
  ['MS SQL CE', ['MSSQL CE']],
  ['Selectel Cloud', ['Selectel']],
  ['PyPI', ['PyPi']],
  ['ReSharper', ['Resharper']],
  ['Xcode', ['XCode']],
  ['1С:Документооборот', ['1C:Документооборот', '1C:Document Management']],
  ['S3-compatible storage', ['Amazon AWS S3 compatible', 'Amazon AWS S3 совместимым']],
  ['RSS', ['RSS']], ['OCR', ['OCR']], ['Saperion', ['Saperion']],
  ['Tinkoff Invest API', ['Tinkoff Invest API']],
  ['npm', ['NPM', 'npm (JS/TS)']],
  ['Nginx Proxy Manager', ['Nginx Proxy Manager (NPM)']],
]);
const DISPLAY = { 'Claude Code': 'Anthropic Claude Code CLI', Codex: 'OpenAI Codex CLI',
  'GitHub Copilot': 'GitHub Copilot', npm: 'npm (JS/TS)', NPM: 'npm (JS/TS)',
  'Nginx Proxy Manager': 'Nginx Proxy Manager (NPM)',
  '1С:Документооборот': { ru: '1С:Документооборот', en: '1C:Document Management' } };
const BLOCK = new RegExp(`\\n*^${JOB_STACK_HEADINGS}\\s*:[^\\n]*(?:\\n(?!\\s*\\n)[^\\n]*)*`, 'imu');
const CORRECTED_TYPOS = new Set(['cuter', 'teleric']);
const INVALID_ALIASES = new Set([...CORRECTED_TYPOS, 'с#']);
export const compareTechnologyNames = (a, b, language = 'en') => a.localeCompare(b, language, { sensitivity: 'base', numeric: true });

/** Dates must also match at the call site. Keep translated business descriptions out of brand matching. */
function sameEmployer(a, b) {
  if (companySimilarity(a, b) >= 0.65) return true;
  const tokens = (name) => companyKey(name).replace(/onlayn/g, 'online').split(' ')
    .filter((token) => token.length >= 5 && !['internet', 'online', 'store', 'magazin', 'podarkov'].includes(token));
  const x = tokens(a), y = tokens(b);
  return x.some((token) => y.includes(token));
}

export function parseAboutInventory(about) {
  const rows = String(about).split('\n');
  const start = rows.findIndex((row) => /^(?:технические навыки|technical skills):?$/i.test(row.trim()));
  if (start < 0) {
    return { intro: String(about).trim(), categories: {}, personal: '', aliases: [] };
  }
  const result = { intro: rows.slice(0, start).join('\n').trim(), categories: {}, personal: '', aliases: [] };
  let section = null;
  for (const raw of rows.slice(start + 1)) {
    const row = raw.trim();
    if (!row) continue;
    if (ALIAS_HEADER.test(row)) { section = 'aliases'; continue; }
    if (PERSONAL_HEADER.test(row)) { section = 'personal'; continue; }
    const label = row.match(/^([^:]+):$/)?.[1];
    if (label) {
      const category = Object.entries(CATEGORY_NAMES).find(([, item]) => item.aliases.includes(key(label)))?.[0];
      if (!category) throw new Error(`Unrecognized About category: ${label}`);
      section = category;
      result.categories[category] ??= [];
      continue;
    }
    if (section === 'personal') result.personal += `${result.personal ? '\n' : ''}${raw}`;
    else if (section === 'aliases') result.aliases.push(row);
    else if (section) result.categories[section].push(...splitList(row));
    else throw new Error('About technical list has text outside a category');
  }
  return result;
}

/** Whole-name aliases only. Parent products, versions and related frameworks stay distinct. */
export function createTechnologyNormalizer(catalog = new Map()) {
  const reverse = new Map();
  for (const [canonical, names] of [...catalog, ...EXTRA_ALIASES]) {
    reverse.set(key(canonical), canonical);
    for (const spelling of names) reverse.set(key(spelling), canonical);
  }
  return (term) => {
    const linux = String(term).match(/^Linux\s*(\([^)]*\))?$/i);
    const decorated = String(term).match(/^(.*?)\s+\(([^()]*)\)$/);
    const base = decorated && reverse.get(key(decorated[1]));
    const onlyAliases = base && splitList(decorated[2]).every((name) => reverse.get(key(name)) === base);
    const canonical = linux ? 'Linux' : onlyAliases ? base : reverse.get(key(term)) ?? String(term).trim();
    return { canonical, id: key(canonical), detail: linux?.[1] ?? '' };
  };
}

function components(term) {
  if (/^C\s*\/\s*C\+\+$/i.test(term)) return ['C', 'C++'];
  const group = term.match(/^C#\s*\(([^)]*)\)$/i);
  return group && splitList(group[1]).every((item) => /^\.NET\b/i.test(item)) ? ['C#', ...splitList(group[1])] : [term];
}

const categoryFor = (term) => {
  if (/^(?:C|C\+\+|Nim|PHP 8)$/i.test(term)) return 'languages';
  if (/^(?:ClickHouse|Redis|InfluxDB)$/i.test(term)) return 'databases';
  if (/^(?:\.NET|Silverlight|Symfony|Express|Redux|AJAX|MVC|RabbitMQ|S3-compatible|RSS|OCR)/i.test(term)) return 'technologies';
  return 'tools';
};

export function auditCvTechnologies(cvs, catalog = new Map(), { observed = [], introOverrides = {} } = {}) {
  const normalize = createTechnologyNormalizer(catalog);
  const inventories = cvs.map((cv) => parseAboutInventory(cv.about));
  const registry = new Map();
  const register = (term, category) => {
    for (const component of components(term)) {
      const item = normalize(component);
      const previous = registry.get(item.id);
      if (previous) {
        previous.spellings.add(component);
        if (item.detail) previous.detail = item.detail;
      } else {
        registry.set(item.id, { ...item, category: category ?? categoryFor(item.canonical), spellings: new Set([component]) });
      }
    }
  };
  const aboutDuplicates = [];
  for (let index = 0; index < cvs.length; index++) {
    const seen = new Map();
    for (const [category, terms] of Object.entries(inventories[index].categories)) {
      for (const term of terms) {
        for (const component of components(term)) {
          const item = normalize(component);
          if (seen.has(item.id)) aboutDuplicates.push({ language: cvs[index].language, first: seen.get(item.id), duplicate: component });
          else seen.set(item.id, component);
        }
        register(term, category);
      }
    }
  }
  for (const [index, cv] of cvs.entries()) {
    // Structured key skills and an unstructured About may contain known technologies too.
    technologyMentions([...(cv.skills ?? []), inventories[index].intro].join('\n'), catalog)
      .forEach((item) => register(item.canonical));
  }
  const vocabulary = new Set([...registry.values()].flatMap((item) => [...item.spellings, item.canonical]));
  for (const [canonical, names] of [...catalog, ...EXTRA_ALIASES]) {
    vocabulary.add(canonical);
    names.forEach((name) => vocabulary.add(name));
  }
  const positionDuplicates = [];
  const listedByPosition = [];
  for (const cv of cvs) {
    for (let index = 0; index < cv.jobs.length; index++) {
      const job = cv.jobs[index];
      // S3-compatible MinIO/Hasura storage is evidence of that API, not of hosting on AWS.
      const evidence = job.description.replace(/Amazon AWS S3\s+(?:compatible|совместимым)/gi, 'S3-compatible storage');
      const collected = collectStack({ ...cv, jobs: [{ ...job, description: evidence }], keySkills: cv.skills });
      const raw = rawJobStack(job.description);
      const seen = new Set();
      const unique = raw.filter((term) => {
        const id = normalize(term).id;
        if (seen.has(id)) { positionDuplicates.push({ language: cv.language, company: job.company, term }); return false; }
        seen.add(id); return true;
      });
      listedByPosition.push({ language: cv.language, company: job.company, start: job.start, raw, unique });
      [...unique, ...collected.jobs[0].mentioned].forEach((term) => register(term));
      const prose = evidence.replace(BLOCK, '');
      findMentionedTerms(prose, [...vocabulary]).forEach((term) => register(term));
    }
  }
  // Silverlight occurs as both a tool and a technology in the source inventories.
  if (registry.has(key('Silverlight'))) registry.get(key('Silverlight')).category = 'technologies';
  const proposals = cvs.map((cv, index) => {
    const categories = {};
    for (const item of registry.values()) {
      const preferred = DISPLAY[item.canonical] ?? item.canonical;
      const display = typeof preferred === 'string' ? preferred : preferred[cv.language];
      const label = `${display}${item.detail ? ` ${item.detail}` : ''}`;
      (categories[item.category] ??= []).push(label);
    }
    const original = inventories[index];
    const aboutIds = new Set(Object.values(original.categories).flat().flatMap(components).map((term) => normalize(term).id));
    const body = [cv.title, ...(cv.skills ?? []), original.intro, ...Object.values(categories).flat(),
      ...cv.jobs.flatMap((job) => [job.position, job.description])].filter(Boolean).join('\n');
    const originalBody = [cv.title, ...(cv.skills ?? []), original.intro, ...Object.values(original.categories).flat(),
      ...cv.jobs.flatMap((job) => [job.position, job.description])].filter(Boolean).join('\n');
    const aliases = new Map();
    const addedAliases = [];
    for (const item of observed) {
      const canonical = normalize(item.canonical);
      const equivalent = normalize(item.spelling);
      if (!registry.has(canonical.id) || equivalent.id !== canonical.id || INVALID_ALIASES.has(key(item.spelling)) ||
        containsTechnologySpelling(body, item.spelling)) continue;
      const names = aliases.get(canonical.id) ?? [];
      const spelling = canonical.id === 'kubernetes' && key(item.spelling) === 'k8s' ? 'k8s' : item.spelling;
      if (!names.some((name) => key(name) === key(spelling))) {
        names.push(spelling);
        addedAliases.push({ ...item, spelling });
      }
      aliases.set(canonical.id, names);
    }
    for (const terms of Object.values(categories)) {
      for (let i = 0; i < terms.length; i++) {
        const names = aliases.get(normalize(terms[i]).id);
        if (names?.length) terms[i] += ` (${names.sort((a, b) => compareTechnologyNames(a, b, cv.language)).join(', ')})`;
      }
      terms.sort((a, b) => compareTechnologyNames(a, b, cv.language));
    }
    original.intro = introOverrides[cv.language] ?? original.intro;
    return { language: cv.language, categories, original, addedAliases,
      missingAliases: addedAliases.filter((item) => !containsTechnologySpelling(originalBody, item.spelling)),
      missing: [...registry.values()].filter((item) => !aboutIds.has(item.id)).map((item) => item.canonical) };
  });
  for (const proposal of proposals) {
    const parts = [proposal.original.intro, proposal.language === 'ru' ? 'Технические навыки' : 'Technical Skills'];
    for (const [category, names] of Object.entries(CATEGORY_NAMES)) {
      if (proposal.categories[category]?.length) parts.push(`${names[proposal.language]}:\n${proposal.categories[category].join(', ')}`);
    }
    if (proposal.original.personal) parts.push(`${proposal.language === 'ru' ? 'Личные' : 'Personal'}:\n${proposal.original.personal}`);
    proposal.about = [parts[0], parts.slice(1).join('\n')].filter(Boolean).join('\n\n');
    delete proposal.original;
  }
  return { technologies: [...registry.values()].map((item) => ({ ...item, spellings: [...item.spellings] })),
    aboutDuplicates, positionDuplicates, listedByPosition, proposals };
}

/** Replace only labelled stack blocks, keeping the job's narrative and first heading. */
export function replaceJobTechnologyLists(description, terms, language) {
  const blocks = [...String(description).matchAll(new RegExp(BLOCK.source, 'gimu'))];
  const heading = blocks[0]?.[0].trim().split(':')[0] ?? (language === 'ru' ? 'Используемые технологии' : 'Technologies and tools');
  if (!blocks.length) return `${description.trimEnd()}\n\n${heading}:\n${terms.join(', ')}`;
  let first = true;
  return description.replace(new RegExp(BLOCK.source, 'gimu'), () => {
    if (!first) return '';
    first = false;
    return `\n\n${heading}:\n${terms.join(', ')}`;
  }).replace(/\n{3,}/g, '\n\n').trim();
}

/** Two consolidated About updates, then the minimal reviewed position cleanups. */
export function planCvTechnologySync(resumes, catalog = new Map(), options = {}) {
  const normalize = createTechnologyNormalizer(catalog);
  const cvs = resumes.map((resume) => resume.cv);
  const audit = auditCvTechnologies(cvs, catalog, options);
  const changes = [];
  const unmatched = [];
  for (const { hash, cv } of resumes) {
    for (const job of cv.jobs) {
      const raw = rawJobStack(job.description);
      const ids = new Set();
      const terms = raw.filter((term) => { const id = normalize(term).id; if (ids.has(id)) return false; ids.add(id); return true; });
      const added = [];
      for (const other of resumes.filter((resume) => resume.hash !== hash)) {
        const counterparts = other.cv.jobs.filter((item) => item.start === job.start && item.end === job.end && sameEmployer(item.company, job.company));
        if (counterparts.length !== 1) {
          unmatched.push({ language: cv.language, company: job.company, otherLanguage: other.cv.language });
          continue;
        }
        for (const term of rawJobStack(counterparts[0].description)) {
          const id = normalize(term).id;
          if (!ids.has(id)) { ids.add(id); terms.push(term); added.push(term); }
        }
      }
      if (terms.length !== raw.length || added.length > 0) {
        changes.push({ kind: 'update', resumeHash: hash,
          target: { company: job.company, title: job.position, description: job.description },
          fields: { description: replaceJobTechnologyLists(job.description, terms, cv.language) },
          audit: { removedDuplicates: raw.length + added.length - terms.length, addedFromCounterpart: added } });
      }
    }
  }
  for (const [index, proposal] of audit.proposals.entries()) {
    const { hash, cv } = resumes[index];
    if (proposal.about !== cv.about) changes.push({ kind: 'about', resumeHash: hash,
      target: { about: cv.about }, fields: { about: proposal.about }, audit: { missingBefore: proposal.missing } });
  }
  return { ...audit, unmatched, changes: [...changes.filter((change) => change.kind === 'about'), ...changes.filter((change) => change.kind !== 'about')] };
}

/** Verify completeness after manual saves, independently of the desired text formatting. */
export function verifyCvTechnologyCoverage(resumes, catalog = new Map(), options = {}) {
  const normalize = createTechnologyNormalizer(catalog);
  const audit = auditCvTechnologies(resumes.map((resume) => resume.cv), catalog, options);
  const inventories = resumes.map(({ hash, cv }) => {
    const terms = Object.values(parseAboutInventory(cv.about).categories).flat().flatMap(components);
    const ids = terms.map((term) => normalize(term).id);
    return { hash, language: cv.language, count: ids.length, ids,
      duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
      missing: audit.technologies.filter((item) => !ids.includes(item.id)).map((item) => item.canonical) };
  });
  const plan = planCvTechnologySync(resumes, catalog, options);
  const positionDifferences = plan.changes.filter((change) => change.kind === 'update');
  const aliasGaps = audit.proposals.map((proposal) => ({ language: proposal.language, missing: proposal.missingAliases }));
  const legacyAliasSections = resumes.filter(({ cv }) => parseAboutInventory(cv.about).aliases.length).map(({ cv }) => cv.language);
  const categoryDifferences = resumes.flatMap(({ cv }, index) => {
    const actual = parseAboutInventory(cv.about).categories;
    return Object.entries(audit.proposals[index].categories).filter(([category, terms]) => JSON.stringify(actual[category]) !== JSON.stringify(terms))
      .map(([category]) => ({ language: cv.language, category }));
  });
  const complete = inventories.every((item) => !item.duplicates.length && !item.missing.length) && !positionDifferences.length && !plan.unmatched.length &&
    aliasGaps.every((item) => !item.missing.length) && !legacyAliasSections.length && !categoryDifferences.length;
  return { complete,
    technologies: audit.technologies.length, inventories, positionDuplicates: audit.positionDuplicates,
    unmatched: plan.unmatched, aliasGaps, legacyAliasSections, categoryDifferences,
    positionDifferences: positionDifferences.map((change) => ({ resumeHash: change.resumeHash, company: change.target.company, ...change.audit })) };
}
