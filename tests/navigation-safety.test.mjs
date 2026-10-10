/**
 * Unit tests for navigation safety utilities
 * Tests the withNavigationSafety higher-order function
 */
import { describe, test, assert } from 'test-anywhere';
import { isNavigationError, withNavigationSafety } from 'browser-commander';
import { isFormLeftDuringWait } from '../src/vacancy-response.mjs';

describe('isNavigationError', () => {
  test('Returns false for null/undefined', () => {
    assert.equal(isNavigationError(null), false);
    assert.equal(isNavigationError(undefined), false);
    assert.equal(isNavigationError({}), false);
  });

  test('Returns false for non-navigation errors', () => {
    const regularError = new Error('Regular error');
    assert.equal(isNavigationError(regularError), false);
  });

  test('Detects "Execution context was destroyed"', () => {
    const error = new Error('Execution context was destroyed, most likely because of a navigation');
    assert.equal(isNavigationError(error), true);
  });

  test('Detects "Target closed"', () => {
    const error = new Error('Target closed');
    assert.equal(isNavigationError(error), true);
  });

  test('Detects "detached Frame"', () => {
    const error = new Error('Navigating frame was detached');
    assert.equal(isNavigationError(error), true);
  });

  test('Detects "Protocol error"', () => {
    const error = new Error('Protocol error (Runtime.callFunctionOn): Session closed');
    assert.equal(isNavigationError(error), true);
  });
});

describe('withNavigationSafety - Higher-order function', () => {
  test('Wraps function and passes through successful results', async () => {
    const mockFn = async (a, b) => a + b;
    const safeFn = withNavigationSafety(mockFn);

    const result = await safeFn(5, 3);
    assert.equal(result, 8);
  });

  test('Rethrows navigation errors by default', async () => {
    const mockFn = async () => {
      throw new Error('Execution context was destroyed');
    };
    const safeFn = withNavigationSafety(mockFn);

    try {
      await safeFn();
      assert.fail('Should have thrown');
    } catch (error) {
      assert.equal(error.message, 'Execution context was destroyed');
    }
  });

  test('Calls onNavigationError callback when navigation error occurs', async () => {
    const mockFn = async () => {
      throw new Error('Target closed');
    };
    const safeFn = withNavigationSafety(mockFn, {
      onNavigationError: () => ({ navigated: true }),
    });

    const result = await safeFn();
    assert.deepEqual(result, { navigated: true });
  });

  test('Returns undefined when rethrow=false and no callback', async () => {
    const mockFn = async () => {
      throw new Error('Frame was detached');
    };
    const safeFn = withNavigationSafety(mockFn, {
      rethrow: false,
    });

    const result = await safeFn();
    assert.equal(result, undefined);
  });

  test('Rethrows non-navigation errors even with rethrow=false', async () => {
    const mockFn = async () => {
      throw new Error('Some other error');
    };
    const safeFn = withNavigationSafety(mockFn, {
      rethrow: false,
    });

    try {
      await safeFn();
      assert.fail('Should have thrown');
    } catch (error) {
      assert.equal(error.message, 'Some other error');
    }
  });

  test('Preserves function arguments', async () => {
    const mockFn = async (name, age, options) => {
      return { name, age, premium: options.premium };
    };
    const safeFn = withNavigationSafety(mockFn);

    const result = await safeFn('Alice', 30, { premium: true });
    assert.deepEqual(result, { name: 'Alice', age: 30, premium: true });
  });

  test('onNavigationError callback receives error object', async () => {
    let capturedError = null;
    const mockFn = async () => {
      throw new Error('Session closed');
    };
    const safeFn = withNavigationSafety(mockFn, {
      onNavigationError: (error) => {
        capturedError = error;
        return 'handled';
      },
    });

    const result = await safeFn();
    assert.equal(result, 'handled');
    assert.equal(capturedError.message, 'Session closed');
  });

  test('Works with multiple wrapped calls', async () => {
    let callCount = 0;
    const mockFn = async (value) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Execution context was destroyed');
      }
      return value * 2;
    };

    const safeFn = withNavigationSafety(mockFn, {
      onNavigationError: () => null,
    });

    const result1 = await safeFn(5);
    assert.equal(result1, 10);
    assert.equal(callCount, 1);

    const result2 = await safeFn(5);
    assert.equal(result2, null);
    assert.equal(callCount, 2);
  });
});

describe('withNavigationSafety - Real-world usage patterns', () => {
  test('Pattern: Click with navigation detection', async () => {
    const click = async (_selector) => {
      // Simulate navigation during click
      throw new Error('Target page, context or browser has been closed');
    };

    const safeClick = withNavigationSafety(click, {
      onNavigationError: () => ({ navigated: true }),
    });

    const result = await safeClick('#submit-button');
    assert.deepEqual(result, { navigated: true });
  });

  test('Pattern: Optional operation that may fail during navigation', async () => {
    const checkElementState = async (_selector) => {
      throw new Error('Cannot find context with specified id');
    };

    const safeCheck = withNavigationSafety(checkElementState, {
      rethrow: false,
    });

    const result = await safeCheck('#optional-element');
    assert.equal(result, undefined);
  });

  test('Pattern: Verification with custom fallback', async () => {
    const verifyFill = async (_selector, _expectedValue) => {
      throw new Error('Execution context was destroyed');
    };

    const safeVerify = withNavigationSafety(verifyFill, {
      onNavigationError: () => ({ verified: false, navigationError: true }),
    });

    const result = await safeVerify('#input', 'test value');
    assert.deepEqual(result, { verified: false, navigationError: true });
  });
});

describe('isFormLeftDuringWait', () => {
  const FORM = 'https://hh.ru/applicant/vacancy_response?vacancyId=1';
  const VACANCY = 'https://hh.ru/vacancy/1';
  const timeout = Object.assign(new Error('Timeout 5000ms exceeded'), { name: 'TimeoutError' });
  // browser-commander 0.28 turns a wait that timed out after a navigation into this
  const interrupted = Object.assign(new Error('Navigation interrupted the element wait'), { name: 'NavigationInterruptedError' });

  test('a timed-out or interrupted wait after the form was left', () => {
    assert.equal(isFormLeftDuringWait(timeout, VACANCY), true);
    assert.equal(isFormLeftDuringWait(interrupted, VACANCY), true);
  });

  test('not while still on the form, nor for other errors', () => {
    assert.equal(isFormLeftDuringWait(timeout, FORM), false);
    assert.equal(isFormLeftDuringWait(interrupted, FORM), false);
    assert.equal(isFormLeftDuringWait(new Error('page.goto: net::ERR_ABORTED'), VACANCY), false);
  });
});
