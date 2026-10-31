/** Already-read acknowledgements: actual chat input/send, isolated from HH and user profiles. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { readChatIn } from '../../src/chat-answers.mjs';
import { sendChatAnswer } from '../../src/instant-chat.mjs';
import { createAcknowledgementResponder } from '../../src/acknowledgement-replies.mjs';
import { pageShowsCaptcha, CAPTCHA_SELECTORS, CAPTCHA_TEXTS } from '../../src/captcha.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'acknowledgement-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://hh.ru/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <div data-qa="participant-info-title">Employer</div>
    <div data-qa="chatik-header-sub-header"><a href="https://hh.ru/vacancy/777">Engineer</a></div>
    <div id="messages"><div data-qa="chatik-chat-message-91"><div data-qa="chat-bubble-wrapper">
      <div data-qa="chat-bubble-text">Добрый день! Спасибо за Ваш отклик! Мы рассмотрим Ваше резюме в ближайшее время и вернемся с обратной связью.</div></div></div></div>
    <textarea data-qa="text-input"></textarea><button data-qa="chat-send" onclick="
      window.sent++; const row=document.createElement('div'); row.dataset.qa='chatik-chat-message-92';
      const status=document.createElement('span');status.dataset.qa='status-icon-delivered';row.append(status);
      const text=document.createElement('div');text.dataset.qa='chat-bubble-text';text.textContent=document.querySelector('textarea').value;row.append(text);
      document.getElementById('messages').append(row);document.querySelector('textarea').value='';">Send</button>
    <script>window.sent=0;window.active=false;</script>` }));
  const templates = new Map([['Рассмотрим резюме и свяжемся с вами.', 'Здравствуйте, благодарю, ожидаю.']]);
  const options = { readChat: () => readChatIn(page), readTemplates: async () => templates,
    readDraft: () => page.locator('textarea').inputValue(), maySend: async () => await page.evaluate(() => !window.active) &&
      !await page.evaluate(pageShowsCaptcha, { selectors: CAPTCHA_SELECTORS, texts: CAPTCHA_TEXTS }),
    send: (id, reply) => sendChatAnswer(page.mainFrame(), id, reply) };
  const respond = createAcknowledgementResponder({ directory });
  await page.goto('https://hh.ru/chat/123451');
  assert.equal((await respond(options)).status, 'sent');
  assert.equal(await page.evaluate(() => window.sent), 1);
  assert.equal((await respond(options)).status, 'left_for_user', 'The outgoing reply ends the flow');
  assert.equal(await page.evaluate(() => window.sent), 1);

  await page.goto('https://hh.ru/chat/123455');
  await page.evaluate(() => {
    const messages = document.getElementById('messages');
    messages.insertAdjacentHTML('afterbegin', '<div data-qa="chatik-chat-message-89"><div data-qa="chat-bubble-text">Есть ли у вас опыт с микросервисами?: ДА</div></div><div data-qa="chatik-chat-message-90"><div data-qa="chat-bubble-text">Спасибо за ответы! Мы передали их работодателю.</div></div>');
    document.querySelector('[data-qa="chatik-chat-message-91"] [data-qa="chat-bubble-text"]').textContent = 'Благодарим Вас за честные ответы чат-боту. Мы рассмотрим Ваше резюме.';
    document.body.insertAdjacentHTML('beforeend', '<div class="buttons-wrapper"><button>Здравствуйте!</button><button>Какая схема оплаты?</button><button>Где находится место работы?</button></div>');
  });
  assert.equal((await respond(options)).status, 'sent', 'Completed bot summaries must not block the human acknowledgement');
  assert.equal(await page.evaluate(() => window.sent), 1);
  assert.equal((await respond(options)).status, 'left_for_user');

  await page.goto('https://hh.ru/chat/123452');
  await page.locator('textarea').fill('My existing draft.');
  assert.equal((await respond(options)).status, 'left_for_user');
  assert.equal(await page.locator('textarea').inputValue(), 'My existing draft.');
  assert.equal(await page.evaluate(() => window.sent), 0);

  await page.goto('https://hh.ru/chat/123453');
  await page.locator('textarea').evaluate(input => input.addEventListener('input', () => { window.active=true; }));
  assert.equal((await respond(options)).status, 'unconfirmed');
  assert.equal(await page.evaluate(() => window.sent), 0, 'Returning to the window between fill and send cancels sending');
  await page.locator('textarea').fill('');
  await page.evaluate(() => { window.active=false; });
  assert.equal((await createAcknowledgementResponder({ directory })(options)).status, 'already_attempted');
  assert.equal(await page.evaluate(() => window.sent), 0);
  await page.goto('https://hh.ru/chat/123454');
  await page.evaluate(() => {
    const challenge = document.createElement('div'); challenge.dataset.qa = 'captcha-block';
    challenge.style.cssText = 'width:100px;height:100px'; document.body.append(challenge);
  });
  assert.equal((await respond(options)).status, 'left_for_user');
  assert.equal(await page.locator('textarea').inputValue(), '');
  assert.equal(await page.evaluate(() => window.sent), 0, 'A manual CAPTCHA blocks chat input and sending');
  console.log('Acknowledgement browser checks passed: already-read message answered once, existing drafts retained, user return cancels sending, restart cannot duplicate.');
} finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }); }
