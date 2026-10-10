/**
 * Tests for the experience sync core: periods, normalization of both sides, matching jobs across
 * Cyrillic and Latin names, the diff through translations, the sync plan and the report
 */
import { describe, test, assert } from 'test-anywhere';
import {
  applySyncDecision, companyKey, companySimilarity, detectLanguage, diffExperience, formatChange, formatDiffReport,
  linkedInItemsFromText, matchJobs, withEditLinks, normalizeHhJobs, normalizeLinkedInJobs, parseLinkedInPosition, parseMonthYear, parsePeriod, planSync,
  textSimilarity,
} from '../src/experience.mjs';
import { hasFillableFields, isLinkedInLoginPage, linkedInExperienceUrl } from '../src/experience-sites.mjs';

describe('LinkedIn pages', () => {
  test('login and sign-up walls are recognized', () => {
    assert.ok(isLinkedInLoginPage('https://www.linkedin.com/authwall?trk=bf&sessionRedirect=x'));
    assert.ok(isLinkedInLoginPage('https://www.linkedin.com/login?session_redirect=x'));
    assert.ok(!isLinkedInLoginPage('https://www.linkedin.com/in/konard/details/experience/'));
  });

  test('the experience page of a profile', () => {
    assert.equal(linkedInExperienceUrl('https://www.linkedin.com/in/konard/'), 'https://www.linkedin.com/in/konard/details/experience/');
  });
});

const NOW = new Date('2026-10-10T00:00:00Z');

const RESUME = {
  url: 'https://hh.ru/resume/abc',
  jobs: [
    { company: 'ООО "ЕВИРМА"', position: 'Tech Lead', period: 'Май 2026 — настоящее время 6 месяцев', description: 'Автоматизация программирования сервисов на PHP и GO.' },
    { company: 'Kaiten', position: 'Руководитель команды разработки', period: 'Июль 2024 — Ноябрь 2025 1 год 5 месяцев', description: 'Руководство командой разработки.' },
    { company: 'ООО «Абракар»', position: 'Программист', period: 'Июль 2020 — Август 2022 2 года 2 месяца', description: '' },
  ],
  stack: {
    jobs: [
      { company: 'ООО "ЕВИРМА"', stack: [], mentioned: ['PHP', 'Go'] },
      { company: 'Kaiten', stack: ['TypeScript', 'Node.js'], mentioned: ['node.js'] },
      { company: 'ООО «Абракар»', stack: ['C#'], mentioned: [] },
    ],
  },
};

const LINKEDIN_ITEMS = [
  {
    lines: ['Tech Lead', 'Evirma · Full-time', 'May 2026 - Present · 6 mos', 'Remote',
      'Automation of PHP and Go services programming.', 'Skills: PHP · Go'],
    editUrl: 'https://www.linkedin.com/in/konard/details/experience/edit/forms/1/',
  },
  {
    lines: ['Kaiten', 'Full-time · 1 yr 5 mos', 'Moscow, Russia'],
    roles: [
      { lines: ['Head of Development', 'Jul 2024 - Nov 2025 · 1 yr 5 mos', 'Led the development team.', 'Skills: TypeScript · React'], editUrl: 'https://www.linkedin.com/edit/2' },
    ],
  },
  { lines: ['Founder', 'Deep.Foundation', 'Sep 2022 - Jun 2024 · 1 yr 10 mos'] },
];

const TRANSLATIONS = {
  'Руководитель команды разработки': ['Head of Development Team', 'Development Team Lead'],
  'Руководство командой разработки.': ['Leading the development team.'],
  'Автоматизация программирования сервисов на PHP и GO.': ['Automation of programming services in PHP and GO.'],
  Программист: ['Programmer'],
};
const translationsOf = (text) => TRANSLATIONS[text] ?? [];

