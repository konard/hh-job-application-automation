/** Actual recruiter-bot answers, separated from HH's generic conversation suggestions. */
export function readChatChoiceControls() {
  const rows = [...document.querySelectorAll('[data-qa^="chatik-chat-message-"]')]
    .filter(e => /^chatik-chat-message-\d+$/.test(e.getAttribute('data-qa')));
  const last = rows.at(-1);
  const messageId = last?.getAttribute('data-qa').replace('chatik-chat-message-', '') ?? '';
  const question = last?.querySelector('[data-qa="chat-bubble-text"]')?.innerText ?? '';
  const visible = e => e.getClientRects().length > 0 && window.getComputedStyle(e).visibility !== 'hidden';
  const labels = group => [...group.querySelectorAll('button,[role="button"],[role="option"]')]
    .filter(e => visible(e))
    .map(e => ({ element: e, label: e.innerText.trim() })).filter(e => e.label);
  const binary = text => /^(?:да|нет|yes|no)(?=$|[\s.!:,])/iu.test(text);
  const opposite = choices => choices.length === 2 && choices.every(e => binary(e.label)) &&
    /^(?:да|yes)(?=$|[\s.!:,])/iu.test(choices[0].label) !== /^(?:да|yes)(?=$|[\s.!:,])/iu.test(choices[1].label);
  const explicit = /выбер(?:и|ите)\s+(?:один|одну|вариант|из)|\b(?:select|choose|pick)\s+(?:one|an?\s+option|from)\b/iu.test(question);
  const groups = [last, ...document.querySelectorAll('[class*="buttons-wrapper"],[class*="reply-options"],[data-qa*="answer-options"],[data-qa*="question-options"]')].filter(e => e && visible(e));
  // Prefer buttons attached to the latest message. Older questions and the composer toolbar
  // must never steal the next answer. A Yes/No pair is strict even without "choose" wording.
  let selected;
  for (const group of groups) {
    const owner = group.closest('[data-qa^="chatik-chat-message-"]');
    if (owner && owner !== last) continue;
    const offered = labels(group);
    if (!offered.length) continue;
    const choices = offered.filter(e => !e.element.disabled && e.element.getAttribute('aria-disabled') !== 'true');
    const scoped = owner === last || /reply-options|answer-options|question-options/.test(`${group.className} ${group.getAttribute('data-qa')}`);
    const generic = /^(?:здравствуйте|какая схема оплаты|где находится место работы|можно без опыта|какой график работы|могу работать в гибком графике|у меня есть профильный опыт|hello)[.!?]*$/iu;
    if (!scoped && offered.every(e => generic.test(e.label))) continue;
    if (scoped || opposite(offered) || explicit) {
      if (!selected || scoped) selected = { choices, scoped };
    }
  }
  if (!selected && last) {
    // Some HH bot versions render their pair in a separate component, without the generic
    // suggestions wrapper. Recognize only an unambiguous visible Yes/No pair in this pane.
    const pair = labels(document).filter(({ element, label }) => {
      const owner = element.closest('[data-qa^="chatik-chat-message-"]');
      const dialog = element.closest('[role="dialog"]');
      return binary(label) && (!owner || owner === last) && (!dialog || dialog.contains(last));
    });
    if (opposite(pair)) selected = { choices: pair.filter(e => !e.element.disabled && e.element.getAttribute('aria-disabled') !== 'true') };
  }
  const options = selected ? [...new Map(selected.choices.map(e => [e.label, e])).values()] : [];
  options.forEach(({ element }, index) => { element.dataset.hhChatOption = `${messageId}:${index}`; });
  return { options: options.map(e => e.label), strictOptions: Boolean(selected) || explicit ||
    /(?:ответьте|ответ|answer|reply).{0,30}(?:да\s*(?:или|\/)\s*нет|yes\s*(?:or|\/)\s*no)/iu.test(question),
  optionMessageId: messageId };
}

export async function readQuickReplies(target) {
  return (await target.evaluate(readChatChoiceControls)).options;
}

/** Only an unchanged draft written by this automation may be removed for delayed choices. */
export async function clearAutomaticChatDraft(frame, messageId) {
  const input = frame.locator('textarea[data-qa="text-input"]').first();
  if (!await input.count()) return true;
  const state = await input.evaluate(e => ({ value: e.value, owned: e.dataset.hhAutomaticChatDraft })).catch(() => null);
  if (!state) return false;
  if (!state.value.trim()) return true;
  let owned;
  try { owned = JSON.parse(state.owned); } catch { return false; }
  if (owned.messageId !== String(messageId) || owned.value !== state.value) return false;
  await input.fill('');
  return true;
}

export async function prefillSavedChatAnswer(frame, messageId, answer) {
  const input = frame.locator('textarea[data-qa="text-input"]').first();
  if ((await input.inputValue()).trim()) return false;
  await input.fill(answer);
  await input.evaluate((e, value) => { if (e.value === value.value) e.dataset.hhAutomaticChatDraft = JSON.stringify(value); },
    { messageId: String(messageId), value: answer });
  return true;
}
