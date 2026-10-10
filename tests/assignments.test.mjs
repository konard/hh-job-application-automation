/**
 * Tests for test assignments as repositories: employer names, the issue checks, link questions
 */
import { describe, test, assert } from 'test-anywhere';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import {
  employerStems, isAssignmentLinkQuestion, issueProblems, parseIssue, readAssignments, rememberAssignment,
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
