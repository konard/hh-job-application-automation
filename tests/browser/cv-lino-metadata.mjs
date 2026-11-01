/** Public export layout to Links Notation and back; no HH requests or live browser state. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readResumeExportDom, attachIndustryIds } from '../../src/resume-export-dom.mjs';
import { resumeToCv, formatCvLino, parseCvLino, planCvImport } from '../../src/cv.mjs';

const tree = [{ id: '7', name: 'IT', industries: [{ id: '7.540', name: 'Software Development' },
  { id: '7.541', name: 'Internet Company (Search, Entertainment)' }] }];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(`<h1 class="resume__title">Example Person</h1><h2 class="resume__position">Developer</h2>
    <div>Resume updated 1 November 2026</div><div class="resume-experience">
      <span class="resume-experience__company">Game Server</span><p class="info">Moscow, web.archive.org/web/20190626105802/example.test</p>
      <p>IT</p><ul><li>Internet Company (Search, Entertainment)</li><li>Software Development</li></ul>
      <p class="bloko-form-hint">September 2007 — April 2008 8 months</p><p class="resume-experience__position">Lead Developer</p>
      <p>Developed online games.</p><ul><li>A description list is not an industry.</li></ul></div>
      <div class="resume-experience"><span class="resume-experience__company">Other</span><p class="info">Remote</p>
      <p class="bloko-form-hint">May 2026 — present</p><p class="resume-experience__position">Developer</p><p>Current work.</p></div>`);
  const raw = await page.evaluate(readResumeExportDom);
  assert.equal(raw.jobs[0].area, 'Moscow');
  assert.equal(raw.jobs[0].website, 'web.archive.org/web/20190626105802/example.test');
  assert.equal(raw.jobs[1].area, 'Remote');
  assert.equal(raw.jobs[1].website, '');
  const cv = resumeToCv(attachIndustryIds(raw, tree));
  assert.deepEqual(cv.jobs[0].industries.map(i => i.id), ['7.541', '7.540']);
  assert.equal(cv.jobs[0].description, 'Developed online games.');
  const parsed = parseCvLino(formatCvLino(cv));
  assert.deepEqual(parsed, cv);
  assert.deepEqual(planCvImport(cv, parsed), { changes: [], notes: [] });
  parsed.jobs[0].industries = [{ id: '7.540', name: 'Software Development', parent: 'IT' }];
  assert.deepEqual(planCvImport(cv, parsed).changes[0].fields.industries, parsed.jobs[0].industries);
  assert.throws(() => attachIndustryIds(raw, []), /No unique industry/);
  console.log('CV metadata passed: public HTML to Links Notation and back, stable industry IDs, archived websites, city, legacy-safe import and industry edit planning.');
} finally { await browser.close(); }
