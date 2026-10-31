/** Strict options and delayed controls: isolated HTML, no HH requests or user browser profile. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readChatIn } from '../../src/chat-answers.mjs';
import { readChatChoiceControls, clearAutomaticChatDraft, prefillSavedChatAnswer } from '../../src/chat-choice-controls.mjs';
import { sendChatAnswer, readQuickReplies } from '../../src/instant-chat.mjs';
import { chooseChatOption, requiresChatOption } from '../../src/chat-options.mjs';
import { watchChats } from '../../src/chat-recording.mjs';

process.env.NODE_ENV = 'test'; process.env.NOTIFY = '0';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://hh.ru/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <div id="messages"><div data-qa="chatik-chat-message-91"><div data-qa="chat-bubble-wrapper">
    <div data-qa="chat-bubble-text">Есть ли у Вас опыт работы с микросервисами?</div><div id="answers"></div></div></div></div>
    <div class="buttons-wrapper--suggestions"><button>Здравствуйте!</button><button>Какая схема оплаты?</button><button>Где находится место работы?</button></div>
    <textarea data-qa="text-input"></textarea><button data-qa="chat-send" onclick="window.typed++; window.appendReply(document.querySelector('textarea').value)">Send</button>
    <script>
    window.clicked=0;window.typed=0;window.atClick=null;
    window.appendReply=text=>{const row=document.createElement('div');row.dataset.qa='chatik-chat-message-92';
    row.innerHTML='<span data-qa="status-icon-delivered"></span><div data-qa="chat-bubble-text"></div>';
    row.querySelector('div').textContent=text;document.getElementById('messages').append(row);document.querySelector('textarea').value='';};
    window.options=()=>{document.getElementById('answers').innerHTML='<button>ДА</button><button>НЕТ</button>';
    for(const b of document.querySelectorAll('#answers button')) b.onclick=()=>{window.clicked++;window.atClick=document.querySelector('textarea').value;window.appendReply(b.textContent);};};
    </script>` }));
  const reset = () => page.goto('https://hh.ru/chat/991020001');
  const frame = page.mainFrame();

  await reset(); await page.evaluate(() => window.options());
  assert.deepEqual(await readQuickReplies(frame), ['ДА', 'НЕТ'], 'Generic suggestions below the actual options must not shadow them');
  const chat = await readChatIn(frame);
  assert.equal(chat.strictOptions, true);
  assert.equal(requiresChatOption(chat.messages[0].text, chat.options), true);
  const choice = chooseChatOption({ question: chat.messages[0].text, options: chat.options, reply: { answer: 'Да.', perfect: true } });
  assert.equal(choice.option, 'ДА');
  assert.equal(await sendChatAnswer(frame, '91', { answer: choice.option, option: choice.option }), true);
  assert.equal(await page.evaluate(() => window.clicked), 1);
  assert.equal(await page.evaluate(() => window.typed), 0);
  assert.equal(await page.evaluate(() => window.atClick), '', 'No text may be prefilled for strict options');
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'ДА', option: 'ДА' }), false, 'An already answered question cannot be clicked again');

  await reset(); await page.evaluate(() => window.options());
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'Да, у меня есть такой опыт.' }), false);
  assert.equal(await page.locator('textarea').inputValue(), '');
  assert.equal(await page.evaluate(() => window.typed), 0);

  // Buttons outside both the bubble and the generic wrapper are still strict.
  await page.locator('#answers').evaluate(e => { document.body.append(e); e.className = 'new-bot-component'; });
  assert.deepEqual(await readQuickReplies(frame), ['ДА', 'НЕТ']);

  await reset();
  assert.deepEqual(await readQuickReplies(frame), [], 'Generic canned conversation starters are not bot answers');
  assert.equal((await readChatIn(frame)).strictOptions, false);
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'My open-ended answer.' }), true);
  assert.equal(await page.evaluate(() => window.typed), 1);

  await reset(); await page.locator('textarea').fill('My manual open-ended draft.');
  assert.equal(await sendChatAnswer(frame,'91',{answer:'An automatic replacement.'}),false);
  assert.equal(await page.locator('textarea').inputValue(),'My manual open-ended draft.');
  await reset();
  await page.evaluate(()=>setTimeout(()=>{document.querySelector('textarea').value='User editing during send.';},100));
  assert.equal(await sendChatAnswer(frame,'91',{answer:'A saved answer.'}),false);
  assert.equal(await page.evaluate(()=>window.typed),0);

  // Delayed options appearing during the text-send settle cancel the text, then allow a button.
  await reset();
  await page.evaluate(() => setTimeout(window.options, 100));
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'Old textual suggestion.' }), false);
  assert.equal(await page.evaluate(() => window.typed), 0);
  assert.equal(await page.locator('textarea').inputValue(), '');
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'ДА', option: 'ДА' }), true);
  assert.equal(await page.evaluate(() => window.atClick), '');

  await reset();
  await prefillSavedChatAnswer(frame, '91', 'Automatic suggestion.');
  await page.evaluate(() => window.options());
  assert.equal(await clearAutomaticChatDraft(frame, '91'), true);
  assert.equal(await page.locator('textarea').inputValue(), '');
  await reset();
  await prefillSavedChatAnswer(frame, '91', 'Automatic suggestion.');
  await page.locator('textarea').fill('User edited this draft.');
  await page.evaluate(() => window.options());
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'ДА', option: 'ДА' }), false);
  assert.equal(await page.locator('textarea').inputValue(), 'User edited this draft.');
  assert.equal(await page.evaluate(() => window.clicked), 0);

  await reset(); await page.evaluate(() => { window.options(); document.querySelectorAll('#answers button').forEach(e => { e.disabled = true; }); });
  const disabled = await page.evaluate(readChatChoiceControls);
  assert.equal(disabled.strictOptions, true); assert.deepEqual(disabled.options, []);
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'Text must not replace disabled buttons.' }), false);

  await reset(); await page.evaluate(() => {
    window.options(); document.getElementById('answers').hidden=true;
    const row=document.createElement('div');row.dataset.qa='chatik-chat-message-93';row.innerHTML='<div data-qa="chat-bubble-text">Расскажите о проектах.</div>';
    document.getElementById('messages').append(row);
  });
  assert.deepEqual(await readQuickReplies(frame), []);
  assert.equal((await page.evaluate(readChatChoiceControls)).strictOptions, false);
  assert.equal(await sendChatAnswer(frame, '91', { answer: 'ДА', option: 'ДА' }), false);
  await page.locator('[data-qa="chatik-chat-message-93"] [data-qa="chat-bubble-text"]').evaluate(e => { e.textContent='Выберите один вариант'; });
  assert.equal((await page.evaluate(readChatChoiceControls)).strictOptions, true);
  assert.deepEqual(await readQuickReplies(frame), [], 'Delayed real options must not be replaced by generic suggestions');

  // The live recorder must wake when existing hidden/disabled buttons become actionable.
  await reset();
  const observations = [];
  const recorder = await watchChats(page, { onChat: chat => { observations.push(chat); } });
  const observed = async predicate => {
    for (let start=Date.now(); !predicate(observations.at(-1)); ) {
      if (Date.now()-start>3000) throw new Error('Live option change was not observed');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
  };
  await page.evaluate(() => { window.options(); document.getElementById('answers').hidden = true; });
  await observed(chat => chat && !chat.strictOptions);
  await page.locator('#answers').evaluate(e => { e.hidden=false; });
  await observed(chat => chat?.options.length===2);
  await page.locator('#answers button').evaluateAll(buttons => buttons.forEach(e => { e.disabled=true; }));
  await observed(chat => chat?.strictOptions && chat.options.length===0);
  await page.locator('#answers button').evaluateAll(buttons => buttons.forEach(e => { e.disabled=false; }));
  await observed(chat => chat?.options.length===2);
  await recorder.flush();

  // The application chat is a cross-origin chatik frame; it uses the identical reader/sender.
  await reset();
  const panelHtml = await page.content();
  await page.route('https://chatik.hh.ru/**', route => route.fulfill({contentType:'text/html; charset=utf-8',body:panelHtml}));
  const navigated = page.waitForEvent('framenavigated', { predicate:f=>f.url().startsWith('https://chatik.hh.ru/') });
  await page.evaluate(()=>{const panel=document.createElement('iframe');panel.src='https://chatik.hh.ru/chat/991020002';panel.style='width:800px;height:500px';document.body.append(panel);});
  const panel=await navigated;
  await panel.waitForSelector('[data-qa="chatik-chat-message-91"]');
  await panel.evaluate(()=>window.options());
  assert.deepEqual(await readQuickReplies(panel),['ДА','НЕТ']);
  assert.equal(await sendChatAnswer(panel,'91',{answer:'ДА',option:'ДА'}),true);
  assert.equal(await panel.evaluate(()=>window.atClick),'');
  assert.equal(await panel.evaluate(()=>window.typed),0);

  console.log('Strict chat browser checks passed: actual buttons preferred; no text for choices; delayed/disabled controls; stale questions excluded; auto drafts cleaned and user edits retained.');
} finally { await browser.close(); }
