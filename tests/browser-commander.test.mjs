/**
 * Unit/mock tests for browser-commander logic
 * These tests verify the core browser-commander functionality using mocks
 *
 * Issue #144: Verify internal browser-commander features before switching to external package
 */
import { describe, test, assert } from 'test-anywhere';
import {
  makeBrowserCommander,
  detectEngine,
  createLogger,
  isVerboseEnabled,
  TIMING,
  isNavigationError,
  isTimeoutError,
  makeUrlCondition,
  allConditions,
  anyCondition,
  notCondition,
} from 'browser-commander';

// ==================== MOCK HELPERS ====================

/**
 * Create a mock Playwright page object
 * Playwright has: locator(), context()
 */
function createMockPlaywrightPage() {
  return {
    evaluate: async (fn) => {
      if (typeof fn === 'function') {
        return fn();
      }
      return null;
    },
    waitForSelector: async () => ({ click: async () => {} }),
    $: async () => null,
    $$: async () => [],
    $eval: async () => null,
    $$eval: async () => [],
    url: () => 'https://example.com/test',
    on: () => {},
    off: () => {},
    locator: (_selector) => ({
      click: async () => {},
      fill: async () => {},
      textContent: async () => 'mock text',
      inputValue: async () => 'mock value',
      getAttribute: async () => 'mock-attr',
      isVisible: async () => true,
      isEnabled: async () => true,
      count: async () => 1,
      first: () => ({ click: async () => {} }),
    }),
    keyboard: {
      press: async () => {},
    },
    mainFrame: () => ({
      addScriptTag: async () => {},
      evaluate: async () => {},
    }),
    // Playwright-specific: context() method
    context: () => ({
      newPage: async () => ({}),
    }),
  };
}

/**
 * Create a mock Puppeteer page object
 * Puppeteer has: $eval(), $$eval() but NO context()
 */
function createMockPuppeteerPage() {
  return {
    evaluate: async (fn) => {
      if (typeof fn === 'function') {
        return fn();
      }
      return null;
    },
    waitForSelector: async () => ({ click: async () => {} }),
    $: async (_selector) => ({
      click: async () => {},
      type: async () => {},
      evaluate: async (fn) => fn({ innerText: 'mock text', value: 'mock value' }),
    }),
    $$: async () => [],
    // Puppeteer-specific: $eval and $$eval methods
    $eval: async () => null,
    $$eval: async () => [],
    url: () => 'https://example.com/test',
    on: () => {},
    off: () => {},
    keyboard: {
      press: async () => {},
    },
    mainFrame: () => ({
      addScriptTag: async () => {},
      evaluate: async () => {},
    }),
    // Puppeteer-specific: NO context() method
    target: () => ({
      createCDPSession: async () => ({}),
    }),
  };
}

/**
 * Create URL context object for condition testing
 * @param {string} url - The URL to create context for
 * @returns {Object} Context object with url property
 */
function createUrlContext(url) {
  return { url };
}

// ==================== CONSTANTS TESTS ====================

describe('Browser Commander - Constants', () => {
  test('TIMING contains expected timeout values', () => {
    assert.ok(typeof TIMING === 'object', 'TIMING should be an object');
    assert.ok(typeof TIMING.DEFAULT_TIMEOUT === 'number', 'Should have DEFAULT_TIMEOUT');
    assert.ok(typeof TIMING.SCROLL_ANIMATION_WAIT === 'number', 'Should have SCROLL_ANIMATION_WAIT');
    assert.ok(typeof TIMING.VERIFICATION_TIMEOUT === 'number', 'Should have VERIFICATION_TIMEOUT');
  });

  test('TIMING.DEFAULT_TIMEOUT is 5000ms', () => {
    assert.equal(TIMING.DEFAULT_TIMEOUT, 5000, 'DEFAULT_TIMEOUT should be 5000ms');
  });
});

// ==================== ENGINE DETECTION TESTS ====================

