/**
 * Work experience of the hh.ru resume and the LinkedIn profile in one shape, matched job to job,
 * compared across languages and turned into the changes that bring one side in line with the
 * other. Pure functions: the browsers and the translators live in experience-sync.mjs and
 * translation.mjs.
 *
 * A job: { source, company, title, location, start, end, current, description, skills, editUrl }
 * with start/end as "YYYY-MM" (or "YYYY" when only the year is known) and end null while current.
 *
 * @module experience
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};
const MONTH_NAMES = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
};
const CURRENT = /present|now|настоящее|сейчас|по н\.?\s?в/i;
const DASH = /\s+[—–-]\s+|\s*[—–]\s*/;

/**
 * "Май 2026", "Jan 2015", "янв. 2015 г.", "2015" as "YYYY-MM" or "YYYY"
 * @param {string} text
 * @returns {string|null}
 */
export function parseMonthYear(text) {
  const match = String(text ?? '').match(/([a-zа-яё]+)\.?\s+(\d{4})/i);
  const month = match && MONTHS[match[1].toLowerCase().slice(0, 3)];
  if (month) {
    return `${match[2]}-${String(month).padStart(2, '0')}`;
  }
  return String(text ?? '').match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
}

/**
 * A period of hh.ru ("Май 2026 — настоящее время 6 месяцев") or LinkedIn
 * ("Jan 2015 - Jun 2020 · 5 yrs 6 mos", "May 2026 - Present")
 * @param {string} text
 * @returns {{start: string|null, end: string|null, current: boolean}}
 */
export function parsePeriod(text) {
  const [from = '', to = ''] = String(text ?? '').split('·')[0].split(DASH);
  const current = CURRENT.test(to);
  return { start: parseMonthYear(from), end: current ? null : parseMonthYear(to), current };
}

/**
 * A date of the shape above for people: "May 2026", "Май 2026", or "present"
 * @param {string|null} date
 * @param {'en'|'ru'} [lang='en']
 * @returns {string}
 */
export function formatMonthYear(date, lang = 'en') {
  if (!date) {
    return lang === 'ru' ? 'по настоящее время' : 'present';
  }
  const [year, month] = date.split('-');
  return month ? `${MONTH_NAMES[lang][Number(month) - 1]} ${year}` : year;
}

/** "Май 2026 — по настоящее время" */
export const formatPeriod = (job, lang = 'en') => `${formatMonthYear(job.start, lang)} — ${formatMonthYear(job.current ? null : job.end, lang)}`;

/**
 * The language of a text: Russian when at least 30% of its letters are Cyrillic
 * @param {string} text
 * @returns {'ru'|'en'}
 */
export function detectLanguage(text) {
  const letters = String(text ?? '').match(/\p{L}/gu) ?? [];
  const cyrillic = letters.filter((letter) => /[а-яё]/i.test(letter)).length;
  return letters.length > 0 && cyrillic / letters.length >= 0.3 ? 'ru' : 'en';
}

