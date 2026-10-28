/** Isolated browser smoke test. No HH.ru request or signed-in profile is used.
 * Run: bun tests/browser/hh-cv-editor.mjs (requires local Chrome).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { prepareHhCvChange, observeHhCvSaves, readHhExperienceForm, readHhCvForm, verifyHhSavedForm, discardUnchangedHhAbout } from '../../src/hh-cv-editor.mjs';
import { chooseHhMonth, clickHhExperienceEdit, openHhExperienceForm } from '../../src/experience-sites.mjs';
import { applyResumeAliases } from '../../src/resume-aliases.mjs';

function fixture() {
  const source = { company: 'Example', title: 'AI Tech Lead', description: 'Исходное описание.',
    area: 'Voronezh', website: 'https://example.test',
    industry: 'Consulting Services, Marketing, Advertising, Designer, Event and PR Agencies' };
  const main = document.querySelector('main');
  const industries = ['Consulting Services', 'Marketing, Advertising, Designer, Event and PR Agencies'];
  window.saveCount = 0;
  window.aboutText = 'Biography.\n\nTechnical Skills\nTools:\nGit';
  window.about = () => {
    window.history.pushState({}, '', '/resume/edit/en/about');
    main.innerHTML = '<div role="dialog"><textarea data-qa="resume-editor-about" maxlength="10000"></textarea><button data-qa="resume-partial-edit-cancel">Cancel</button><button data-qa="resume-partial-edit-save">Save</button></div>';
    main.querySelector('textarea').value = window.aboutText;
    const field = main.querySelector('textarea');
    // SSR initially exposes an editable textarea; hydration later restores saved state.
    setTimeout(() => {
      if (!field.isConnected) return;
      field.value = window.aboutText;
      let controlled = field.value;
      let nativeTyping = false;
      field.onkeydown = () => { nativeTyping = true; };
      field.oninput = () => { if (nativeTyping) controlled = field.value; };
      field.onblur = () => { field.value = controlled; };
      field.__reactProps$fixture = { onChange: () => {}, get value() { return controlled; } };
    }, 250);
    main.querySelector('[data-qa=resume-partial-edit-save]').onclick = () => {
      window.aboutText = main.querySelector('textarea').value;
      window.saveCount++;
      window.resume();
    };
    main.querySelector('[data-qa=resume-partial-edit-cancel]').onclick = window.resume;
  };
  window.list = () => {
    main.innerHTML = `<button data-qa="list-add">Add new</button>
      <article>${source.company}<div data-qa="position-title">${source.title}</div><p>English copy.</p><button data-qa="link" class="english">Edit</button></article>
      <article>${source.company}<div data-qa="position-title">${source.title}</div><p>${source.description}</p><button data-qa="link" class="russian">Edit</button></article>`;
    main.querySelector('[data-qa=list-add]').onclick = () => window.form(false);
    main.querySelector('.russian').onclick = () => window.form(true);
    main.querySelector('.english').onclick = () => { window.form(true); main.querySelector('textarea').value = 'English copy.'; };
  };
  window.resume = () => {
    if (window.location.pathname.startsWith('/resume/edit/')) window.history.pushState({}, '', '/resume/en');
    main.innerHTML = `<button data-qa="resume-edit-button-about">Edit About</button><button data-qa="profile-experience-viewAll">Edit experience</button><section>
      <div data-qa="profile-experience-company-card">${source.company} ${source.title} ${source.description}</div>
      <button data-qa="edit-experience-button-wrong">Edit</button><button data-qa="edit-experience-button-right">Edit</button></section>`;
    main.querySelector('[data-qa=profile-experience-viewAll]').onclick = () => {
      window.history.pushState({}, '', '/profile/edit/experience?resumeFrom=en');
      window.list();
    };
    main.querySelector('[data-qa=resume-edit-button-about]').onclick = window.about;
    main.querySelector('[data-qa=edit-experience-button-wrong]').onclick = () => { window.form(true); main.querySelector('textarea').value = 'English copy.'; };
    main.querySelector('[data-qa=edit-experience-button-right]').onclick = () => window.form(true);
  };
  window.form = (existing) => {
    main.innerHTML = `<label>Company<input name="company"></label><label>Position<input name="position"></label>
      <div data-qa="resume-editor-experience-area-input" role="combobox" aria-label="City or region">
        City or region<span data-qa="trigger-values-wrapper">${existing ? source.area : ''}</span></div>
      <input data-qa="resume-editor-experience-company-url-input">
      <div data-qa="trigger-root">Company's field of activity<span class="industry">${existing ? source.industry : ''}</span></div>
      <div data-qa="resume-editor-experience-start-month-input"><div data-qa="magritte-select-activator">Month<span data-qa="trigger-values-wrapper">${existing ? 'Май' : ''}</span></div>
        <input role="combobox" style="display:none" aria-label="Month"></div>
      <input data-qa="resume-editor-experience-start-year-input">
      <div data-qa="resume-editor-experience-end-month-input"><div data-qa="magritte-select-activator">Month<span data-qa="trigger-values-wrapper"></span></div>
        <input role="combobox" style="display:none" aria-label="Month"></div>
      <input data-qa="resume-editor-experience-end-year-input">
      <input type="checkbox" data-qa="resume-editor-experience-present-checkbox">
      <textarea data-qa="resume-editor-experience-description-input"></textarea>
      <label>RU<input type="checkbox" data-qa="profile-resumes-list-checkbox-ru" checked></label>
      <label>EN<input type="checkbox" data-qa="profile-resumes-list-checkbox-en" checked></label>
      <button data-qa="profile-layout-cancel-button">Cancel</button><button data-qa="profile-layout-save-button">Save</button>`;
    const set = (selector, value) => { main.querySelector(selector).value = value; };
    set('[name=company]', existing ? source.company : '');
    set('[name=position]', existing ? source.title : '');
    set('textarea', existing ? source.description : '');
    set('[data-qa=resume-editor-experience-company-url-input]', existing ? source.website : '');
    set('[data-qa=resume-editor-experience-start-year-input]', existing ? '2026' : '');
    main.querySelector('[data-qa=resume-editor-experience-present-checkbox]').checked = existing;
    main.querySelector('[data-qa=profile-layout-cancel-button]').onclick = window.list;
    main.querySelector('[data-qa=profile-layout-save-button]').onclick = () => {
      window.saveCount++;
      window.list();
    };
    for (const field of main.querySelectorAll('[data-qa$="-month-input"]')) {
      const trigger = field.querySelector('div');
      const input = field.querySelector('input');
      const open = () => {
        document.querySelector('.options')?.remove();
        const list = document.createElement('div');
        list.className = 'options';
        list.innerHTML = '<button role="option">Май</button><button role="option">Ноябрь</button>';
        list.onclick = (event) => {
          field.querySelector('[data-qa=trigger-values-wrapper]').textContent = event.target.textContent;
          list.remove();
        };
        document.body.append(list);
      };
      trigger.onclick = () => { trigger.style.visibility = 'hidden'; input.style.display = ''; open(); };
      input.onkeydown = (event) => { if (event.key === 'ArrowDown') { open(); } };
    }
    main.querySelector('[data-qa=resume-editor-experience-area-input]').onclick = (event) => {
      if (event.target.tagName === 'INPUT') { return; }
      const input = document.createElement('input');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-label', 'City or region');
      main.append(input);
      const option = document.createElement('button');
      option.setAttribute('role', 'option');
      option.textContent = 'Voronezh';
      option.onclick = () => {
        main.querySelector('[data-qa=resume-editor-experience-area-input] span').textContent = 'Voronezh';
        option.remove(); input.remove();
      };
      main.append(option);
    };
    main.querySelector('[data-qa=trigger-root]').onclick = () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<input data-qa="tree-selector-search-input"><div class="items"></div><button class="reset">Reset</button><button class="apply">Save</button>';
      let selected = [];
      dialog.querySelector('.reset').onclick = () => { selected = []; };
      dialog.querySelector('input').oninput = (event) => {
        const items = dialog.querySelector('.items');
        items.innerHTML = '';
        industries.filter((label) => label.includes(event.target.value)).forEach((label) => {
          const item = document.createElement('span');
          item.setAttribute('data-qa', 'tree-selector-item-text'); item.textContent = label;
          item.onclick = () => { selected.push(label); }; items.append(item);
        });
      };
      dialog.querySelector('.apply').onclick = () => {
        main.querySelector('.industry').textContent = selected.join(', ');
        dialog.remove();
      };
      document.body.append(dialog);
    };
  };
  if (window.location.pathname === '/profile/edit/experience/123') {
    window.form(true);
  } else if (window.location.pathname === '/profile/edit/experience') {
    window.list();
  } else {
    window.resume();
    if (window.location.pathname === '/resume/direct-add') {
      main.querySelector('[data-qa=profile-experience-viewAll]').remove();
      const wrong = document.createElement('button');
      wrong.setAttribute('data-qa', 'list-add');
      wrong.textContent = 'Add education';
      wrong.onclick = () => { window.wrongAddClicked = true; };
      main.append(wrong);
    }
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/*', (route) => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html lang="en"><main></main><script>(${fixture.toString()})()</script></html>` }));
  const page = await context.newPage();
  // Inline-edit resumes can have Add buttons for unrelated sections and no View all link.
  await page.goto('https://hh.ru/resume/direct-add');
  const addNotes = await openHhExperienceForm(page, { resumeHash: 'direct-add', job: null });
  assert.deepEqual(addNotes, []);
  assert.equal(new URL(page.url()).pathname, '/profile/edit/experience');
  assert.equal((await readHhExperienceForm(page)).company, '');
  assert.equal(await page.evaluate(() => window.saveCount), 0);
  await page.goto('https://hh.ru/resume/en');
  await page.setContent(`<main><div data-qa="profile-experience-company-card"><h2>Example</h2>
    <section>AI Tech Lead<p>English copy.</p><button data-qa="edit-experience-button-en" onclick="window.clicked='en'">Edit</button></section>
    <section>AI Tech Lead<p>Исходное описание.</p><button data-qa="edit-experience-button-ru" onclick="window.clicked='ru'">Edit</button></section>
    </div></main>`);
  const target = { company: 'Example', title: 'AI Tech Lead', description: 'Исходное описание.',
    editButton: '[data-qa^="edit-experience-button-"]', card: '[data-qa="profile-experience-company-card"]' };
  assert.equal(await page.evaluate(clickHhExperienceEdit, target), true);
  assert.equal(await page.evaluate(() => window.clicked), 'ru');
  assert.equal(await page.evaluate(clickHhExperienceEdit, { ...target, description: '' }), false);
  await page.goto('https://hh.ru/resume/en');
  const prepared = await prepareHhCvChange(page, {
    kind: 'update', target: { company: 'Example', title: 'AI Tech Lead', description: 'Исходное описание.' },
    fields: { description: 'AI-first development.' },
  }, { resumeHash: 'en' });
  assert.equal(prepared.kind, 'copy');
  assert.equal(prepared.draft.area, 'Voronezh');
  assert.equal(prepared.draft.website, 'https://example.test');
  assert.equal(prepared.draft.industryText, 'Consulting Services, Marketing, Advertising, Designer, Event and PR Agencies');
  assert.equal(prepared.draft.start, '2026-05');
  assert.deepEqual(prepared.draft.resumes.filter((resume) => resume.checked).map((resume) => resume.hash), ['en']);
  assert.equal(await page.evaluate(() => window.saveCount), 0);
  await assert.rejects(() => prepareHhCvChange(page, { kind: 'add', fields: { company: 'Another' } }, { resumeHash: 'en' }), /finish the existing form/);
  assert.equal((await readHhExperienceForm(page)).description, 'AI-first development.');

  // Reopen the date chooser whose static trigger is hidden; the other date stays intact.
  const notes = [];
  await chooseHhMonth(page, 1, '2025-11', notes);
  assert.deepEqual(notes, []);
  assert.equal((await readHhExperienceForm(page)).start, '2026-05');
  await chooseHhMonth(page, 1, '2025-11', notes);
  assert.deepEqual(notes, []);

  let observed;
  let resolve;
  const saved = new Promise((done) => { resolve = done; });
  const stop = await observeHhCvSaves(page, { onSaved: (form) => { observed = form; resolve(); return true; } });
  await page.locator('textarea').fill('Owner changed the draft before Save.');
  await page.locator('[data-qa=profile-layout-save-button]').click();
  await saved;
  assert.equal(observed.description, 'Owner changed the draft before Save.');
  assert.equal(await page.evaluate(() => window.saveCount), 1);
  stop();

  await prepareHhCvChange(page, prepared.followup, { resumeHash: 'en' });
  const detached = await readHhExperienceForm(page);
  assert.equal(detached.description, 'Исходное описание.');
  assert.deepEqual(detached.resumes.filter((resume) => resume.checked).map((resume) => resume.hash), ['ru']);
  assert.equal(await page.evaluate(() => window.saveCount), 0); // new fixture document
  let cancelledSaveCalls = 0;
  const stopCancelled = await observeHhCvSaves(page, { onSaved: () => { cancelledSaveCalls++; } });
  // A rejected save leaves the form open. A later Cancel must not turn it into success.
  await page.evaluate(() => {
    document.querySelector('[data-qa=profile-layout-save-button]').onclick = () => {};
  });
  await page.locator('[data-qa=profile-layout-save-button]').click();
  await page.waitForTimeout(600);
  assert.equal(cancelledSaveCalls, 0);
  await page.locator('[data-qa=profile-layout-cancel-button]').click();
  await page.waitForTimeout(1100);
  assert.equal(cancelledSaveCalls, 0);
  stopCancelled();
  // A checkpoint's stored record ID bypasses layout matching, still verifying all fields.
  const byId = await prepareHhCvChange(page, { kind: 'detach', target: { ...target, entryId: '123' }, fields: {} }, { resumeHash: 'en' });
  assert.equal(byId.before.description, 'Исходное описание.');
  assert.deepEqual(byId.draft.resumes.filter((resume) => resume.checked).map((resume) => resume.hash), ['ru']);
  await page.locator('[data-qa=profile-layout-cancel-button]').click();
  const about = await prepareHhCvChange(page, { kind: 'about', fields: { about: 'Biography.\n\nTechnical Skills\nTools:\nGit, Codex' },
    target: { about: 'Biography.\n\nTechnical Skills\nTools:\nGit' } }, { resumeHash: 'en' });
  assert.equal(about.draft.kind, 'about');
  assert.equal(about.draft.resumeHash, 'en');
  assert.equal((await prepareHhCvChange(page, { kind: 'about', fields: { about: about.draft.about } }, { resumeHash: 'en' })).draft.about, about.draft.about);
  await assert.rejects(() => prepareHhCvChange(page, { kind: 'about', fields: { about: 'Different draft.' } }, { resumeHash: 'en' }), /existing CV draft/);
  assert.equal(await page.evaluate(() => window.saveCount), 0);
  await assert.rejects(() => prepareHhCvChange(page, { kind: 'add', fields: {} }, { resumeHash: 'en' }), /finish the existing form/);
  let aboutSaved;
  let aboutResolve;
  const aboutDone = new Promise((resolve) => { aboutResolve = resolve; });
  const stopAbout = await observeHhCvSaves(page, { onSaved: async (form) => {
    aboutSaved = form;
    assert.equal(verifyHhSavedForm(form, [{ hash: 'en', cv: { about: await page.evaluate(() => window.aboutText) } }]), true);
    aboutResolve();
    return true;
  } });
  await page.locator('[data-qa=resume-editor-about]').fill('Owner changed About before Save.');
  assert.equal((await readHhCvForm(page)).about, 'Owner changed About before Save.');
  await page.locator('[data-qa=resume-partial-edit-save]').click();
  await aboutDone;
  assert.equal(aboutSaved.about, 'Owner changed About before Save.');
  assert.equal(aboutSaved.kind, 'about');
  stopAbout();
  await page.locator('[data-qa=resume-edit-button-about]').click();
  const originalAbout = await readHhCvForm(page);
  await page.locator('[data-qa=resume-editor-about]').fill('An unsaved edit.');
  await assert.rejects(() => discardUnchangedHhAbout(page, { resumeHash: 'en', expectedAbout: originalAbout.about }), /was not discarded/);
  assert.equal((await readHhCvForm(page)).about, 'An unsaved edit.');
  await discardUnchangedHhAbout(page, { resumeHash: 'en', expectedAbout: 'An unsaved edit.' });
  assert.equal(await readHhCvForm(page), null);
  const aliasDraft = await applyResumeAliases(page, { resume: { hash: 'en', title: 'Developer', keySkills: ['Go'], jobs: [] },
    aliases: [{ canonical: 'Go', spelling: 'Golang' }], catalog: new Map([['Go', ['Go', 'Golang']]]) });
  assert.equal(aliasDraft.pending, true);
  assert.ok((await readHhCvForm(page)).about.includes('Go (Golang)'));
  assert.equal(await page.evaluate(() => window.saveCount), 0); // fresh fixture document, no Save
  let verificationAttempts = 0;
  let saveAttempts = 0;
  let retriedResolve;
  const retried = new Promise((resolve) => { retriedResolve = resolve; });
  const stopRetry = await observeHhCvSaves(page, { onAttempt: () => { saveAttempts++; }, onError: () => {}, onSaved: () => {
    verificationAttempts++;
    if (verificationAttempts === 1) throw new Error('Temporary export timeout');
    retriedResolve();
    return true;
  } });
  await page.locator('[data-qa=resume-partial-edit-save]').click();
  await retried;
  assert.equal(saveAttempts, 1);
  assert.equal(verificationAttempts, 2);
  stopRetry();
  console.log('Browser checks passed: shared copy, metadata, language selection, draft protection, dates, exact user-save capture and deselection without deletion.');
} finally {
  await browser.close();
}
