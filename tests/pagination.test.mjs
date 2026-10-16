/**
 * Tests for pagination functionality
 * Issue #120: Support automatic page changing when all items in vacancy list are processed
 */
import { describe, test, assert } from 'test-anywhere';
import { SELECTORS } from '../src/hh-selectors.mjs';

describe('Pagination Selectors', () => {
  test('Pager block selector should match data-qa attribute', () => {
    assert.equal(SELECTORS.pagerBlock, '[data-qa="pager-block"]');
    assert.equal(SELECTORS.pagerPage, 'a[data-qa="pager-page"]');
  });
});

describe('Pagination HTML Structure', () => {
  test('Should correctly identify current page from HTML markup', () => {
    // Mock DOM to simulate browser environment
    globalThis.document = {
      querySelector: (selector) => {
        if (selector === '[data-qa="pager-block"]') {
          return {
            querySelectorAll: (innerSelector) => {
              if (innerSelector === 'a[data-qa="pager-page"]') {
                return [
                  {
                    getAttribute: (attr) => attr === 'aria-current' ? 'true' : null,
                    href: '/search/vacancy?page=0',
                  },
                  {
                    getAttribute: (attr) => attr === 'aria-current' ? 'false' : null,
                    href: '/search/vacancy?page=1',
                  },
                  {
                    getAttribute: (attr) => attr === 'aria-current' ? 'false' : null,
                    href: '/search/vacancy?page=2',
                  },
                ];
              }
              return [];
            },
          };
        }
        return null;
      },
    };

    // Simulate the pagination detection logic
    const pagerBlock = globalThis.document.querySelector('[data-qa="pager-block"]');
    const pageLinks = pagerBlock.querySelectorAll('a[data-qa="pager-page"]');
    const currentPageIndex = Array.from(pageLinks).findIndex(
      link => link.getAttribute('aria-current') === 'true',
    );

    assert.equal(currentPageIndex, 0, 'Should find current page at index 0');
    assert.equal(pageLinks.length, 3, 'Should find 3 page links');
    assert.equal(pageLinks[1].href, '/search/vacancy?page=1', 'Next page should be page 1');

    // Cleanup
    delete globalThis.document;
  });

  test('Should detect when on last page', () => {
    // Mock DOM for last page scenario
    globalThis.document = {
      querySelector: (selector) => {
        if (selector === '[data-qa="pager-block"]') {
          return {
            querySelectorAll: (innerSelector) => {
              if (innerSelector === 'a[data-qa="pager-page"]') {
                return [
                  {
                    getAttribute: (attr) => attr === 'aria-current' ? 'false' : null,
                    href: '/search/vacancy?page=0',
                  },
                  {
                    getAttribute: (attr) => attr === 'aria-current' ? 'false' : null,
                    href: '/search/vacancy?page=1',
                  },
                  {
                    getAttribute: (attr) => attr === 'aria-current' ? 'true' : null,
                    href: '/search/vacancy?page=2',
                  },
                ];
              }
              return [];
            },
          };
        }
        return null;
      },
    };

    const pagerBlock = globalThis.document.querySelector('[data-qa="pager-block"]');
    const pageLinks = pagerBlock.querySelectorAll('a[data-qa="pager-page"]');
    const currentPageIndex = Array.from(pageLinks).findIndex(
      link => link.getAttribute('aria-current') === 'true',
    );

    assert.equal(currentPageIndex, 2, 'Should find current page at index 2');
    assert.equal(currentPageIndex >= pageLinks.length - 1, true, 'Should detect last page');

    // Cleanup
    delete globalThis.document;
  });
});

describe('Pagination Logic', () => {
  test('Should determine if next page exists', () => {
    const totalPages = 5;
    const currentPage = 3;

    const hasNextPage = currentPage < totalPages;
    assert.equal(hasNextPage, true, 'Should have next page when not on last page');
  });

  test('Should determine if on last page', () => {
    const totalPages = 5;
    const currentPage = 5;

    const hasNextPage = currentPage < totalPages;
    assert.equal(hasNextPage, false, 'Should not have next page when on last page');
  });

  test('Should calculate next page number correctly', () => {
    const currentPageIndex = 0; // 0-based index
    const nextPageNumber = currentPageIndex + 2; // Convert to 1-based and add 1

    assert.equal(nextPageNumber, 2, 'Next page should be 2 when current index is 0');
  });
});

describe('A list page that never loads', () => {
  test('a blank page is reloaded, a drawn one is waited on', async () => {
    const { waitForButtonsAfterNavigation } = await import('../src/vacancies.mjs');
    const visits = [];
    let blank = true;
    const commander = {
      getUrl: () => 'https://hh.ru/search/vacancy?resume=1',
      shouldAbort: () => false,
      evaluate: async ({ fn }) => (fn.name === 'readPageBlank' ? blank : null),
      wait: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {};
      },
      goto: async ({ url }) => visits.push(url),
      findByText: async () => 'a',
      count: async () => (blank ? 0 : 1),
    };
    const result = await waitForButtonsAfterNavigation({ commander, pageClosedByUser: () => false, blankReload: { first: 20, most: 100 } });
    assert.equal(result.status, 'navigation_detected');
    assert.deepEqual(visits, ['https://hh.ru/search/vacancy?resume=1']);
    blank = false;
    assert.equal((await waitForButtonsAfterNavigation({ commander, pageClosedByUser: () => false, blankReload: { first: 20, most: 100 } })).status, 'buttons_found');
    assert.equal(visits.length, 1);
  });
});