describe('periods', () => {
  test('hh.ru periods, current and past', () => {
    assert.deepEqual(parsePeriod('Май 2026 — настоящее время 6 месяцев'), { start: '2026-05', end: null, current: true });
    assert.deepEqual(parsePeriod('Ноябрь 2025 — Май 2026 7 месяцев'), { start: '2025-11', end: '2026-05', current: false });
  });

  test('LinkedIn periods in English and Russian, and years only', () => {
    assert.deepEqual(parsePeriod('Jan 2015 - Jun 2020 · 5 yrs 6 mos'), { start: '2015-01', end: '2020-06', current: false });
    assert.deepEqual(parsePeriod('May 2026 - Present · 6 mos'), { start: '2026-05', end: null, current: true });
    assert.deepEqual(parsePeriod('янв. 2015 г. – июн. 2020 г. · 5 лет 6 мес.'), { start: '2015-01', end: '2020-06', current: false });
    assert.deepEqual(parsePeriod('2007 - 2008'), { start: '2007', end: '2008', current: false });
  });

  test('March is not May', () => {
    assert.equal(parseMonthYear('Март 2013'), '2013-03');
    assert.equal(parseMonthYear('мая 2013'), '2013-05');
  });
});

describe('normalization', () => {
  test('hh.ru jobs take the stack of their job as skills, without duplicates', () => {
    const jobs = normalizeHhJobs(RESUME);
    assert.equal(jobs.length, 3);
    assert.equal(jobs[1].title, 'Руководитель команды разработки');
    assert.deepEqual(jobs[1].skills, ['TypeScript', 'Node.js']);
    assert.equal(jobs[0].current, true);
    assert.equal(jobs[0].source, 'hh');
  });

  test('a LinkedIn position: company without employment type, location, description and skills', () => {
    const job = parseLinkedInPosition(LINKEDIN_ITEMS[0].lines);
    assert.equal(job.title, 'Tech Lead');
    assert.equal(job.company, 'Evirma');
    assert.equal(job.location, 'Remote');
    assert.equal(job.description, 'Automation of PHP and Go services programming.');
    assert.deepEqual(job.skills, ['PHP', 'Go']);
    assert.equal(job.start, '2026-05');
  });

  test('a LinkedIn company with several roles gives one job per role', () => {
    const jobs = normalizeLinkedInJobs(LINKEDIN_ITEMS);
    assert.equal(jobs.length, 3);
    assert.equal(jobs[1].company, 'Kaiten');
    assert.equal(jobs[1].title, 'Head of Development');
    assert.equal(jobs[1].location, 'Moscow, Russia');
    assert.equal(jobs[1].editUrl, 'https://www.linkedin.com/edit/2');
    assert.equal(jobs[2].company, 'Deep.Foundation');
  });

  test('nested parts without dates belong to the position', () => {
    const jobs = normalizeLinkedInJobs([{ lines: ['Founder', 'Links', 'Jan 2015 - Jun 2020'], roles: [{ lines: ['Skills: C# · .NET'] }] }]);
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0].skills, ['C#', '.NET']);
  });

  test('lines without dates are no position', () => {
    assert.equal(parseLinkedInPosition(['Something', 'else']), null);
  });
});

describe('matching', () => {
  test('company names meet across Cyrillic and Latin spelling and legal forms', () => {
    assert.equal(companyKey('ООО «Абракар»'), 'abrakar');
    assert.equal(companySimilarity('ООО "ЕВИРМА"', 'Evirma'), 1);
    assert.ok(companySimilarity('Kaiten', 'Deep.Foundation') < 0.3);
  });

  test('jobs pair by company and time; the rest is only on one side', () => {
    const { pairs, onlyHh, onlyLinkedin } = matchJobs(normalizeHhJobs(RESUME), normalizeLinkedInJobs(LINKEDIN_ITEMS), NOW);
    assert.equal(pairs.length, 2);
    assert.equal(pairs[0].hh.company, 'ООО "ЕВИРМА"');
    assert.equal(pairs[0].linkedin.company, 'Evirma');
    assert.deepEqual(onlyHh.map((job) => job.company), ['ООО «Абракар»']);
    assert.deepEqual(onlyLinkedin.map((job) => job.company), ['Deep.Foundation']);
  });

  test('language detection and text similarity', () => {
    assert.equal(detectLanguage('Руководитель команды разработки'), 'ru');
    assert.equal(detectLanguage('Senior software engineer, C#'), 'en');
    assert.ok(textSimilarity('Led the development team', 'Leading the development team') > 0.6);
  });
});

