/** Real chat input/send checks in an isolated browser with all requests intercepted. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { readChatIn } from '../../src/chat-answers.mjs';
import { sendChatAnswer } from '../../src/instant-chat.mjs';
import { createRejectionResponder, DEFAULT_REJECTION_REPLY } from '../../src/rejection-replies.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rejection-browser-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://hh.ru/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <div data-qa="participant-info-title">Employer</div>
    <div data-qa="chatik-header-sub-header"><a href="https://hh.ru/vacancy/777">DevOps Engineer</a></div>
    <div id="messages"><div data-qa="chatik-chat-message-91"><div data-qa="chat-bubble-wrapper">
      <div data-qa="chat-bubble-text">К сожалению, на данном этапе мы не готовы двигаться дальше. Желаю вам удачи в поиске подходящей позиции.</div></div></div></div>
    <textarea data-qa="text-input"></textarea><button data-qa="chat-send" onclick="
      window.sent++;
      const row=document.createElement('div'); row.dataset.qa='chatik-chat-message-92';
      const status=document.createElement('span'); status.dataset.qa='status-icon-delivered'; row.append(status);
      const text=document.createElement('div'); text.dataset.qa='chat-bubble-text'; text.textContent=document.querySelector('textarea').value; row.append(text);
      document.getElementById('messages').append(row); document.querySelector('textarea').value='';">Send</button>
    <script>window.sent=0; window.active=false;</script>` }));
  const respond = createRejectionResponder({ directory });
  const options = (id) => ({ chatId: id, readChat: () => readChatIn(page),
    readDraft: () => page.locator('textarea').inputValue(), maySend: () => page.evaluate(() => !window.active),
    send: (messageId, reply) => sendChatAnswer(page.mainFrame(), messageId, reply) });

  await page.goto('https://hh.ru/chat/123456');
  assert.equal((await respond(options('123456'))).status, 'sent');
  assert.equal(await page.evaluate(() => window.sent), 1);
  assert.equal((await readChatIn(page)).messages.at(-1).text, DEFAULT_REJECTION_REPLY);
  await respond(options('123456'));
  assert.equal(await page.evaluate(() => window.sent), 1);

  await page.goto('https://hh.ru/chat/123457');
  await page.locator('textarea').fill('My existing draft.');
  assert.equal((await respond(options('123457'))).status, 'left_for_user');
  assert.equal(await page.locator('textarea').inputValue(), 'My existing draft.');
  assert.equal(await page.evaluate(() => window.sent), 0);

  await page.goto('https://hh.ru/chat/123458');
  await page.locator('textarea').evaluate((input) => input.addEventListener('input', () => { window.active = true; }));
  assert.equal((await respond(options('123458'))).status, 'unconfirmed');
  assert.equal(await page.evaluate(() => window.sent), 0, 'Returning to the window between fill and Send must stop submission');
  console.log('Rejection browser checks passed: one confirmed request, no duplicate, existing draft preserved, user return cancels Send.');
} finally {
  await browser.close();
  await fs.rm(directory, { recursive: true, force: true });
}