describe('Browser Commander - Engine Detection', () => {
  test('detectEngine identifies Playwright page', () => {
    const mockPage = createMockPlaywrightPage();
    const engine = detectEngine(mockPage);
    assert.equal(engine, 'playwright', 'Should detect Playwright engine');
  });

  test('detectEngine identifies Puppeteer page', () => {
    const mockPage = createMockPuppeteerPage();
    const engine = detectEngine(mockPage);
    assert.equal(engine, 'puppeteer', 'Should detect Puppeteer engine');
  });

  test('detectEngine throws for unknown page object', () => {
    const unknownPage = { foo: 'bar' };
    let threw = false;
    try {
      detectEngine(unknownPage);
    } catch (error) {
      threw = true;
      assert.ok(error.message.includes('Unknown browser automation engine'), 'Should throw descriptive error');
    }
    assert.ok(threw, 'Should throw for unknown page object');
  });
});

// ==================== LOGGER TESTS ====================

describe('Browser Commander - Logger', () => {
  test('createLogger returns logger function (log-lazy)', () => {
    const logger = createLogger({ verbose: false });
    // log-lazy returns a function with level methods
    assert.ok(typeof logger === 'function' || typeof logger === 'object', 'Logger should be a function or object');
  });

  test('isVerboseEnabled returns boolean', () => {
    const result = isVerboseEnabled();
    assert.ok(typeof result === 'boolean', 'Should return boolean');
  });
});

// ==================== NAVIGATION ERROR TESTS ====================

describe('Browser Commander - Error Detection', () => {
  test('isNavigationError detects context destroyed errors', () => {
    const error = new Error('Execution context was destroyed');
    assert.equal(isNavigationError(error), true);
  });

  test('isNavigationError detects detached frame errors', () => {
    const error = new Error('Frame was detached');
    assert.equal(isNavigationError(error), true);
  });

  test('isNavigationError detects target closed errors', () => {
    const error = new Error('Target closed');
    assert.equal(isNavigationError(error), true);
  });

  test('isNavigationError returns false for regular errors', () => {
    const error = new Error('Something went wrong');
    assert.equal(isNavigationError(error), false);
  });

  test('isTimeoutError detects TimeoutError by name', () => {
    const error = new Error('Operation timed out');
    error.name = 'TimeoutError';
    assert.equal(isTimeoutError(error), true);
  });

  test('isTimeoutError detects timeout in message', () => {
    const error = new Error('Waiting for selector failed: timeout');
    assert.equal(isTimeoutError(error), true);
  });

  test('isTimeoutError detects "timed out" pattern', () => {
    const error = new Error('Element lookup timed out');
    assert.equal(isTimeoutError(error), true);
  });

  test('isTimeoutError returns false for non-timeout errors', () => {
    const error = new Error('Network connection failed');
    assert.equal(isTimeoutError(error), false);
  });

  test('Both error detectors return false for null', () => {
    assert.equal(isNavigationError(null), false);
    assert.equal(isTimeoutError(null), false);
  });

  test('Both error detectors return false for undefined', () => {
    assert.equal(isNavigationError(undefined), false);
    assert.equal(isTimeoutError(undefined), false);
  });
});

// ==================== URL CONDITION TESTS ====================