describe('diff', () => {
  const diff = diffExperience(normalizeHhJobs(RESUME), normalizeLinkedInJobs(LINKEDIN_ITEMS), { translationsOf, now: NOW });

  test('titles and descriptions in Russian are compared through their translations', () => {
    const kaiten = diff.pairs.find((pair) => pair.hh.company === 'Kaiten');
    assert.ok(!kaiten.differences.some((difference) => difference.field === 'title'));
    assert.ok(!kaiten.differences.some((difference) => difference.field === 'description'));
  });

  test('skills and location differences are listed', () => {
    const kaiten = diff.pairs.find((pair) => pair.hh.company === 'Kaiten');
    const skills = kaiten.differences.find((difference) => difference.field === 'skills');
    assert.deepEqual(skills.onlyHh, ['Node.js']);
    assert.deepEqual(skills.onlyLinkedin, ['React']);
    assert.ok(kaiten.differences.some((difference) => difference.field === 'location'));
  });

  test('without translations the Russian title differs', () => {
    const plain = diffExperience(normalizeHhJobs(RESUME), normalizeLinkedInJobs(LINKEDIN_ITEMS), { now: NOW });
    const kaiten = plain.pairs.find((pair) => pair.hh.company === 'Kaiten');
    assert.ok(kaiten.differences.some((difference) => difference.field === 'title'));
  });

  test('different dates are a difference', () => {
    const hh = normalizeHhJobs({ jobs: [{ company: 'Kaiten', position: 'Lead', period: 'Июль 2024 — Ноябрь 2025', description: '' }] });
    const linkedin = normalizeLinkedInJobs([{ lines: ['Lead', 'Kaiten', 'Aug 2024 - Nov 2025'] }]);
    const result = diffExperience(hh, linkedin, { now: NOW });
    assert.deepEqual(result.pairs[0].differences.map((difference) => difference.field), ['dates']);
  });

  test('the report shows each translator side by side', () => {
    const variantsOf = (text) => (TRANSLATIONS[text] ? [{ name: 'Haiku', text: TRANSLATIONS[text][0] }, { name: 'Formal AI', text: null, error: 'not translated' }] : []);
    const report = formatDiffReport(diff, { variantsOf });
    assert.ok(report.includes('Only on hh.ru'));
    assert.ok(report.includes('ООО «Абракар»'));
    assert.ok(report.includes('- Haiku: Programmer'));
    assert.ok(report.includes('- Formal AI: ❌ not translated'));
  });
});

describe('save decision', () => {
  const change = { kind: 'update', target: { company: 'Kaiten' }, source: {}, fields: { title: 'Lead' }, notes: [] };

  test('continue calls saveFn, result is saved', async () => {
    let saved = false;
    let discarded = false;
    const outcome = await applySyncDecision('continue', change, ['note'],
      async () => { saved = true; }, async () => { discarded = true; });
    assert.ok(saved, 'saveFn must be called');
    assert.ok(!discarded, 'discardFn must not be called');
    assert.equal(outcome.result, 'saved');
    assert.deepEqual(outcome.notes, ['note']);
    assert.equal(outcome.change, change);
  });

  test('skip calls discardFn, result is skipped', async () => {
    let saved = false;
    let discarded = false;
    const outcome = await applySyncDecision('skip', change, [],
      async () => { saved = true; }, async () => { discarded = true; });
    assert.ok(!saved, 'saveFn must not be called');
    assert.ok(discarded, 'discardFn must be called');
    assert.equal(outcome.result, 'skipped');
  });

  test('withdrawn calls discardFn, result is skipped', async () => {
    let discarded = false;
    const outcome = await applySyncDecision('withdrawn', change, [],
      async () => {}, async () => { discarded = true; });
    assert.ok(discarded, 'discardFn must be called on withdrawn');
    assert.equal(outcome.result, 'skipped');
  });

  test('discardFn error is swallowed (form already closed)', async () => {
    // discardFn throws because the page navigated away — must not propagate
    const outcome = await applySyncDecision('skip', change, [],
      async () => {}, async () => { throw new Error('Target closed'); });
    assert.equal(outcome.result, 'skipped');
  });
});