const uniqueSkills = (skills) => {
  const seen = new Set();
  return skills.map((skill) => String(skill).trim()).filter((skill) => {
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * hh.ru jobs of `bun run resume` (data/resume/resume.json) in the common shape. Skills are the
 * job's stack and the technologies its description mentions (resume.stack.jobs)
 * @param {Object} resume - { url, jobs: [{company, position, period, description}], stack }
 * @returns {Object[]}
 */
export function normalizeHhJobs(resume) {
  const stacks = resume?.stack?.jobs ?? [];
  return (resume?.jobs ?? []).map((job, index) => {
    const stack = stacks[index]?.company === job.company ? stacks[index] : stacks.find((item) => item.company === job.company);
    return {
      source: 'hh',
      company: job.company.trim(),
      title: job.position.trim(),
      location: (job.location ?? '').trim(),
      ...parsePeriod(job.period),
      description: (job.description ?? '').trim(),
      skills: uniqueSkills([...(stack?.stack ?? []), ...(stack?.mentioned ?? [])]),
      editUrl: job.editUrl ?? null,
    };
  });
}

const DATE_LINE = /^(?:[a-zа-яё]+\.?\s+)?\d{4}(?:\s*г\.)?\s*[—–-]\s*(?:(?:[a-zа-яё]+\.?\s+)?\d{4}|present|настоящее время|сейчас)/i;
const DURATION_LINE = /^(?:(?:full-time|part-time|полная занятость|частичная занятость|self-employed|freelance|contract)\s*·\s*)?\d+\s*(?:yrs?|mos?|years?|months?|лет|года?|мес)/i;
const EMPLOYMENT = /\s*·\s*(full-time|part-time|self-employed|freelance|contract|internship|apprenticeship|seasonal|полная занятость|частичная занятость|самозанятость|фриланс|стажировка)$/i;
const SKILLS_LINE = /^(?:skills|навыки)\s*:\s*/i;
const LOCATION_HINT = /,|[Rr]emote|[Oo]n-site|[Hh]ybrid|[Уу]дал[её]нн|[Оо]фис|[Гг]ибрид|^[A-ZА-ЯЁ][\p{L}\s-]+$/u;

/**
 * One LinkedIn position from the text lines of its list item (the visible spans, in order):
 * title, "Company · Full-time", dates, location, description..., "Skills: A · B"
 * @param {string[]} lines
 * @param {Object} [group] - The company of a grouped item (several roles at one company)
 * @returns {Object|null} Null when the lines hold no dates
 */
export function parseLinkedInPosition(lines, group = null) {
  const clean = lines.map((line) => String(line).trim()).filter(Boolean);
  const dateIndex = clean.findIndex((line) => DATE_LINE.test(line));
  if (dateIndex < 0) {
    return null;
  }
  const head = clean.slice(0, dateIndex);
  const title = head[0] ?? '';
  const companyLine = group ? '' : (head[1] ?? '');
  const rest = clean.slice(dateIndex + 1);
  let location = group?.location ?? '';
  const skillLines = rest.filter((line) => SKILLS_LINE.test(line));
  const body = rest.filter((line) => !SKILLS_LINE.test(line));
  // The line right after the dates is the location when it is short and reads like a place
  if (body[0] && body[0].length <= 80 && !/[.!?;:]$/.test(body[0]) && LOCATION_HINT.test(body[0]) && body.length >= 1) {
    location = body.shift();
  }
  return {
    source: 'linkedin',
    company: (group?.company ?? companyLine.replace(EMPLOYMENT, '')).trim(),
    title,
    location: location.replace(/\s*·\s*(remote|on-site|hybrid|удаленно|в офисе|гибрид)$/i, '').trim(),
    ...parsePeriod(clean[dateIndex]),
    description: body.join('\n').trim(),
    skills: uniqueSkills(skillLines.flatMap((line) => line.replace(SKILLS_LINE, '').split(/\s*[·,]\s*/))),
    editUrl: null,
  };
}

/**
 * LinkedIn jobs from the items read on the experience page. An item is one position, or a
 * company with several roles: then its own lines are the company, total duration and location
 * @param {Array<{lines: string[], editUrl?: string, roles?: Array<{lines: string[], editUrl?: string}>}>} items
 * @returns {Object[]}
 */
export function normalizeLinkedInJobs(items) {
  const jobs = [];
  for (let item of items ?? []) {
    // Nested parts without dates (skills, media) belong to a single position
    const datedRoles = (item.roles ?? []).filter((role) => role.lines.some((line) => DATE_LINE.test(String(line).trim())));
    if (datedRoles.length === 0 && item.roles?.length) {
      item = { ...item, lines: [...item.lines, ...item.roles.flatMap((role) => role.lines)], roles: [] };
    }
    if (item.roles?.length) {
      const lines = item.lines.map((line) => String(line).trim()).filter(Boolean);
      const location = lines.slice(1).find((line) => !DURATION_LINE.test(line) && !DATE_LINE.test(line) && LOCATION_HINT.test(line)) ?? '';
      const group = { company: lines[0].replace(EMPLOYMENT, ''), location };
      for (const role of item.roles) {
        const job = parseLinkedInPosition(role.lines, group);
        if (job) {
          jobs.push({ ...job, editUrl: role.editUrl ?? null });
        }
      }
      continue;
    }
    const job = parseLinkedInPosition(item.lines);
    if (job) {
      jobs.push({ ...job, editUrl: item.editUrl ?? null });
    }
  }
  return jobs;
}

/** Where the experience list of LinkedIn's page text ends: its footer */
const LINKEDIN_FOOTER = /^(profile language|язык профиля|about|о сервисе|linkedin corporation ©.*)$/i;
/** LinkedIn's shortened skills line of a position: «C#, Java and +13 skills» */
const SKILLS_SUMMARY = /^.+\s(?:and|и)\s\+\d+\s(?:skills?|навык\p{L}*)$/iu;

/**
 * LinkedIn positions from the experience page's text, for markup the item reader does not know:
 * each position is its title and «Company · Full-time» lines before the dates (a role of a
 * company with several roles has only its title there: the company is the line before the
 * group's total duration), up to the next position or the page footer
 * @param {string} text - innerText of the page's main element
 * @returns {Array<{lines: string[], editUrl: null, roles: []}>} Items for normalizeLinkedInJobs
 */
export function linkedInItemsFromText(text) {
  let lines = String(text ?? '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const firstDate = lines.findIndex((line) => DATE_LINE.test(line));
  if (firstDate < 0) {
    return [];
  }
  const footer = lines.findIndex((line, index) => index > firstDate && LINKEDIN_FOOTER.test(line));
  lines = lines.slice(0, footer < 0 ? lines.length : footer);
  const starts = [];
  // The company of the group the roles below belong to
  let group = null;
  lines.forEach((line, index) => {
    if (!DATE_LINE.test(line) || index === 0) {
      return;
    }
    const withCompany = index >= 2 && / · /.test(lines[index - 1]) && !DURATION_LINE.test(lines[index - 1]);
    const start = index - (withCompany ? 2 : 1);
    // The group's header lines end the position before it
    let cut = start;
    if (withCompany) {
      group = null;
    } else {
      // The first role of a group: «Company», «Full-time · 5 yrs», [location], then the roles
      for (let back = index - 2; back >= 1 && back >= index - 4; back--) {
        if (DURATION_LINE.test(lines[back]) && !DATE_LINE.test(lines[back])) {
          group = lines[back - 1];
          cut = back - 1;
          break;
        }
      }
    }
    starts.push({ start, cut, date: index, company: withCompany ? null : group });
  });
  return starts.map(({ start, date, company }, index) => {
    const end = starts[index + 1]?.cut ?? lines.length;
    const head = lines.slice(start, date);
    const body = lines.slice(date, end).filter((line) => !SKILLS_SUMMARY.test(line));
    return { lines: [...head, ...(company ? [company] : []), ...body], editUrl: null, roles: [] };
  });
}

/**
 * The edit links of LinkedIn positions read from the text, by their labels
 * («Edit Senior Software Engineer at Kaiten.ru»)
 * @param {Object[]} jobs - normalizeLinkedInJobs
 * @param {Array<{label: string, url: string}>} edits - readLinkedInExperienceItems().edits
 * @returns {Object[]} The jobs, with editUrl where a link names their title and company
 */
export function withEditLinks(jobs, edits = []) {
  const plain = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return jobs.map((job) => {
    if (job.editUrl) {
      return job;
    }
    const edit = edits.find((item) => plain(item.label) === plain(`Edit ${job.title} at ${job.company}`)) ??
      edits.find((item) => plain(item.label).includes(plain(job.title)) && plain(item.label).includes(plain(job.company)));
    return { ...job, editUrl: edit?.url ?? null };
  });
}

const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
// \b knows only Latin letters, so the word edges are spelled out
const LEGAL_FORMS = /(?<!\p{L})(ооо|зао|оао|пао|ао|ип|нко|llc|inc|ltd|gmbh|corp|corporation|company|co)(?!\p{L})\.?/giu;

/**
 * A company name for matching: no legal form or quotes, in Latin letters
 * ("ООО «Абракар»" → "abrakar")
 * @param {string} name
 * @returns {string}
 */
export function companyKey(name) {
  return String(name ?? '').toLowerCase()
    .replace(LEGAL_FORMS, ' ')
    .replace(/[а-яё]/g, (letter) => CYRILLIC_TO_LATIN[letter])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const bigrams = (text) => {
  const compact = ` ${text} `;
  const result = [];
  for (let i = 0; i < compact.length - 1; i++) {
    result.push(compact.slice(i, i + 2));
  }
  return result;
};

/** Dice coefficient of two lists (multisets) */
function dice(a, b) {
  if (a.length === 0 && b.length === 0) {
    return 1;
  }
  const counts = new Map();
  a.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  let common = 0;
  for (const item of b) {
    if (counts.get(item) > 0) {
      common++;
      counts.set(item, counts.get(item) - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

/**
 * Similarity of two company names, 0..1, across Cyrillic and Latin spelling
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function companySimilarity(a, b) {
  const [x, y] = [companyKey(a), companyKey(b)];
  if (!x || !y) {
    return 0;
  }
  if (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))) {
    return 1;
  }
  return dice(bigrams(x), bigrams(y));
}

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'of', 'in', 'on', 'to', 'a', 'an', 'as', 'by', 'at', 'or', 'via', 'using']);
const words = (text) => (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}#+.]+/gu) ?? [])
  .map((word) => word.replace(/\.+$/, ''))
  .filter((word) => word.length >= 2 && !STOP_WORDS.has(word))
  // A crude stem, so "developed" and "development" meet
  .map((word) => (word.length > 5 ? word.slice(0, 5) : word));

/**
 * Similarity of two texts in one language, 0..1 (content words, Dice)
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function textSimilarity(a, b) {
  return dice(words(a), words(b));
}

const monthIndex = (date, edge) => {
  if (!date) {
    return null;
  }
  const [year, month] = date.split('-').map(Number);
  return year * 12 + (month ? month - 1 : edge === 'end' ? 11 : 0);
};

/**
 * The months of a job as [first, last] (a current job ends now)
 * @param {Object} job
 * @param {Date} [now]
 * @returns {[number, number]|null}
 */
export function jobSpan(job, now = new Date()) {
  const start = monthIndex(job.start, 'start');
  const end = job.current || !job.end ? now.getFullYear() * 12 + now.getMonth() : monthIndex(job.end, 'end');
  return start === null ? null : [start, Math.max(start, end)];
}

/**
 * How much two jobs overlap in time: shared months over the shorter job, 0..1
 * @returns {number}
 */
export function timeOverlap(a, b, now = new Date()) {
  const [x, y] = [jobSpan(a, now), jobSpan(b, now)];
  if (!x || !y) {
    return 0;
  }
  const shared = Math.min(x[1], y[1]) - Math.max(x[0], y[0]) + 1;
  return shared > 0 ? shared / Math.min(x[1] - x[0] + 1, y[1] - y[0] + 1) : 0;
}

/**
 * Pair hh.ru jobs with LinkedIn jobs: the same company (in any spelling) at an overlapping time,
 * or the same time and a similar name. Each job is in at most one pair
 * @param {Object[]} hhJobs
 * @param {Object[]} linkedinJobs
 * @param {Date} [now]
 * @returns {{pairs: Array<{hh: Object, linkedin: Object, score: number}>, onlyHh: Object[], onlyLinkedin: Object[]}}
 */
export function matchJobs(hhJobs, linkedinJobs, now = new Date()) {
  const candidates = [];
  hhJobs.forEach((hh, i) => linkedinJobs.forEach((linkedin, j) => {
    const name = companySimilarity(hh.company, linkedin.company);
    const time = timeOverlap(hh, linkedin, now);
    const sameStart = hh.start && hh.start === linkedin.start;
    if ((name >= 0.6 && time > 0) || (time >= 0.8 && (name >= 0.3 || sameStart)) || (name >= 0.9 && !hh.start)) {
      candidates.push({ i, j, score: name * 0.5 + time * 0.5 + (sameStart ? 0.1 : 0) });
    }
  }));
  candidates.sort((a, b) => b.score - a.score);
  const usedHh = new Set();
  const usedLinkedIn = new Set();
  const pairs = [];
  for (const { i, j, score } of candidates) {
    if (!usedHh.has(i) && !usedLinkedIn.has(j)) {
      usedHh.add(i);
      usedLinkedIn.add(j);
      pairs.push({ hh: hhJobs[i], linkedin: linkedinJobs[j], score: Math.round(score * 100) / 100 });
    }
  }
  pairs.sort((a, b) => (jobSpan(b.hh, now)?.[0] ?? 0) - (jobSpan(a.hh, now)?.[0] ?? 0));
  return {
    pairs,
    onlyHh: hhJobs.filter((_, i) => !usedHh.has(i)),
    onlyLinkedin: linkedinJobs.filter((_, j) => !usedLinkedIn.has(j)),
  };
}

/** Titles at or above this similarity (after translation) are the same title */
export const TITLE_SAME = 0.5;
/** Descriptions at or above this similarity (after translation) say the same */
export const DESCRIPTION_SAME = 0.45;

/**
 * The best similarity of a text to another across its translations: a text in the other
 * language is compared through each translator's version
 * @param {string} text - Compared as is when it is in the language of `other`
 * @param {string} other
 * @param {(text: string) => string[]} translationsOf - English versions of a text
 * @returns {number}
 */
export function crossSimilarity(text, other, translationsOf) {
  const versions = detectLanguage(text) === detectLanguage(other) ? [text] : [text, ...translationsOf(text)];
  return Math.max(0, ...versions.map((version) => textSimilarity(version, other)));
}

const sameDate = (a, b) => !a || !b || a === b || a.slice(0, 4) === b && b.length === 4 || b.slice(0, 4) === a && a.length === 4;

/**
 * Differences of a matched pair. Texts in different languages are compared through their
 * translations (translationsOf gives the English versions of a Russian text)
 * @param {{hh: Object, linkedin: Object}} pair
 * @param {(text: string) => string[]} [translationsOf]
 * @returns {Array<{field: string, hh: any, linkedin: any, similarity?: number, onlyHh?: string[], onlyLinkedin?: string[]}>}
 */
export function diffPair({ hh, linkedin }, translationsOf = () => []) {
  const differences = [];
  const round = (value) => Math.round(value * 100) / 100;
  const titleSimilarity = Math.max(
    crossSimilarity(hh.title, linkedin.title, translationsOf),
    crossSimilarity(linkedin.title, hh.title, translationsOf),
  );
  if (titleSimilarity < TITLE_SAME) {
    differences.push({ field: 'title', hh: hh.title, linkedin: linkedin.title, similarity: round(titleSimilarity) });
  }
  if (!sameDate(hh.start, linkedin.start) || hh.current !== linkedin.current || (!hh.current && !sameDate(hh.end, linkedin.end))) {
    differences.push({ field: 'dates', hh: formatPeriod(hh), linkedin: formatPeriod(linkedin) });
  }
  if (hh.description || linkedin.description) {
    const similarity = !hh.description || !linkedin.description ? 0 : Math.max(
      crossSimilarity(hh.description, linkedin.description, translationsOf),
      crossSimilarity(linkedin.description, hh.description, translationsOf),
    );
    if (similarity < DESCRIPTION_SAME) {
      differences.push({ field: 'description', hh: hh.description, linkedin: linkedin.description, similarity: round(similarity) });
    }
  }
  const lower = (skills) => new Set(skills.map((skill) => skill.toLowerCase()));
  const [hhSkills, linkedinSkills] = [lower(hh.skills), lower(linkedin.skills)];
  const onlyHh = hh.skills.filter((skill) => !linkedinSkills.has(skill.toLowerCase()));
  const onlyLinkedin = linkedin.skills.filter((skill) => !hhSkills.has(skill.toLowerCase()));
  if (onlyHh.length > 0 || onlyLinkedin.length > 0) {
    differences.push({ field: 'skills', hh: hh.skills, linkedin: linkedin.skills, onlyHh, onlyLinkedin });
  }
  if (Boolean(hh.location) !== Boolean(linkedin.location)) {
    differences.push({ field: 'location', hh: hh.location, linkedin: linkedin.location });
  }
  return differences;
}

/**
 * Match both sides and diff every pair
 * @param {Object[]} hhJobs
 * @param {Object[]} linkedinJobs
 * @param {Object} [options]
 * @param {(text: string) => string[]} [options.translationsOf]
 * @param {Date} [options.now]
 * @returns {{pairs: Array<Object>, onlyHh: Object[], onlyLinkedin: Object[]}}
 */
export function diffExperience(hhJobs, linkedinJobs, { translationsOf = () => [], now = new Date() } = {}) {
  const { pairs, onlyHh, onlyLinkedin } = matchJobs(hhJobs, linkedinJobs, now);
  return {
    pairs: pairs.map((pair) => ({ ...pair, differences: diffPair(pair, translationsOf) })),
    onlyHh,
    onlyLinkedin,
  };
}

/**
 * The changes that bring the target side in line with the source side: update each matched job
 * that differs, add each job only the source has. Jobs only the target has are kept (never
 * deleted). Texts are translated to the target's language by `translate`
 * @param {Object} diff - Of diffExperience
 * @param {'linkedin'|'hh'} to - The side to change
 * @param {(text: string, lang: 'en'|'ru') => string} [translate] - Chosen translation of a text
 * @returns {Array<{kind: 'update'|'add', target: Object|null, source: Object, fields: Object, notes: string[]}>}
 */
export function planSync(diff, to, translate = (text) => text) {
  const from = to === 'linkedin' ? 'hh' : 'linkedin';
  const lang = to === 'linkedin' ? 'en' : 'ru';
  const inLanguage = (text) => (!text || detectLanguage(text) === lang ? text : translate(text, lang));
  const changes = [];
  for (const pair of diff.pairs) {
    const source = pair[from];
    const fields = {};
    const notes = [];
    for (const difference of pair.differences) {
      if (difference.field === 'title') {
        fields.title = inLanguage(source.title);
      } else if (difference.field === 'dates') {
        Object.assign(fields, { start: source.start, end: source.end, current: source.current });
      } else if (difference.field === 'description' && source.description) {
        fields.description = inLanguage(source.description);
      } else if (difference.field === 'location' && source.location) {
        fields.location = source.location;
        if (to === 'hh') {
          notes.push(`hh.ru: «Город или регион» is picked from hh.ru's list, set it yourself if needed: ${source.location}`);
        }
      } else if (difference.field === 'skills') {
        const missing = to === 'linkedin' ? difference.onlyHh : difference.onlyLinkedin;
        if (missing.length > 0) {
          fields.skills = missing;
          notes.push(to === 'hh' ? 'hh.ru keeps skills for the whole resume, not per job: add them to «Навыки» if they are missing there' : 'LinkedIn skills are added one by one in the position form');
        }
      }
    }
    if (Object.keys(fields).length > 0) {
      changes.push({ kind: 'update', target: pair[to], source, fields, notes });
    }
  }
  for (const source of to === 'linkedin' ? diff.onlyHh : diff.onlyLinkedin) {
    changes.push({
      kind: 'add',
      target: null,
      source,
      fields: {
        company: source.company,
        title: inLanguage(source.title),
        start: source.start,
        end: source.end,
        current: source.current,
        description: inLanguage(source.description),
        ...(source.location ? { location: source.location } : {}),
        ...(source.skills.length > 0 ? { skills: source.skills } : {}),
      },
      notes: [],
    });
  }
  return changes;
}

const quote = (text) => String(text ?? '').trim().split('\n').map((line) => `> ${line}`).join('\n') || '> (empty)';

/**
 * The diff as Markdown, with the translations of every compared text side by side
 * @param {Object} diff - Of diffExperience
 * @param {Object} [options]
 * @param {(text: string) => Array<{name: string, text: string|null, error?: string}>} [options.variantsOf]
 * @param {string} [options.title]
 * @returns {string}
 */
export function formatDiffReport(diff, { variantsOf = () => [], title = 'Work experience: hh.ru vs LinkedIn' } = {}) {
  const lines = [`# ${title}`, ''];
  const translations = (text) => {
    const variants = variantsOf(text);
    return variants.length === 0 ? [] : ['', '  Translations:', ...variants.map(({ name, text: translated, error }) =>
      `  - ${name}: ${translated ? translated.replace(/\n/g, ' ⏎ ') : `❌ ${error ?? 'no answer'}`}`)];
  };
  const differing = diff.pairs.filter((pair) => pair.differences.length > 0);
  lines.push(`Matched ${diff.pairs.length} job(s), ${differing.length} with differences; ${diff.onlyHh.length} only on hh.ru, ${diff.onlyLinkedin.length} only on LinkedIn.`, '');
  for (const pair of diff.pairs) {
    const head = `## ${pair.hh.company} / ${pair.linkedin.company}: ${pair.hh.title} / ${pair.linkedin.title}`;
    lines.push(head, '', `${formatPeriod(pair.hh, 'ru')} (hh.ru) · ${formatPeriod(pair.linkedin)} (LinkedIn)`, '');
    if (pair.differences.length === 0) {
      lines.push('✅ Same on both sides', '');
      continue;
    }
    for (const difference of pair.differences) {
      if (difference.field === 'skills') {
        lines.push(`- **skills**: only on hh.ru: ${difference.onlyHh.join(', ') || '-'}; only on LinkedIn: ${difference.onlyLinkedin.join(', ') || '-'}`);
      } else if (difference.field === 'dates' || difference.field === 'location') {
        lines.push(`- **${difference.field}**: hh.ru «${difference.hh || '-'}», LinkedIn «${difference.linkedin || '-'}»`);
      } else {
        lines.push(`- **${difference.field}** (similarity ${difference.similarity}):`, '', '  hh.ru:', '', quote(difference.hh).replace(/^/gm, '  '));
        lines.push(...translations(difference.hh));
        lines.push('', '  LinkedIn:', '', quote(difference.linkedin).replace(/^/gm, '  '));
        lines.push(...translations(difference.linkedin));
      }
      lines.push('');
    }
  }
  const only = (jobs, site) => {
    if (jobs.length === 0) {
      return;
    }
    lines.push(`## Only on ${site}`, '');
    for (const job of jobs) {
      lines.push(`- ${job.company}: ${job.title} (${formatPeriod(job, job.source === 'hh' ? 'ru' : 'en')})`);
      lines.push(...translations(job.title));
    }
    lines.push('');
  };
  only(diff.onlyHh, 'hh.ru');
  only(diff.onlyLinkedin, 'LinkedIn');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * Apply the user's save decision for one change: save the prefilled form on 'continue',
 * discard it on anything else (skip, withdrawn). Discard errors are swallowed so a form
 * that was already closed does not fail the run.
 * @param {'continue'|'skip'|'withdrawn'} answer
 * @param {Object} change - Of planSync
 * @param {string[]} notes
 * @param {() => Promise<void>} saveFn
 * @param {() => Promise<void>} discardFn
 * @returns {Promise<{change: Object, result: 'saved'|'skipped', notes: string[]}>}
 */
export async function applySyncDecision(answer, change, notes, saveFn, discardFn) {
  if (answer === 'continue') {
    await saveFn();
    return { change, result: 'saved', notes };
  }
  await discardFn().catch(() => {});
  return { change, result: 'skipped', notes };
}

/**
 * A planned change as text for the console and the report
 * @param {Object} change - Of planSync
 * @param {'linkedin'|'hh'} to
 * @returns {string}
 */
export function formatChange(change, to) {
  const site = to === 'linkedin' ? 'LinkedIn' : 'hh.ru';
  const lang = to === 'linkedin' ? 'en' : 'ru';
  const job = change.target ?? change.source;
  const lines = [change.kind === 'add'
    ? `➕ Add to ${site}: ${change.fields.company} — ${change.fields.title}`
    : `✏️  Update on ${site}: ${job.company} — ${job.title}`];
  for (const [field, value] of Object.entries(change.fields)) {
    if (field === 'end' || field === 'current' || (field === 'company' && change.kind === 'add')) {
      continue;
    }
    const shown = field === 'start' ? formatPeriod(change.fields, lang) : Array.isArray(value) ? value.join(', ') : value;
    lines.push(`   ${field === 'start' ? 'dates' : field}: ${String(shown).replace(/\n/g, '\n      ')}`);
  }
  lines.push(...change.notes.map((note) => `   ℹ️  ${note}`));
  return lines.join('\n');
}
