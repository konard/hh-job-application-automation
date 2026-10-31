/** Reveal a chat message in both ordinary and HH's reversed message columns. Runs in the page. */
export function revealChatMessage({ messageId = null, expectedUrl = null, userAt } = {}) {
  if (expectedUrl && window.location.href !== expectedUrl) return false;
  if (userAt !== undefined && (window.__chatUserActivity?.at ?? null) !== userAt) return false;
  const messages = [...document.querySelectorAll('[data-qa^="chatik-chat-message-"]')]
    .filter(e => /^chatik-chat-message-\d+$/.test(e.getAttribute('data-qa')));
  const target = messageId ? messages.find(e => e.getAttribute('data-qa') === `chatik-chat-message-${messageId}`) : messages.at(-1);
  if (!target) return false;
  let box = target.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 10 && /auto|scroll/.test(window.getComputedStyle(box).overflowY))) box = box.parentElement;
  if (box) box.scrollTop = window.getComputedStyle(box).flexDirection === 'column-reverse' ? 0 : box.scrollHeight;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  const rect = target.getBoundingClientRect();
  const viewport = box?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  return rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1;
}
