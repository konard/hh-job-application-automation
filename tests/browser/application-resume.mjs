/** Isolated chooser test: real browser interactions, no HH.ru requests or user profile. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createApplicationResumeSelector } from '../../src/application-resume.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://cv.test/**', (route) => route.fulfill({ contentType: 'text/html', body:
    '<main><div id="chooser" style="margin-top:2000px"></div><textarea id="answer">My answer stays.</textarea><button id="send">Send application</button></main>' }));
  let documentNumber = 0;
  const mount = async (options = {}) => {
    await page.goto(`https://cv.test/applicant/vacancy_response?vacancyId=${++documentNumber}`);
    await page.evaluate((settings) => {
      Object.assign(window, { selected: 'ru1', sent: 0, opened: 0, chosen: 0, ignoreChoice: false,
        available: ['ru1', 'en1'], duplicateTitles: false }, settings);
      const title = (hash) => window.duplicateTitles ? 'Developer' : hash === 'ru1' ? 'Разработчик' : 'Senior Developer';
      const chooser = document.getElementById('chooser');
      window.render = () => {
        chooser.innerHTML = `<button type="button"><div data-qa="resume-title">${title(window.selected)}</div></button>`;
        chooser.querySelector('button').onclick = () => {
          if (document.getElementById('options')) return document.getElementById('options').remove();
          window.opened++;
          const list = document.createElement('div');
          list.id = 'options';
          list.setAttribute('data-qa', 'magritte-select-option-list');
          list.innerHTML = window.available.map((hash) => `<label role="option" data-qa="magritte-select-option-${hash}">
            <input type="radio" name="resume" value="${hash}" ${hash === window.selected ? 'checked' : ''}>
            <div data-qa="resume-title">${title(hash)}</div></label>`).join('');
          list.querySelectorAll('label').forEach((label) => {
            label.onclick = (event) => {
              event.preventDefault();
              window.chosen++;
              if (!window.ignoreChoice) window.selected = label.querySelector('input').value;
              window.render();
            };
          });
          chooser.append(list);
        };
      };
      window.render();
      document.getElementById('send').onclick = () => { window.sent++; };
    }, options);
  };
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const resumes = [{ hash: 'ru1', language: 'ru', title: 'Разработчик' },
    { hash: 'en1', language: 'en', title: 'Senior Developer' }];
  const createSelector = (catalog = resumes) => createApplicationResumeSelector({ log: () => {}, readResumes: async () => catalog });
  const select = createSelector();
  const english = { commander, questions: ['What is your expected monthly salary before taxes?'] };
  const russian = { commander, questions: ['Какой у вас опыт разработки?'] };
  const counts = () => page.evaluate(() => ({ opened: window.opened, chosen: window.chosen }));
  const preserved = async () => {
    assert.equal(await page.locator('#options').count(), 0);
    assert.equal(await page.locator('#answer').inputValue(), 'My answer stays.');
    assert.equal(await page.evaluate(() => window.sent), 0);
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Even an offscreen chooser must not move the viewport');
  };

  await mount();
  assert.deepEqual(await select(russian), { ready: true, language: 'ru', hash: 'ru1' });
  await select(russian);
  assert.deepEqual(await counts(), { opened: 0, chosen: 0 }, 'Correct current CV needs no menu access');
  await preserved();

  await mount();
  const expected = { ready: true, language: 'en', hash: 'en1' };
  assert.deepEqual(await Promise.all([select(english), select(english), select(english)]), [expected, expected, expected]);
  await select(english);
  await createSelector()(english); // The browser keeps the choice when the worker restarts.
  assert.deepEqual(await counts(), { opened: 1, chosen: 1 }, 'Switch exactly once; never reopen for verification');
  await page.evaluate(() => { window.selected = 'ru1'; window.render(); });
  await select(english);
  assert.equal(await page.evaluate(() => window.selected), 'ru1', 'Preserve a later manual CV change');
  assert.deepEqual(await counts(), { opened: 1, chosen: 1 });
  await preserved();

  await mount({ selected: 'en1' });
  await select(english);
  assert.deepEqual(await counts(), { opened: 0, chosen: 0 }, 'Correct CV on a later page needs no menu access');
  await preserved();

  await mount({ selected: 'en1' });
  assert.equal((await select(russian)).hash, 'ru1');
  assert.deepEqual(await counts(), { opened: 1, chosen: 1 }, 'A new Russian application can switch once');
  await preserved();

  await mount({ ignoreChoice: true });
  assert.equal((await select(english)).ready, false, 'Rejected CV changes block automatic submission');
  await select(english);
  assert.deepEqual(await counts(), { opened: 1, chosen: 1 }, 'Do not repeatedly try a rejected change');
  await page.evaluate(() => { window.selected = 'en1'; window.render(); });
  assert.equal((await select(english)).ready, true, 'A manual correction recovers without opening the menu');
  assert.deepEqual(await counts(), { opened: 1, chosen: 1 });
  await preserved();

  await mount({ available: ['ru1'] });
  assert.equal((await select(english)).ready, false, 'Missing English CV must not fall back to Russian');
  await select(english);
  assert.deepEqual(await counts(), { opened: 1, chosen: 0 });
  await preserved();

  await mount({ duplicateTitles: true });
  const ambiguous = createSelector(resumes.map((resume) => ({ ...resume, title: 'Developer' })));
  assert.equal((await ambiguous(english)).ready, false, 'An ambiguous collapsed title cannot verify a changed CV');
  await ambiguous(english);
  assert.deepEqual(await counts(), { opened: 1, chosen: 1 });
  await preserved();

  await mount();
  await page.locator('#chooser button').evaluate((element) => element.click());
  assert.equal((await select(russian)).hash, 'ru1');
  assert.deepEqual(await counts(), { opened: 1, chosen: 0 }, 'An existing open menu is closed without reopening');
  await preserved();

  await mount();
  await select({ ...english, vacancyId: '1001' });
  await select({ ...russian, vacancyId: '1002' });
  await select({ ...russian, vacancyId: '1002' });
  assert.deepEqual(await counts(), { opened: 2, chosen: 2 }, 'Different modal applications on one document each select once');
  await preserved();
  console.log('CV chooser checks passed: zero access for correct CVs, one switch per form, concurrent retries, restarts, manual changes and failures; no submission or draft loss.');
} finally {
  await browser.close();
}
