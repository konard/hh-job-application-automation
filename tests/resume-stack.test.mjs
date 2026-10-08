/**
 * Tests for collecting the technology stack from a resume
 */
import { describe, test, assert } from 'test-anywhere';
import {
  collectStack, findMentionedTerms, formatStackMarkdown, jobProse, parseJobStack, parseTechnicalSkills, splitList,
} from '../src/resume-stack.mjs';

describe('splitList', () => {
  test('keeps parenthesised groups together', () => {
    assert.deepEqual(splitList('Rust, C# (.NET Core, .NET Framework), C/C++'), ['Rust', 'C# (.NET Core, .NET Framework)', 'C/C++']);
  });

  test('accepts semicolons and drops a trailing period', () => {
    assert.deepEqual(splitList('MySQL; PHP, Excel.'), ['MySQL', 'PHP', 'Excel']);
  });
});

describe('parseJobStack', () => {
  test('reads a list on the line after the label', () => {
    assert.deepEqual(parseJobStack('Разработка торговой системы.\n\nИспользуемые технологии:\nGitLab, Rust, Vue.js'), ['GitLab', 'Rust', 'Vue.js']);
  });

  test('reads a list on the label line and removes case duplicates', () => {
    assert.deepEqual(parseJobStack('Использовавшиеся навыки: Git, GitHub, git, C#.'), ['Git', 'GitHub', 'C#']);
  });

  test('returns nothing for prose only', () => {
    assert.deepEqual(parseJobStack('Руководство командой из 5-ти старших разработчиков.'), []);
  });
});

describe('parseTechnicalSkills', () => {
  test('reads categories and skips personal skills', () => {
    const about = 'Технические навыки\nПлатформы:\nWindows, Linux (Gentoo, Ubuntu)\nБазы данных:\nMS SQL, PostgreSQL\nЛичные:\nСлепая печать.';
    assert.deepEqual(parseTechnicalSkills(about), {
      'Платформы': ['Windows', 'Linux (Gentoo, Ubuntu)'],
      'Базы данных': ['MS SQL', 'PostgreSQL'],
    });
  });

  test('returns an empty object without the section', () => {
    assert.deepEqual(parseTechnicalSkills('Обо мне'), {});
  });
});

describe('findMentionedTerms', () => {
  test('matches case-insensitively at word boundaries', () => {
    assert.deepEqual(findMentionedTerms('сервисы на PHP и GO через Claude Code, ошибки в sentry', ['PHP', 'Go', 'Claude Code', 'Sentry', 'Rust']),
      ['PHP', 'Go', 'Claude Code', 'Sentry']);
  });

  test('does not count a term inside a longer one', () => {
    assert.deepEqual(findMentionedTerms('MS SQL, C/C++, Visual Studio Code', ['SQL', 'MS SQL', 'C++', 'C/C++', 'Visual Studio', 'Visual Studio Code']),
      ['MS SQL', 'C/C++', 'Visual Studio Code']);
  });

  test('skips one-letter terms', () => {
    assert.deepEqual(findMentionedTerms('PHP c использованием C', ['C', 'PHP']), ['PHP']);
  });

  test('does not match C in C#', () => {
    assert.deepEqual(findMentionedTerms('C# -> Python', ['C#', 'Python', 'Go']), ['C#', 'Python']);
  });
});

describe('jobProse', () => {
  test('removes the technology lists', () => {
    assert.equal(jobProse('Разработка.\nИспользуемые технологии:\nMS SQL, Rust\nИспользовавшиеся навыки: Go'), 'Разработка.');
  });
});

describe('collectStack', () => {
  const stack = collectStack({
    keySkills: ['SQL', 'Go', 'PostgreSQL'],
    about: 'Технические навыки\nЯзыки:\nRust, C#, PHP\nЛичные:\nПечать.',
    jobs: [
      { company: 'A', position: 'Tech Lead', period: '2026', description: 'Сервисы на PHP и GO через Claude Code, Codex.' },
      { company: 'B', position: 'Dev', period: '2025', description: 'Торговая система.\nИспользуемые технологии:\nPostgreSQL, Redis, Rust' },
    ],
  });

  test('lists every technology once, technical skills first', () => {
    assert.deepEqual(stack.all, ['Rust', 'C#', 'PHP', 'SQL', 'Go', 'PostgreSQL', 'Redis', 'Claude Code', 'Codex']);
  });

  test('separates listed and mentioned technologies per job', () => {
    assert.deepEqual(stack.jobs[0].stack, []);
    assert.deepEqual(stack.jobs[0].mentioned, ['PHP', 'Go', 'Claude Code', 'Codex']);
    assert.deepEqual(stack.jobs[1].stack, ['PostgreSQL', 'Redis', 'Rust']);
    assert.deepEqual(stack.jobs[1].mentioned, []);
  });

  test('renders Markdown', () => {
    const markdown = formatStackMarkdown(stack, { title: 'Developer', updated: 'Резюме обновлено 7 октября 2026' });
    assert.ok(markdown.includes('## All technologies (9)'));
    assert.ok(markdown.includes('- **Языки:** Rust, C#, PHP'));
    assert.ok(markdown.includes('### B — Dev (2025)\n\n- **Listed:** PostgreSQL, Redis, Rust'));
  });
});