describe('Browser Commander - URL Conditions', () => {
  test('makeUrlCondition with exact string match', () => {
    const condition = makeUrlCondition('https://example.com/page');
    assert.equal(condition(createUrlContext('https://example.com/page')), true);
    assert.equal(condition(createUrlContext('https://example.com/other')), false);
  });

  test('makeUrlCondition with wildcard prefix (*suffix)', () => {
    const condition = makeUrlCondition('*example.com');
    assert.equal(condition(createUrlContext('https://www.example.com')), true);
    assert.equal(condition(createUrlContext('http://example.com')), true);
    assert.equal(condition(createUrlContext('https://other.org')), false);
  });

  test('makeUrlCondition with wildcard suffix (prefix*)', () => {
    const condition = makeUrlCondition('https://example.com*');
    assert.equal(condition(createUrlContext('https://example.com/anything')), true);
    assert.equal(condition(createUrlContext('https://example.com')), true);
    assert.equal(condition(createUrlContext('https://other.com')), false);
  });

  test('makeUrlCondition with contains wildcard (*substring*)', () => {
    const condition = makeUrlCondition('*vacancy*');
    assert.equal(condition(createUrlContext('https://example.com/vacancy/123')), true);
    assert.equal(condition(createUrlContext('https://hh.ru/vacancy/view')), true);
    assert.equal(condition(createUrlContext('https://example.com/jobs')), false);
  });

  test('makeUrlCondition with RegExp', () => {
    const condition = makeUrlCondition(/\/vacancy\/\d+/);
    assert.equal(condition(createUrlContext('https://hh.ru/vacancy/12345')), true);
    assert.equal(condition(createUrlContext('https://hh.ru/vacancy/abc')), false);
  });

  test('makeUrlCondition with function', () => {
    const condition = makeUrlCondition((url) => url.includes('test'));
    assert.equal(condition(createUrlContext('https://example.com/test')), true);
    assert.equal(condition(createUrlContext('https://example.com/prod')), false);
  });

  test('allConditions combines multiple conditions with AND', () => {
    const c1 = makeUrlCondition('*example.com*');
    const c2 = makeUrlCondition('*page*');
    const combined = allConditions(c1, c2);

    assert.equal(combined(createUrlContext('https://example.com/page')), true);
    assert.equal(combined(createUrlContext('https://example.com/other')), false);
    assert.equal(combined(createUrlContext('https://other.org/page')), false);
  });

  test('anyCondition combines multiple conditions with OR', () => {
    const c1 = makeUrlCondition('*example.com*');
    const c2 = makeUrlCondition('*test.org*');
    const combined = anyCondition(c1, c2);

    assert.equal(combined(createUrlContext('https://example.com/page')), true);
    assert.equal(combined(createUrlContext('https://test.org/page')), true);
    assert.equal(combined(createUrlContext('https://other.com')), false);
  });

  test('notCondition negates a condition', () => {
    const c1 = makeUrlCondition('*login*');
    const notLogin = notCondition(c1);

    assert.equal(notLogin(createUrlContext('https://example.com/dashboard')), true);
    assert.equal(notLogin(createUrlContext('https://example.com/login')), false);
  });

  test('Express-style pattern with :param', () => {
    const condition = makeUrlCondition('/vacancy/:id');
    assert.equal(condition(createUrlContext('https://hh.ru/vacancy/12345')), true);
    assert.equal(condition(createUrlContext('https://hh.ru/vacancy/abc-xyz')), true);
    assert.equal(condition(createUrlContext('https://hh.ru/jobs/123')), false);
  });
});

// ==================== FACTORY TESTS ====================

