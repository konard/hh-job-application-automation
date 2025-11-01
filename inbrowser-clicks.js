/**
 * In-browser DevTools version.
 * Paste into console while viewing hh.ru search results.
 */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (selector, { timeout = 8000 } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(200);
    }
    throw new Error(`Timeout for ${selector}`);
  };
  const waitForText = async (text, tags = ['a','button','span'], timeout = 8000) => {
    const t0 = Date.now();
    const sel = tags.join(',');
    while (Date.now() - t0 < timeout) {
      const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim() === text);
      if (el) return el;
      await sleep(200);
    }
    throw new Error(`Timeout for "${text}"`);
  };
  const link = [...document.querySelectorAll('a')].find(e => e.textContent.trim() === 'Откликнуться');
  if (!link) throw new Error('No "Откликнуться" link found.');
  link.click();
  const form = await waitFor('form#RESPONSE_MODAL_FORM_ID[name="vacancy_response"]');
  const addCover = await waitForText('Добавить сопроводительное');
  addCover.click();
  console.log('✅ Clicked both buttons (Откликнуться + Добавить сопроводительное)');
})();
