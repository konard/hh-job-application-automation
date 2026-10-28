import { describe, test, assert } from 'test-anywhere';
import { auditCvTechnologies, createTechnologyNormalizer, parseAboutInventory, planCvTechnologySync, verifyCvTechnologyCoverage } from '../src/cv-technologies.mjs';
import { rawJobStack } from '../src/resume-stack.mjs';

const aliases = new Map([['PostgreSQL', ['PostgreSQL', 'Postgres']], ['.NET Core', ['.NET Core']], ['.NET Framework', ['.NET Framework']]]);
const cvs = [
  { language: 'ru', skills: [], about: 'Моя биография.\n\nТехнические навыки\nЯзыки:\nC#, C/C++\nИнструменты:\nGit, git, Silverlight\nТехнологии:\nSilverlight, .NET Core, .NET Framework\nБазы данных:\nPostgreSQL\nЛичные:\nПечатаю быстро.\n\nТехнологии — варианты названий:\nPostgreSQL: Postgres',
    jobs: [{ company: 'A', description: 'Используемые технологии:\nAnthropic Claude Code CLI, Git, git, PostgreSQL' }] },
  { language: 'en', skills: [], about: 'My biography.\n\nTechnical Skills\nTools:\nGit\nDatabases:\nPostgres\nPersonal:\nTyping.',
    jobs: [{ company: 'A', description: 'Technologies and tools:\nOpenAI Codex CLI, .NET Core, .NET Framework' }] },
];

describe('bilingual About technology consolidation', () => {
  test('retains biography, personal text and ATS spelling variants while deduplicating globally', () => {
    const result = auditCvTechnologies(cvs, aliases);
    assert.ok(result.aboutDuplicates.some((item) => item.duplicate === 'git'));
    assert.ok(result.aboutDuplicates.some((item) => item.duplicate === 'Silverlight'));
    assert.equal(result.positionDuplicates.length, 1);
    for (const proposal of result.proposals) {
      const values = Object.values(proposal.categories).flat();
      assert.equal(values.filter((value) => value === 'Git').length, 1);
      assert.equal(values.filter((value) => value === 'Silverlight').length, 1);
      assert.ok(values.includes('.NET Core'));
      assert.ok(values.includes('.NET Framework'));
      assert.ok(values.includes('Anthropic Claude Code CLI'));
      assert.ok(values.includes('OpenAI Codex CLI'));
      assert.ok(proposal.about.includes('Postgres'));
    }
    assert.ok(result.proposals[0].about.startsWith('Моя биография.'));
    assert.ok(result.proposals[0].about.includes('Печатаю быстро.'));
    assert.ok(result.proposals[1].about.startsWith('My biography.'));
    assert.ok(result.proposals[1].about.includes('Typing.'));
  });
  test('saving and reloading the proposed inventory does not create new duplicates or aliases', () => {
    const first = auditCvTechnologies(cvs, aliases);
    const updated = cvs.map((cv, index) => ({ ...cv, about: first.proposals[index].about }));
    const second = auditCvTechnologies(updated, aliases);
    assert.equal(second.aboutDuplicates.length, 0);
    assert.deepEqual(second.proposals.map((item) => item.about), first.proposals.map((item) => item.about));
    assert.deepEqual(second.proposals.map((item) => item.missing), [[], []]);
  });
  test('related frameworks and recorded versions are not collapsed as spelling aliases', () => {
    const normalize = createTechnologyNormalizer(aliases);
    assert.ok(normalize('.NET Core').id !== normalize('.NET Framework').id);
    assert.ok(normalize('PHP').id !== normalize('PHP 8').id);
    assert.equal(normalize('Postgres').id, normalize('PostgreSQL').id);
    assert.ok(normalize('Amazon S3').id !== normalize('S3-compatible storage').id);
  });
  test('compatible storage does not become evidence of using the provider; corrected typos are not ATS aliases', () => {
    const result = auditCvTechnologies([{ language: 'en', about: 'Technical Skills\nTools:\nCuter, Teleric',
      jobs: [{ description: 'Integration with Amazon AWS S3 compatible storage (minio).' }] }], new Map([['Amazon Web Services', ['AWS']]]));
    const ids = result.technologies.map((item) => item.canonical);
    assert.ok(ids.includes('S3-compatible storage'));
    assert.ok(!ids.includes('Amazon Web Services'));
    assert.ok(!result.proposals[0].about.includes('Cuter'));
    assert.ok(!result.proposals[0].about.includes('Teleric'));
  });
  test('raw position lists expose duplicates before aggregation and handle multiline lists', () => {
    assert.deepEqual(rawJobStack('Tools:\nGit, git\nPython, GitHub\n\nOther text.'), ['Git', 'git', 'Python', 'GitHub']);
    assert.deepEqual(parseAboutInventory(cvs[0].about).categories.tools, ['Git', 'git', 'Silverlight']);
  });
  test('position lists are deduplicated and counterpart evidence is copied without losing prose', () => {
    const resumes = cvs.map((cv, index) => ({ hash: cv.language, cv: { ...cv, jobs: [{ company: 'A', position: 'Developer', start: '2024-01', end: null,
      description: `Kept opening.\n\nTools:\n${index ? 'Git, git, Lua' : 'Git'}\n\nKept closing.` }] } }));
    const plan = planCvTechnologySync(resumes, aliases);
    const roles = plan.changes.filter((change) => change.kind === 'update');
    assert.equal(roles.length, 2);
    assert.deepEqual(roles[0].audit.addedFromCounterpart, ['Lua']);
    assert.equal(roles[1].audit.removedDuplicates, 1);
    for (const change of plan.changes) {
      const cv = resumes.find((resume) => resume.hash === change.resumeHash).cv;
      if (change.kind === 'about') cv.about = change.fields.about;
      else {
        assert.ok(change.fields.description.includes('Kept opening.'));
        assert.ok(change.fields.description.includes('Kept closing.'));
        cv.jobs[0].description = change.fields.description;
      }
    }
    assert.equal(verifyCvTechnologyCoverage(resumes, aliases).complete, true);
  });
  test('translated business descriptions and Online transliteration pair by brand and dates, never by dates alone', () => {
    const resumes = [
      { hash: 'ru', cv: { language: 'ru', about: '', jobs: [
        { company: 'Интернет магазин подарков «ArtBridge»', start: '2006-11', end: '2007-08', description: 'Технологии: PHP' },
        { company: 'ООО «АльпОнлайн»', start: '2008-05', end: '2009-08', description: 'Технологии: PHP' },
      ] } },
      { hash: 'en', cv: { language: 'en', about: '', jobs: [
        { company: 'Gift Online Store "ArtBridge"', start: '2006-11', end: '2007-08', description: 'Tools: PHP, Lua' },
        { company: 'AlpOnline LLC', start: '2008-05', end: '2009-08', description: 'Tools: PHP' },
      ] } },
    ];
    const plan = planCvTechnologySync(resumes);
    assert.deepEqual(plan.unmatched, []);
    assert.deepEqual(plan.changes.find((change) => change.target.company?.includes('ArtBridge')).audit.addedFromCounterpart, ['Lua']);
    resumes[1].cv.jobs[0].company = 'Unrelated Brand';
    assert.ok(planCvTechnologySync(resumes).unmatched.length > 0);
    assert.equal(verifyCvTechnologyCoverage(resumes).complete, false);
  });
});
