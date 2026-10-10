/**
 * Tests for test assignments as repositories: employer names, the issue checks, link questions
 */
import { describe, test, assert } from 'test-anywhere';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {
  CI_CD_TEMPLATES, answerLanguage, employerStems, hiveMindTemplates, formVacancy, isAssignmentLinkQuestion, issueProblems, namedLanguages, parseIssue, parseStack,
  readAssignments, rememberAssignment, rememberFormVacancy, stackSection,
} from '../src/assignments.mjs';

const ORIGINAL = '«Натурпласт» продаёт товары, в том числе на Wildberries и Ozon. Используем 1С, Битрикс24, данные маркетплейсов и сервисов аналитики.\n' +
  'Хотим выстроить целостную систему управления с ИИ: видеть состояние бизнеса, находить проблемы и возможности.';

describe('test assignments', () => {
  test('employer names are found in the form title, joined and inflected, and «quoted» in the text', () => {
    const stems = employerStems(['Натур Пласт'], ORIGINAL);
    assert.ok(stems.includes('натур пласт'));
    assert.ok(stems.includes('натурпласт'));
    assert.ok(issueProblems({ title: 'x', body: 'Что взять для «Натурпласта»' }, { stems, original: '' }).some((problem) => problem.includes('employer')));
  });

  test('an English restatement without the employer passes; a translation kept in Russian or the original wording does not', () => {
    const stems = employerStems(['Натур Пласт'], ORIGINAL);
    const good = { title: 'Design an AI-driven business management system', body: '## Context\nThe company is a retailer selling on marketplaces (Wildberries, Ozon) and uses 1C and Bitrix24.' };
    assert.deepEqual(issueProblems(good, { stems, original: ORIGINAL }), []);
    assert.ok(issueProblems({ title: 'Задание', body: ORIGINAL.replace('«Натурпласт»', 'Компания') }, { stems, original: ORIGINAL })
      .includes('is not in English'));
    assert.ok(issueProblems({ title: 't', body: 'Хотим выстроить целостную систему управления с ИИ: видеть' }, { stems: [], original: ORIGINAL })
      .includes('repeats the original wording'));
  });

  test('the issue is read from JSON, also inside a code fence', () => {
    assert.deepEqual(parseIssue('```json\n{"title": "T", "body": "B"}\n```'), { title: 'T', body: 'B' });
    assert.equal(parseIssue('not json'), null);
  });

  test('the form question asking for the completed assignment gets the repository link', async () => {
    assert.ok(isAssignmentLinkQuestion('8. Ссылка на выполненное тестовое задание'));
    assert.ok(!isAssignmentLinkQuestion('Ссылка на LinkedIn'));
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'assignments-')), 'assignments.json');
    await rememberAssignment('https://forms.example/x', { repo: 'me/task', repoUrl: 'https://github.com/me/task', issueUrl: 'https://github.com/me/task/issues/1' }, file);
    assert.equal((await readAssignments(file))['https://forms.example/x'].repoUrl, 'https://github.com/me/task');
  });
});

describe('the stack of a test assignment', () => {
  test('languages the vacancy names are found, most mentioned first; none for a vacancy without one', () => {
    assert.deepEqual(namedLanguages('Senior Python developer: Python, FastAPI, PostgreSQL; TypeScript is a plus'), ['python', 'typescript']);
    assert.deepEqual(namedLanguages('Golang разработчик, Go (gRPC)'), ['go']);
    assert.deepEqual(namedLanguages('C# / .NET 9, ASP.NET Core'), ['csharp']);
    assert.deepEqual(namedLanguages('понимание LLM, AI-агентов, RAG, API, баз данных и интеграций; Битрикс24, 1С'), []);
  });

  test('the chosen stack maps to a hive-mind CI/CD template, and the issue asks for it', () => {
    const stack = parseStack('```json\n{"language": "Python", "stack": "FastAPI, PostgreSQL, LangChain", "reason": "Fits data integrations and LLM work."}\n```');
    assert.equal(stack.language, 'python');
    assert.equal(CI_CD_TEMPLATES[stack.language], 'link-foundation/python-ai-driven-development-pipeline-template');
    const section = stackSection(stack);
    assert.ok(section.includes('most fitting stack') && section.includes('**Python**') && section.includes('python-ai-driven-development-pipeline-template'));
    assert.equal(parseStack('{"language": "Cobol"}'), null);
    assert.equal(stack.deliverable, 'code');
  });

  test('a written deliverable asks for a document in the language of the original, not code', () => {
    const stack = parseStack('{"language": "python", "stack": "FastAPI", "reason": "Fits.", "deliverable": "document"}');
    const section = stackSection(stack, { answerIn: answerLanguage('Код не требуется. Подготовьте концепцию на две страницы.') });
    assert.ok(section.includes('written document, not code') && section.includes('**Russian**') && section.includes('`docs/`'));
    assert.ok(section.includes("replace the template's README"));
    assert.equal(answerLanguage('Write a short concept.'), 'English');
  });

  test('the templates are read from the table of the hive-mind CI/CD guide', () => {
    const guide = `| Language | Template Repository |
| --- | --- |
| JavaScript/TypeScript | [js-t](https://github.com/link-foundation/js-t) |
| Python                | [py-t](https://github.com/link-foundation/py-t) |
| C#                    | [cs-t](https://github.com/link-foundation/cs-t) |
| C/C++                 | [cpp-t](https://github.com/link-foundation/cpp-t) |
| Cobol                 | [cobol-t](https://github.com/link-foundation/cobol-t) |`;
    assert.deepEqual(hiveMindTemplates(guide), {
      javascript: 'link-foundation/js-t', typescript: 'link-foundation/js-t', python: 'link-foundation/py-t',
      csharp: 'link-foundation/cs-t', cpp: 'link-foundation/cpp-t',
    });
    assert.equal(parseStack('{"language": "C#", "stack": ".NET"}').language, 'csharp');
  });

  test('a form sent in a chat remembers its vacancy, also under the page it led to', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'form-vacancies-')), 'form-vacancies.json');
    await rememberFormVacancy(['https://forms.gle/abc', 'https://docs.google.com/forms/d/e/x/viewform'], 'https://hh.ru/vacancy/1', file);
    assert.equal(await formVacancy('https://docs.google.com/forms/d/e/x/viewform', file), 'https://hh.ru/vacancy/1');
    assert.equal(await formVacancy('https://forms.gle/other', file), null);
  });
});