describe('Browser Commander - Factory (makeBrowserCommander)', () => {
  test('Creates commander with Playwright page', () => {
    const mockPage = createMockPlaywrightPage();
    const commander = makeBrowserCommander({ page: mockPage, verbose: false });

    assert.ok(commander, 'Commander should be created');
    assert.equal(commander.engine, 'playwright', 'Should detect Playwright engine');
    assert.equal(commander.page, mockPage, 'Should store page reference');
  });

  test('Creates commander with Puppeteer page', () => {
    const mockPage = createMockPuppeteerPage();
    const commander = makeBrowserCommander({ page: mockPage, verbose: false });

    assert.ok(commander, 'Commander should be created');
    assert.equal(commander.engine, 'puppeteer', 'Should detect Puppeteer engine');
  });

  test('Commander has every method this application uses', () => {
    const commander = makeBrowserCommander({ page: createMockPlaywrightPage(), verbose: false });
    const usedMethods = [
      'wait', 'evaluate', 'safeEvaluate', 'getUrl', 'goto', 'waitForPageReady',
      'waitForSelector', 'findByText', 'normalizeSelector', 'count', 'isVisible', 'isEnabled',
      'innerText', 'clickButton', 'fillTextArea', 'pageTrigger', 'onUrlChange', 'shouldAbort',
      'isActionStoppedError', 'destroy',
      // High-level helpers replacing former application code
      'waitForUrlCondition', 'installClickListener', 'checkAndClearFlag', 'findToggleButton',
    ];
    for (const method of usedMethods) {
      assert.equal(typeof commander[method], 'function', `Should have ${method}`);
    }
  });

  test('Commander has network tracker when enabled', () => {
    const mockPage = createMockPlaywrightPage();
    const commander = makeBrowserCommander({
      page: mockPage,
      verbose: false,
      enableNetworkTracking: true,
    });

    assert.ok(commander.networkTracker, 'Should have network tracker');
    assert.ok(typeof commander.networkTracker.startTracking === 'function', 'Network tracker should have startTracking');
  });

  test('Commander has navigation manager when enabled', () => {
    const mockPage = createMockPlaywrightPage();
    const commander = makeBrowserCommander({
      page: mockPage,
      verbose: false,
      enableNavigationManager: true,
    });

    assert.ok(commander.navigationManager, 'Should have navigation manager');
  });

  test('Commander has pageTrigger when navigation manager enabled', () => {
    const mockPage = createMockPlaywrightPage();
    const commander = makeBrowserCommander({
      page: mockPage,
      verbose: false,
      enableNavigationManager: true,
    });

    assert.ok(typeof commander.pageTrigger === 'function', 'Should have pageTrigger');
    assert.ok(typeof commander.makeUrlCondition === 'function', 'Should have makeUrlCondition');
  });

  test('Commander has destroy method for cleanup', () => {
    const mockPage = createMockPlaywrightPage();
    const commander = makeBrowserCommander({ page: mockPage, verbose: false });

    assert.ok(typeof commander.destroy === 'function', 'Should have destroy method');
    // Should not throw when called
    commander.destroy();
  });

  test('Commander getUrl returns current page URL', () => {
    const mockPage = createMockPlaywrightPage();
    const commander = makeBrowserCommander({ page: mockPage, verbose: false });

    const url = commander.getUrl();
    assert.equal(url, 'https://example.com/test', 'Should return page URL');
  });
});

// ==================== INTEGRATION PATTERN TESTS ====================

describe('Browser Commander - Usage Patterns', () => {
  test('Pattern: Check navigation vs timeout errors', () => {
    // Simulate error handling flow from apply.mjs
    const errors = [
      { error: new Error('Execution context was destroyed'), isNav: true, isTimeout: false },
      { error: new Error('Waiting for selector failed: timeout'), isNav: false, isTimeout: true },
      { error: new Error('Network error'), isNav: false, isTimeout: false },
    ];

    errors.forEach(({ error, isNav, isTimeout }) => {
      assert.equal(isNavigationError(error), isNav, `Navigation check failed for: ${error.message}`);
      assert.equal(isTimeoutError(error), isTimeout, `Timeout check failed for: ${error.message}`);
    });
  });

  test('Pattern: URL condition for vacancy pages', () => {
    // Simulate URL conditions from hh-selectors.mjs
    const vacancyCondition = makeUrlCondition('*vacancy*');
    const searchCondition = makeUrlCondition('*search/vacancy*');

    const testUrls = [
      { url: 'https://hh.ru/vacancy/12345', matchesVacancy: true, matchesSearch: false },
      { url: 'https://hh.ru/search/vacancy?from=resume', matchesVacancy: true, matchesSearch: true },
      { url: 'https://hh.ru/applicant/resumes', matchesVacancy: false, matchesSearch: false },
    ];

    testUrls.forEach(({ url, matchesVacancy, matchesSearch }) => {
      const ctx = createUrlContext(url);
      assert.equal(vacancyCondition(ctx), matchesVacancy, `Vacancy condition failed for: ${url}`);
      assert.equal(searchCondition(ctx), matchesSearch, `Search condition failed for: ${url}`);
    });
  });

  test('Pattern: Combined URL conditions for page triggers', () => {
    // Simulate complex condition from orchestrator
    const isVacancyPage = makeUrlCondition('*vacancy*');
    const isNotLoginPage = notCondition(makeUrlCondition('*login*'));
    const combined = allConditions(isVacancyPage, isNotLoginPage);

    assert.equal(combined(createUrlContext('https://hh.ru/vacancy/123')), true, 'Should match vacancy non-login');
    assert.equal(combined(createUrlContext('https://hh.ru/login')), false, 'Should not match login');
    assert.equal(combined(createUrlContext('https://hh.ru/resume')), false, 'Should not match non-vacancy');
  });
});
