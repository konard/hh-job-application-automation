/**
 * Tests for the CV .lino files: reading an hh.ru export, writing and reading the file back,
 * the import plan and the privacy check
 */
import { describe, test, assert } from 'test-anywhere';
import {
  formatCvLino, normalizeText, parseCvLino, pickResumeFor, planCvImport, privateDetails, quoteLino, resumeLanguage, resumeToCv,
} from '../src/cv.mjs';

const RESUME = {
  name: 'Иванов Иван',
  title: 'Программист/Разработчик',
  updated: 'Резюме обновлено 24 октября 2026 в 01:46',
  keySkills: ['PHP', 'C#'],
  about: 'Обо мне\n\nЯ программист: пишу код.\n\n\nТехнические навыки',
  jobs: [
    {
      company: 'ООО "ЕВИРМА"', position: 'Tech Lead', period: 'Май 2026 — настоящее время 6 месяцев',
      description: 'Разработка сервиса (Go).\n\nИспользуемые технологии:\nPHP 8, Symfony 7',
    },
    { company: "Rock'n'Code \"Lab\"", position: 'Developer', period: 'Январь 2015 — Июнь 2020 5 лет 6 месяцев', description: '' },
  ],
};

describe('CV files', () => {
  test('reads hh.ru\'s export: dates as YYYY-MM, the «Обо мне» heading dropped, spacing kept as one empty line', () => {
    const cv = resumeToCv(RESUME);
    assert.equal(cv.language, 'ru');
    assert.equal(cv.about, 'Я программист: пишу код.\n\nТехнические навыки');
    assert.deepEqual(cv.jobs[0], {
      company: 'ООО "ЕВИРМА"', position: 'Tech Lead', start: '2026-05', end: null,
      description: 'Разработка сервиса (Go).\n\nИспользуемые технологии:\nPHP 8, Symfony 7',
    });
    assert.equal(cv.jobs[1].end, '2020-06');
  });

  test('the language follows hh.ru\'s labels, else the text', () => {
    assert.equal(resumeLanguage({ updated: 'Resume updated 24 October 2026 at 01:46', title: 'Программист' }), 'en');
    assert.equal(resumeLanguage({ updated: '', title: 'Senior Developer' }), 'en');
    assert.equal(resumeLanguage({ updated: '', title: 'Программист' }), 'ru');
  });

  test('quotes in the quote a text does not hold', () => {
    assert.equal(quoteLino('a: b'), "'a: b'");
    assert.equal(quoteLino('ООО "Е"'), '\'ООО "Е"\'');
    assert.equal(quoteLino("it's"), '"it\'s"');
    assert.equal(quoteLino('it\'s "q"'), '`it\'s "q"`');
  });

  test('writes an indented file that reads back the same', () => {
    const cv = resumeToCv(RESUME);
    const text = formatCvLino(cv);
    assert.ok(text.startsWith("resume\n  language ru\n  name 'Иванов Иван'\n  title 'Программист/Разработчик'\n  skills\n    'PHP'\n    'C#'\n"));
    assert.ok(text.includes("      start 2026-05\n      end present\n      description\n        'Разработка сервиса (Go).'\n        ' '\n"));
    assert.deepEqual(parseCvLino(text), cv);
  });

  test('a file without the resume line is refused', () => {
    assert.throws(() => parseCvLino('cv\n  title x\n'), /starts with the line "resume"/);
  });

  test('normalizeText: spacing differences are no differences', () => {
    assert.equal(normalizeText('  a  \n\n\n\nb\n'), 'a\n\nb');
  });
});

describe('planCvImport', () => {
  const current = resumeToCv(RESUME);

  test('nothing to change for the same CV', () => {
    assert.deepEqual(planCvImport(current, parseCvLino(formatCvLino(current))), { changes: [], notes: [] });
  });

  test('changed, added and removed jobs; title, skills and about as notes', () => {
    const wanted = JSON.parse(JSON.stringify(current));
    wanted.jobs[0].description += ', ClickHouse';
    wanted.jobs[0].position = 'Team Lead';
    wanted.jobs.splice(1, 1, { company: 'Kaiten', position: 'Senior', start: '2024-07', end: '2025-11', description: 'Работа' });
    wanted.title = 'Руководитель';
    wanted.skills = ['PHP', 'Go'];
    wanted.about = 'Другой текст';
    const { changes, notes } = planCvImport(current, wanted);
    assert.equal(changes.length, 2);
    assert.equal(changes[0].kind, 'update');
    assert.deepEqual(changes[0].target, { company: 'ООО "ЕВИРМА"', title: 'Tech Lead', description: current.jobs[0].description });
    assert.deepEqual(Object.keys(changes[0].fields).sort(), ['description', 'title']);
    assert.deepEqual(changes[1].fields, { company: 'Kaiten', title: 'Senior', start: '2024-07', end: '2025-11', current: false, description: 'Работа' });
    assert.equal(notes.length, 5);
    assert.ok(notes[0].startsWith('Rock\'n\'Code "Lab" (Developer) is on hh.ru but not in the file'));
    assert.ok(notes.some((note) => note.includes('lack: Go')));
    assert.ok(notes.some((note) => note.includes('the file does not: C#')));
  });

  test('a period change sets the dates and whether the job is current', () => {
    const wanted = JSON.parse(JSON.stringify(current));
    wanted.jobs[0].end = '2026-09';
    assert.deepEqual(planCvImport(current, wanted).changes[0].fields, { start: '2026-05', end: '2026-09', current: false });
  });

  test('an exact language copy pairs before its shared original, which can be deselected separately', () => {
    const wanted = JSON.parse(JSON.stringify(current));
    wanted.jobs[0].description = 'AI-first product development. Owner-edited wording.';
    const withCopy = JSON.parse(JSON.stringify(current));
    withCopy.jobs.push(wanted.jobs[0]);
    const plan = planCvImport(withCopy, wanted, { detachExtra: true });
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].kind, 'detach');
    assert.equal(plan.changes[0].target.description, current.jobs[0].description);
    assert.deepEqual(plan.changes[0].fields, {});
    assert.equal(plan.changes.some((change) => change.kind === 'update'), false);
  });
});

describe('pickResumeFor and privateDetails', () => {
  const resumes = [
    { hash: 'a1', cv: { language: 'ru', title: 'Программист' } },
    { hash: 'b2', cv: { language: 'en', title: 'TeamLead' } },
  ];

  test('by hash, then by title, then the only one in the language', () => {
    assert.equal(pickResumeFor(resumes, { language: 'ru', title: 'x' }, 'b2').hash, 'b2');
    assert.equal(pickResumeFor(resumes, { language: 'ru', title: 'TeamLead' }).hash, 'b2');
    assert.equal(pickResumeFor(resumes, { language: 'en', title: 'New title' }).hash, 'b2');
    assert.equal(pickResumeFor([...resumes, { hash: 'c3', cv: { language: 'en', title: 'Other' } }], { language: 'en', title: 'New' }), null);
  });

  test('contacts, birth date and salary are found, by kind only', () => {
    assert.deepEqual(privateDetails(formatCvLino(resumeToCv(RESUME))), []);
    assert.deepEqual(privateDetails('Пишите: me@example.com, +7 (999) 123-45-67, t.me/me'), ['an email address', 'a phone number', 'a Telegram link']);
    assert.deepEqual(privateDetails('Желаемая зарплата 450 000 ₽'), ['a salary']);
  });
});
