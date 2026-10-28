/** Isolated chooser test: real browser interactions, no HH.ru requests or user profile. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApplicationResumeSelector } from '../../src/application-resume.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<main><div id="chooser"></div><textarea id="answer">My answer stays.</textarea><button id="send">Send application</button></main>');
  await page.evaluate(() => {
    window.selected = 'ru1';
    window.sent = 0;
    window.ignoreChoice = false;
    window.available = ['ru1', 'en1'];
    const title = (hash) => hash === 'ru1' ? 'Разработчик' : 'Senior Developer';
    const chooser = document.getElementById('chooser');
    window.render = () => {
      chooser.innerHTML = `<button type="button"><div data-qa="resume-title">${title(window.selected)}</div></button>`;
      chooser.querySelector('button').onclick = () => {
        if (document.getElementById('options')) return document.getElementById('options').remove();
        const list = document.createElement('div');
        list.id = 'options';
        list.innerHTML = window.available.map((hash) => `<label role="option" data-qa="magritte-select-option-${hash}">
          <input type="radio" name="resume" value="${hash}" ${hash === window.selected ? 'checked' : ''}>
          <div data-qa="resume-title">${title(hash)}</div></label>`).join('');
        list.querySelectorAll('label').forEach((label) => {
          label.onclick = (event) => {
            event.preventDefault();
            if (!window.ignoreChoice) window.selected = label.querySelector('input').value;
            window.render();
          };
        });
        chooser.append(list);
      };
    };
    window.render();
    document.getElementById('send').onclick = () => { window.sent++; };
  });
  const commander = {
    evaluate: ({ fn, args }) => page.evaluate(fn, args),
    clickButton: ({ selector }) => page.locator(selector).click(),
    waitForSelector: ({ selector, timeout }) => page.locator(selector).first().waitFor({ timeout }),
  };
  const select = createApplicationResumeSelector({ log: () => {}, readResumes: async () => [
    { hash: 'ru1', language: 'ru' }, { hash: 'en1', language: 'en' },
  ] });
  const english = { commander, questions: ['What is your expected monthly salary before taxes?'] };
  assert.deepEqual(await select(english), { ready: true, language: 'en', hash: 'en1' });
  assert.deepEqual(await select(english), { ready: true, language: 'en', hash: 'en1' });
  assert.equal(await page.locator('#options').count(), 0);
  assert.equal((await select({ commander, questions: ['Какой у вас опыт разработки?'] })).hash, 'ru1');
  await page.evaluate(() => { window.ignoreChoice = true; });
  assert.equal((await select(english)).ready, false, 'A rejected CV change must block automatic submission');
  await page.evaluate(() => { window.available = ['ru1']; window.ignoreChoice = false; });
  assert.equal((await select(english)).ready, false, 'A missing English CV must not fall back to Russian');
  assert.equal(await page.locator('#answer').inputValue(), 'My answer stays.');
  assert.equal(await page.evaluate(() => window.sent), 0);
  console.log('Application CV checks passed: English/Russian selection, repeated selection, rejected changes and unavailable CVs; no submission or draft loss.');
} finally {
  await browser.close();
}
