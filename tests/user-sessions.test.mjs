import { describe, test, assert } from 'test-anywhere';
import { candidateSources } from '../src/user-sessions.mjs';

describe('user-sessions candidateSources', () => {
  const sources = [
    { browser: 'chrome', profile: 'Default', byDomain: { 'linkedin.com': 3 } },
    { browser: 'arc', profile: 'Default', byDomain: { 'linkedin.com': 12 } },
    { browser: 'safari', profile: 'Default', error: 'EPERM' },
    { browser: 'firefox', profile: 'default-release', byDomain: { 'linkedin.com': 0 } },
    { browser: 'chrome', profile: 'Profile 1', byDomain: { 'linkedin.com': 7 } },
  ];

  test('tries the profiles holding the most cookies of the site first, skipping unreadable and empty ones', () => {
    assert.deepEqual(candidateSources(sources).map((source) => `${source.browser}/${source.profile}`),
      ['arc/Default', 'chrome/Profile 1', 'chrome/Default']);
  });

  test('--from and --profile narrow the choice', () => {
    assert.deepEqual(candidateSources(sources, { from: 'chrome' }).map((source) => source.profile), ['Profile 1', 'Default']);
    assert.deepEqual(candidateSources(sources, { from: 'chrome', profile: 'Default' }).length, 1);
  });

  test('a condition of the caller narrows it too (--login-from "chrome default")', () => {
    const accept = (source) => `${source.browser} ${source.profile}`.toLowerCase().includes('chrome default');
    assert.deepEqual(candidateSources(sources, { accept }).map((source) => `${source.browser}/${source.profile}`), ['chrome/Default']);
  });
});
