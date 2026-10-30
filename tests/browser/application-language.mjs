/** Mixed-language application recovery in an isolated browser; no live HH requests or profiles. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createApplicationResumeSelector } from '../../src/application-resume.mjs';
import { handleVacancyResponsePage } from '../../src/vacancy-response.mjs';
import { fillCoverLetter } from '../../src/cover-letter.mjs';
import { disableConfirmations } from '../../src/confirmations.mjs';

process.env.NOTIFY = '0';
disableConfirmations();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const vacancyId = '991000089';
  await page.route('https://hh.ru/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <main><form name="vacancy_response" onsubmit="event.preventDefault();window.sent++">
      <div id="chooser" style="margin-top:1300px"></div>
      <textarea name="letter" data-qa="vacancy-response-form-letter-input"></textarea>
      <div data-qa="task-body"><div data-qa="task-question">Сколько лет у вас опыта?</div><textarea name="years">Более 12 лет.</textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Ожидаемый уровень компенсации в $ или русских рублях, на руки</div><textarea name="pay">От $6 000 в месяц на руки.</textarea></div>
      <div data-qa="task-body"><div data-qa="task-question">Какой ваш опыт с новым продуктом?</div><textarea name="unknown"></textarea></div>
      <button type="submit" data-qa="vacancy-response-letter-submit">Send application</button>
    </form></main>` }));
  await page.goto(`https://hh.ru/applicant/vacancy_response?vacancyId=${vacancyId}`);
  const message = { ru: 'Здравствуйте.\nМоё сопроводительное письмо.', en: 'Hello.\nMy English cover letter.' };
  await page.locator('[name=letter]').fill(message.ru);
  await page.evaluate((vacancyId) => {
    window.selected = 'ru1'; window.opened = 0; window.chosen = 0; window.sent = 0;
    window.__hhApplicationResume = { documentId: 'old-worker', selections: {
      [vacancyId]: { ready: true, language: 'ru', hash: 'ru1' },
    } };
    const titles = { ru1: 'Разработчик', en1: 'Senior Developer' };
    const chooser = document.getElementById('chooser');
    const render = () => {
      chooser.innerHTML = `<button type="button"><div data-qa="resume-title">${titles[window.selected]}</div></button>`;
      chooser.querySelector('button').onclick = () => {
        if (document.getElementById('options')) return document.getElementById('options').remove();
        window.opened++;
        const list = document.createElement('div'); list.id = 'options';
        list.setAttribute('data-qa', 'magritte-select-option-list');
        list.innerHTML = Object.keys(titles).map((hash) => `<label role="option" data-qa="magritte-select-option-${hash}">
          <input type="radio" name="resume" value="${hash}" ${hash === window.selected ? 'checked' : ''}>
          <div data-qa="resume-title">${titles[hash]}</div></label>`).join('');
        list.querySelectorAll('label').forEach((label) => {
          label.onclick = (event) => { event.preventDefault(); window.selected = label.querySelector('input').value; window.chosen++; render(); };
        });
        chooser.append(list);
      };
    };
    render();
  }, vacancyId);
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const select = () => createApplicationResumeSelector({ log: () => {}, readResumes: async () => [
    { hash: 'ru1', language: 'ru', title: 'Разработчик' }, { hash: 'en1', language: 'en', title: 'Senior Developer' },
  ] });
  const options = { commander, MESSAGE: message, readQADatabase: async () => new Map(), addOrUpdateQA: async () => {},
    selectApplicationResume: select(), readVacancy: async () => ({ description: 'Приглашаем разработчика в международную команду.' }) };
  assert.equal((await handleVacancyResponsePage(options)).status, 'awaiting_user');
  assert.equal(await page.evaluate(() => window.selected), 'en1');
  assert.equal(await page.locator('[name=letter]').inputValue(), message.en);
  assert.equal(await page.locator('[name=years]').inputValue(), 'Более 12 лет.');
  assert.equal(await page.locator('[name=pay]').inputValue(), 'От $6 000 в месяц на руки.');
  assert.equal(await page.locator('[name=unknown]').inputValue(), '');
  assert.equal(await page.evaluate(() => window.sent), 0);
  const languageOptions = { commander, vacancyId, questions: ['Ожидаемый уровень компенсации в $ или русских рублях, на руки'] };
  await select()(languageOptions);
  await select()(languageOptions);
  assert.deepEqual(await page.evaluate(() => ({ opened: window.opened, chosen: window.chosen })), { opened: 1, chosen: 1 });
  for (const custom of ['Здравствуйте. Я изменил письмо для этой компании.', 'Здравствуйте.']) {
    await page.locator('[name=letter]').fill(custom);
    await fillCoverLetter({ commander, selector: '[name=letter]', message, language: 'en' });
    assert.equal(await page.locator('[name=letter]').inputValue(), custom, 'Preserve edited and partial letters');
  }
  await page.locator('[name=letter]').fill(message.en);
  await fillCoverLetter({ commander, selector: '[name=letter]', message, language: 'ru' });
  assert.equal(await page.locator('[name=letter]').inputValue(), message.ru, 'Unchanged templates can be corrected in either direction');
  assert.equal(await page.evaluate(() => window.sent), 0);
  await commander.destroy();
  console.log('Application language checks passed: stale CV corrected once, English template, Russian answers preserved, custom letters retained, no submission.');
} finally { await browser.close(); }
