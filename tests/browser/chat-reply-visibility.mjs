/** Sent replies stay visible in normal/reversed panes, including after background restoration. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sendChatAnswer } from '../../src/instant-chat.mjs';
import { captureChatView, restoreChatView } from '../../src/background-rejections.mjs';
import { revealChatMessage } from '../../src/chat-scroll.mjs';

process.env.NODE_ENV='test'; process.env.NOTIFY='0';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage();
  await page.route('https://hh.ru/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`
    <div id="viewport" style="height:180px;width:600px;overflow:auto;display:flex;flex-direction:${new URL(route.request().url()).searchParams.get('reversed')==='1'?'column-reverse':'column'};overflow-anchor:none">
      <div id="messages" style="flex:0 0 auto"><div style="height:600px">Older messages</div>
        <div data-qa="chatik-chat-message-91" style="height:80px"><div data-qa="chat-bubble-text">Your experience?</div></div>
      </div>
    </div>
    <textarea data-qa="text-input"></textarea><button data-qa="chat-send" onclick="window.sent++;const text=document.querySelector('textarea').value;document.querySelector('textarea').value='';if(window.delay)setTimeout(()=>window.appendReply(text),700);else window.appendReply(window.wrong?'Other message.':text)">Send</button>
    <script>window.sent=0;window.delay=false;window.wrong=false;
    window.appendReply=text=>{const row=document.createElement('div');row.dataset.qa='chatik-chat-message-92';row.style.height='60px';row.innerHTML='<span data-qa="status-icon-delivered"></span><div data-qa="chat-bubble-text"></div>';row.querySelector('div').textContent=text;document.getElementById('messages').append(row);};</script>`}));
  const hidden = () => page.evaluate(()=>{
    const row=document.querySelector('[data-qa="chatik-chat-message-92"]')?.getBoundingClientRect();
    const box=document.getElementById('viewport').getBoundingClientRect();
    return !row || row.top<box.top-1 || row.bottom>box.bottom+1;
  });
  for(const reversed of [false,true]) {
    const url=`https://hh.ru/chat/991030001?reversed=${reversed?1:0}`;
    await page.goto(url);
    await page.locator('#viewport').evaluate((e,reversed)=>{e.scrollTop=reversed?-200:0;},reversed);
    const before=await captureChatView(page);
    assert.equal(await sendChatAnswer(page.mainFrame(),'91',{answer:'My confirmed answer.'}),true);
    assert.equal(await hidden(),false,'The outgoing reply must be inside the chat viewport after Send');
    await restoreChatView(page,before);
    assert.equal(await hidden(),false,'Restoring the background view must not hide a newly sent reply');
    assert.equal(await page.evaluate(()=>window.sent),1);
    await page.locator('#viewport').evaluate((e,reversed)=>{e.scrollTop=reversed?-200:0;},reversed);
    const readingAt=await page.locator('#viewport').evaluate(e=>e.scrollTop);
    assert.equal(await restoreChatView(page,before,{canAdjust:async()=>false}),false);
    assert.equal(await page.locator('#viewport').evaluate(e=>e.scrollTop),readingAt,'Returning to read the same chat must retain the user viewport');

    // An unrelated draft keeps its original reading position even if another client replied.
    await page.goto(url);
    await page.locator('#viewport').evaluate((e,reversed)=>{e.scrollTop=reversed?-200:0;},reversed);
    await page.locator('textarea').fill('My unfinished draft.');
    const draft=await captureChatView(page);
    await page.evaluate(()=>window.appendReply('A reply from another client.'));
    await restoreChatView(page,draft);
    assert.equal(await page.locator('textarea').inputValue(),'My unfinished draft.');
    assert.ok(Math.abs(await page.locator('#viewport').evaluate(e=>e.scrollTop)-draft.messageTop)<1);
  }
  await page.goto('https://hh.ru/chat/991030002');
  await page.evaluate(()=>{window.delay=true;window.__chatUserActivity={at:100};setTimeout(()=>{window.__chatUserActivity.at=101;document.getElementById('viewport').scrollTop=0;},650);});
  assert.equal(await sendChatAnswer(page.mainFrame(),'91',{answer:'A delayed confirmed answer.'}),true);
  assert.equal(await page.locator('#viewport').evaluate(e=>e.scrollTop),0,'User scrolling during delivery must win');
  assert.equal(await page.evaluate(revealChatMessage,{expectedUrl:'https://hh.ru/chat/other',messageId:'92'}),false);

  // Another outgoing message is not evidence that this exact automatic answer was sent.
  await page.goto('https://hh.ru/chat/991030003');
  await page.evaluate(()=>{window.wrong=true;});
  assert.equal(await sendChatAnswer(page.mainFrame(),'91',{answer:'Expected exact reply.'}),false);
  assert.equal(await page.evaluate(()=>window.sent),1);
  console.log('Reply visibility checks passed: normal/reversed scrolling, background restoration, draft/user-scroll preservation, exact outgoing confirmation, no duplicate sends.');
} finally {await browser.close();}
