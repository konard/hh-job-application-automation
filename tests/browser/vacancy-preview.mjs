/** Real scrolling and navigation on isolated fixture pages; no user session or HH.ru requests. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeBrowserCommander } from 'browser-commander';
import { clearProcessedVacancies, findAndProcessVacancyButton, getProcessedVacancyCount,
  markVacancyAsProcessed, previewNextVacancy } from '../../src/vacancies.mjs';
import { submissionRetries } from '../../src/submission-retries.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  let cards = ['101', '102', '103', '104'];
  let applyClicks = 0;
  await page.exposeFunction('clickedApply', () => { applyClicks++; });
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: `
    <style>body { margin:0 } article { height:500px; padding:30px; border:1px solid gray }</style>
    <header style="height:1000px">Matching vacancies</header>
    ${cards.map((id) => `<article id="${id}" class="vacancy-card--fixture">
      <a data-qa="serp-item__title" href="https://hh.ru/vacancy/${id}">Developer ${id}</a>
      <span data-qa="vacancy-serp__vacancy-employer">Acme</span>
      <a data-qa="vacancy-serp__vacancy_response" href="#" onclick="clickedApply(); return false">Apply</a>
    </article>`).join('')}
    <footer style="height:1000px"></footer>` }));
  const commander = makeBrowserCommander({ page, enableNetworkTracking: false, enableNavigationManager: false });
  const search = 'https://hh.ru/search/vacancy?resume=fixture';
  const mount = () => commander.goto({ url: search, waitForStableUrlBefore: false, waitForNetworkIdle: false });
  const inView = (id) => page.locator(`[id="${id}"]`).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  const goto = commander.goto.bind(commander);
  commander.goto = async (options) => {
    if (options.url.includes('/applicant/vacancy_response')) {
      assert.equal(await inView(new URL(options.url).searchParams.get('vacancyId')), true,
        'Show the intended card before navigating to its application, including after collection returns');
    }
    return goto(options);
  };
  const process = (targetVacancyId = null, extra = {}) => findAndProcessVacancyButton({
    commander, targetVacancyId, selectApplicationResume: async () => {}, ...extra,
  });
  clearProcessedVacancies();
  markVacancyAsProcessed('101');
  submissionRetries.defer('102');
  await mount();

  const preview = await previewNextVacancy({ commander });
  assert.equal(preview.vacancyId, '103', 'Skip processed cards and five-hour RAM deferrals');
  assert.equal(await inView('103'), true, 'Show the planned card before any click or navigation');
  assert.equal(applyClicks, 0);
  assert.equal(getProcessedVacancyCount(), 1, 'Previewing must not consume a vacancy');
  assert.equal(commander.getUrl(), search);

  await page.evaluate(() => window.scrollTo(0, 0));
  await previewNextVacancy({ commander });
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'Do not keep dragging the user back during the pause');

  // Cards can reorder during pacing. Resolve the previewed ID again, not its old index.
  cards = ['104', '102', '101', '103'];
  await mount();
  const steps = [];
  const result = await process(preview.vacancyId, { vacancyInsights: { enabled: true, visit: async ({ vacancyId, returnUrl }) => {
    assert.equal(vacancyId, '103');
    assert.equal(await inView('103'), true, 'Preview before leaving the search to read the full description');
    steps.push('description');
    await commander.goto({ url: `https://hh.ru/vacancy/${vacancyId}`, waitForStableUrlBefore: false });
    cards = ['103', '104', '101', '102'];
    await commander.goto({ url: returnUrl, waitForStableUrlBefore: false });
    return { description: 'Develop backend software.' };
  } } });
  assert.deepEqual(steps, ['description']);
  assert.equal(result.vacancyId, '103');
  assert.equal(result.status, 'vacancy_response_detected');
  assert.equal(new URL(commander.getUrl()).searchParams.get('vacancyId'), '103');
  assert.equal(applyClicks, 0, 'Never trigger the one-click Apply shortcut while previewing');

  // A deferred or already processed preview is no longer eligible.
  await mount();
  assert.equal((await process('103')).vacancyId, '104');
  clearProcessedVacancies();
  await mount();
  assert.equal((await process('102')).vacancyId, '103');

  // A disappeared card falls back safely. A non-search page has no preview effects.
  clearProcessedVacancies();
  cards = ['104'];
  await mount();
  assert.equal((await process('103')).vacancyId, '104');
  assert.equal(await previewNextVacancy({ commander }), null);
  await mount();
  assert.equal(await previewNextVacancy({ commander }), null, 'No eligible cards left');

  clearProcessedVacancies();
  await mount();
  await page.evaluate(() => {
    const dialog = document.createElement('div');
    dialog.role = 'dialog'; dialog.innerText = 'User is editing'; document.body.append(dialog);
  });
  await previewNextVacancy({ commander });
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'Do not scroll underneath an open form');
  assert.equal(applyClicks, 0);
  console.log('Vacancy previews passed: visible next card before navigation, RAM/processed exclusions, no clicks, stationary repeat checks, reordered and removed cards, overlay and form protection.');
} finally {
  submissionRetries.forget('102');
  clearProcessedVacancies();
  await browser.close();
}