describe('sync plan', () => {
  const diff = diffExperience(normalizeHhJobs(RESUME), normalizeLinkedInJobs(LINKEDIN_ITEMS), { translationsOf, now: NOW });
  const translate = (text, lang) => (lang === 'en' ? TRANSLATIONS[text]?.[0] ?? text : `[ru] ${text}`);

  test('to LinkedIn: hh.ru-only jobs are added in English, LinkedIn-only jobs are kept', () => {
    const changes = planSync(diff, 'linkedin', translate);
    const add = changes.find((change) => change.kind === 'add');
    assert.equal(add.fields.title, 'Programmer');
    assert.equal(add.fields.company, 'ООО «Абракар»');
    assert.ok(!changes.some((change) => (change.target ?? change.source).company === 'Deep.Foundation'));
    const update = changes.find((change) => change.kind === 'update' && change.target.company === 'Kaiten');
    assert.deepEqual(update.fields.skills, ['Node.js']);
    assert.ok(formatChange(add, 'linkedin').startsWith('➕ Add to LinkedIn'));
  });

  test('a change with only skills or location opens no hh.ru form', () => {
    const change = { fields: { skills: ['React'], location: 'Remote' } };
    assert.equal(hasFillableFields(change, 'hh'), false);
    assert.equal(hasFillableFields(change, 'linkedin'), true);
    assert.equal(hasFillableFields({ fields: { start: '2024-08' } }, 'hh'), true);
  });

  test('to hh.ru: texts are translated to Russian and per-job skills become a note', () => {
    const changes = planSync(diff, 'hh', translate);
    const add = changes.find((change) => change.kind === 'add');
    assert.equal(add.fields.title, '[ru] Founder');
    const kaiten = changes.find((change) => change.kind === 'update' && change.target.company === 'Kaiten');
    assert.ok(kaiten.notes.some((note) => note.includes('Навыки')));
    assert.equal(kaiten.fields.location, 'Moscow, Russia');
  });
});

describe('LinkedIn positions from the page text', () => {
  const text = `Experience
Senior Software Engineer
Acme · Full-time
Jul 2024 - Present · 2 yrs 4 mos
Tel-Aviv · On-site
Built the add-ons subsystem.
C#, Java and +13 skills
Example Group
Full-time · 5 yrs
Moscow City, Russia · Remote
Team Lead
Jan 2018 - Jun 2020 · 2 yrs 6 mos
Led the team.
Developer
Jan 2015 - Dec 2017 · 3 yrs
Wrote code.
Skills used: Rust, C#.
Profile language
Русский
About
LinkedIn Corporation © 2026`;

  test('each position with its company, dates and location; the footer and skill summaries left out', () => {
    const jobs = normalizeLinkedInJobs(linkedInItemsFromText(text));
    assert.deepEqual(jobs.map((job) => [job.company, job.title, job.start, job.end]), [
      ['Acme', 'Senior Software Engineer', '2024-07', null],
      ['Example Group', 'Team Lead', '2018-01', '2020-06'],
      ['Example Group', 'Developer', '2015-01', '2017-12'],
    ]);
    assert.equal(jobs[0].location, 'Tel-Aviv');
    assert.equal(jobs[0].description, 'Built the add-ons subsystem.');
    assert.ok(!jobs[2].description.includes('Profile language'));
  });
});

describe('withEditLinks', () => {
  test('a position read from the text gets the edit link that names its title and company', () => {
    const jobs = withEditLinks([{ title: 'Senior Software Engineer', company: 'Kaiten.ru', editUrl: null }, { title: 'Web Developer', company: 'Shop', editUrl: null }], [
      { label: 'Edit Senior Software Engineer at Kaiten.ru', url: 'https://www.linkedin.com/in/x/details/experience/edit/forms/1/' },
      { label: 'Edit profile language', url: 'https://www.linkedin.com/in/x/edit/secondary-language/' },
    ]);
    assert.deepEqual(jobs.map((job) => job.editUrl), ['https://www.linkedin.com/in/x/details/experience/edit/forms/1/', null]);
  });
});
