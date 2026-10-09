/**
 * Tests for keeping the automation browser to one tab: which tab is kept, and that the others
 * are closed before the engine attaches (it cannot tell the tab on screen from the others)
 */
import { describe, test, assert } from 'test-anywhere';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { chooseTab, keepSingleTab } from '../src/browser-session.mjs';

const SEARCH = { id: 'A', type: 'page', url: 'https://hh.ru/search/vacancy?resume=1' };
const FORM = { id: 'B', type: 'page', url: 'https://hh.ru/applicant/vacancy_response?vacancyId=138276367' };
const GOOGLE = { id: 'C', type: 'page', url: 'https://www.google.com/search?q=cache' };

describe('chooseTab', () => {
  test('the tab the automation used last wins', () => {
    assert.equal(chooseTab([GOOGLE, SEARCH, FORM], 'A'), SEARCH);
  });

  test('without it, an open hh.ru form, then any hh.ru page', () => {
    assert.equal(chooseTab([GOOGLE, SEARCH, FORM], 'gone'), FORM);
    assert.equal(chooseTab([GOOGLE, SEARCH], null), SEARCH);
  });

  test('without hh.ru, the first tab; no tabs, none', () => {
    assert.equal(chooseTab([GOOGLE], null), GOOGLE);
    assert.equal(chooseTab([], null), null);
  });
});

describe('keepSingleTab', () => {
  test('closes every other tab and remembers the kept one', async () => {
    const closed = [];
    const targets = [GOOGLE, SEARCH, FORM, { id: 'W', type: 'service_worker', url: 'https://hh.ru/sw.js' }];
    const server = http.createServer((request, response) => {
      if (request.url === '/json/list') {
        response.end(JSON.stringify(targets));
        return;
      }
      closed.push(request.url.replace('/json/close/', ''));
      response.end('Target is closing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-tabs-'));
    try {
      fs.writeFileSync(path.join(userDataDir, 'hh-automation-tab'), 'A');
      const kept = await keepSingleTab({ port: server.address().port, userDataDir });
      assert.equal(kept.id, 'A');
      assert.deepEqual(closed, ['C', 'B']);
      assert.equal(fs.readFileSync(path.join(userDataDir, 'hh-automation-tab'), 'utf8'), 'A');
    } finally {
      server.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
