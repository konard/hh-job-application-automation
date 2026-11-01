/** Virtualized selector: only search results mount; all industry IDs remain selectable. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { selectHhIndustryReferences } from '../../src/hh-industries.mjs';

const tree = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: `Group ${i + 1}`,
  industries: [{ id: `${i + 1}.${500 + i}`, name: i === 29 ? 'Car Hire' : 'Shared name' }] }));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<html lang="en"><body><div data-qa="trigger-root">Company\'s field of activity<span data-qa="trigger-values-wrapper"></span></div><button id="final-save">Save workplace</button></body></html>');
  await page.evaluate(tree => {
    window.finalSaves = 0;
    document.querySelector('#final-save').onclick = () => { window.finalSaves++; };
    const selected = new Set(['1.500']);
    const trigger = document.querySelector('[data-qa="trigger-root"]');
    trigger.onclick = () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<input data-qa="tree-selector-search-input"><button id="reset">Reset</button><section></section><button id="apply">Save</button>';
      document.body.append(dialog);
      const render = () => {
        const search = dialog.querySelector('input').value;
        const leaves = tree.flatMap(group => group.industries).filter(item => item.name.includes(search));
        dialog.querySelector('section').innerHTML = leaves.map(item => {
          const id = item.id.split('.').at(-1);
          return `<label data-qa="tree-selector-item-text-${id}"><input type="checkbox" data-qa="tree-selector-input-${id}" value="${item.id}" ${selected.has(item.id) ? 'checked' : ''}>${item.name}</label>`;
        }).join('');
        for (const checkbox of dialog.querySelectorAll('input[type=checkbox]')) checkbox.onchange = () => {
          if (checkbox.checked) selected.add(checkbox.value); else selected.delete(checkbox.value);
        };
      };
      dialog.querySelector('input').oninput = render;
      dialog.querySelector('#reset').onclick = () => { selected.clear(); render(); };
      dialog.querySelector('#apply').onclick = () => {
        trigger.querySelector('span').textContent = tree.flatMap(g => g.industries).filter(i => selected.has(i.id)).map(i => i.name).join(', ');
        window.selected = [...selected]; dialog.remove();
      };
      render();
    };
  }, tree);
  await selectHhIndustryReferences(page, [{ id: '30.529' }, { path: ['Group 20', 'Shared name'] }], { tree });
  assert.deepEqual(await page.evaluate(() => window.selected), ['30.529', '20.519']);
  assert.equal(await page.evaluate(() => window.finalSaves), 0);
  await assert.rejects(selectHhIndustryReferences(page, ['Shared name'], { tree }), /unique/);
  console.log('Industry selector: complete tree, duplicate names, distant leaves and owner-only final Save verified.');
} finally { await browser.close(); }
