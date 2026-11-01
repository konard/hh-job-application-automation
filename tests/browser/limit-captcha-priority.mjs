/** Daily refusal over a CAPTCHA, without any real challenge, HH request or user profile. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { createDailyLimitPriority, prepareApplicationLimit, readVisibleApplicationLimit, waitForApplicationLimit } from '../../src/application-limits.mjs';
import { withCaptchaGuard, isDailyLimitInterrupted } from '../../src/captcha.mjs';
import { createQADatabase } from '../../src/qa-database.mjs';
import { saveQAPairs } from '../../src/vacancy-response.mjs';
import { saveApplicationDraft, readApplicationDraft } from '../../src/application-drafts.mjs';

process.env.NODE_ENV = 'test';
process.env.NOTIFY = '0';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'limit-captcha-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let raw;
try {
  const page = await browser.newPage();
  const id = '991020001', url = `https://hh.ru/applicant/vacancy_response?vacancyId=${id}`;
  const message = 'You cannot send more than 200 applications per 24-hour period. You have reached your application limit, try sending a new application later.';
  await page.route('https://hh.ru/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <form id="RESPONSE_MODAL_FORM_ID" name="vacancy_response" onsubmit="event.preventDefault();window.applicationSubmits++">
      <input type="hidden" name="vacancy_id" value="${id}">
      <textarea name="letter">My custom complete cover letter.</textarea>
      <div data-qa="task-body"><div data-qa="task-question">Your relevant experience?</div><textarea name="experience">Owner-approved answer.</textarea></div>
      <div data-qa-popup-error-code="negotiations-limit-exceeded" hidden>${message}</div>
      <button type="submit">Send application</button>
    </form><script>window.applicationSubmits=0;window.captchaSubmits=0;window.renewals=0;window.dismissals=0;</script>` }));
  await page.goto(url);
  const mount = async () => page.evaluate(() => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<form><h2>Complete the CAPTCHA</h2><button type="button" id="captcha-close"><svg aria-hidden="true"></svg></button>' +
      '<input name="captchaText" data-qa="account-captcha-input"><button type="button" data-qa="captcha-renew-text">Other text</button>' +
      '<button type="submit">Submit</button></form>';
    document.body.append(dialog);
    dialog.querySelector('input').getBoundingClientRect();
    Object.defineProperty(dialog.querySelector('input'), 'value', { get() { throw new Error('Never read a CAPTCHA answer'); } });
    dialog.querySelector('#captcha-close').onclick = () => { window.dismissals++; dialog.remove(); };
    dialog.querySelector('[data-qa=captcha-renew-text]').onclick = () => { window.renewals++; };
    dialog.querySelector('form').onsubmit = event => { event.preventDefault(); window.captchaSubmits++; };
  });
  await mount();
  // Hidden templates and unrelated errors must not dismiss a real manual CAPTCHA.
  assert.equal(await page.evaluate(readVisibleApplicationLimit, { dismissCaptcha: true }), null);
  assert.equal(await page.evaluate(readVisibleApplicationLimit, { dismissCaptcha: true, knownLimitUntil: Date.now() - 1000, expectedUrl: url }), null);
  assert.equal(await page.locator('[role=dialog]').count(), 1);
  await page.locator('[data-qa-popup-error-code]').evaluate(e => { e.hidden = false; e.style.opacity = '0'; });
  assert.equal(await page.evaluate(readVisibleApplicationLimit, { dismissCaptcha: true }), null);
  await page.locator('[data-qa-popup-error-code]').evaluate(e => { e.style.opacity = ''; });

  raw = makeBrowserCommander({ page, enableNavigationManager: false, enableNetworkTracking: false });
  const db = createQADatabase(path.join(directory, 'qa.lino'));
  let time = Date.now(), polls = 0, refreshes = 0, assisted = 0, alerts = 0, silenced = 0;
  const events = [];
  const saveAnswers = commander => saveQAPairs({ commander, addOrUpdateQA: db.addOrUpdateQA, strict: true });
  const prepare = args => prepareApplicationLimit({ ...args, now: () => time, getEvents: () => events,
    record: (type, data) => events.push({ type, at: new Date(time).toISOString(), ...data }),
    saveDraft: args => saveApplicationDraft({ ...args, directory }) });
  raw.wait = async ({ reason, ms }) => {
    assert.equal(reason, 'daily application limit cooldown');
    assert.ok(ms <= 1000);
    if (++polls === 1) {
      assert.equal(await page.locator('[role=dialog]').count(), 0);
      assert.equal((await readApplicationDraft(id, directory)).fields.find(f => f.name === 'letter').value, 'My custom complete cover letter.');
      await page.locator('[name=experience]').fill('Latest edit during the account pause.');
      await mount();
      await page.locator('[data-qa-popup-error-code]').evaluate(e => { e.hidden = true; });
      time += 1000;
    } else {
      assert.equal(await page.locator('[role=dialog]').count(), 0, 'A late/remounted CAPTCHA is closed during the hold');
      assert.equal((await db.readQADatabase()).get('Your relevant experience?'), 'Latest edit during the account pause.');
      await page.locator('[data-qa-popup-error-code]').evaluate(e => { e.hidden = false; });
      time = events.find(e => e.type === 'limit_reached').until;
    }
    return {};
  };
  raw.goto = async ({ url }) => { refreshes++; await page.goto(url); };
  const hooks = createDailyLimitPriority({ prepare, saveAnswers,
    now: () => time, getEvents: () => events, saveDraft: args => saveApplicationDraft({ ...args, directory }),
    silence: () => { silenced++; }, record: (type, data) => events.push({ type, ...data }), log: () => {},
    wait: args => waitForApplicationLimit({ ...args, now: () => time }),
  });
  const guarded = withCaptchaGuard(raw, { ...hooks,
    onCaptcha: async () => { assisted++; }, alert: () => { alerts++; return () => {}; },
  });
  await assert.rejects(guarded.clickButton({ selector: 'button[type="submit"]' }), isDailyLimitInterrupted);
  assert.equal(assisted, 0);
  assert.equal(alerts, 0);
  assert.ok(silenced > 0);
  assert.equal(refreshes, 1);
  assert.equal(events.filter(e => e.type === 'limit_reached').length, 1, 'Polling never extends the original deadline');
  assert.equal(events.filter(e => e.type === 'captcha_dismissed_for_limit').length, 2);
  assert.equal(await page.evaluate(() => window.applicationSubmits + window.captchaSubmits + window.renewals), 0);
  assert.equal((await readApplicationDraft(id, directory)).fields.find(f => f.name === 'experience').value, 'Latest edit during the account pause.');
  console.log('Limit/CAPTCHA priority passed: save before close; no CAPTCHA reads/submits/renewals; hidden false positives rejected; remount handled; edited answers saved; fixed deadline; stale Send cancelled.');
} finally { await raw?.destroy(); await browser.close(); await fs.rm(directory, { recursive: true, force: true }); }
