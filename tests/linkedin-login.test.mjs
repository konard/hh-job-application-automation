import { describe, test, assert } from 'test-anywhere';
import { candidateSources } from '../src/linkedin-login.mjs';

describe('linkedin-login candidateSources', () => {
  const sources = [
    { browser: 'chrome', profile: 'Default', byDomain: { 'linkedin.com': 3 } },
    { browser: 'arc', profile: 'Default', byDomain: { 'linkedin.com': 12 } },
    { browser: 'safari', profile: 'Default', error: 'EPERM' },
    { browser: 'firefox', profile: 'default-release', byDomain: { 'linkedin.com': 0 } },
    { browser: 'chrome', profile: 'Profile 1', byDomain: { 'linkedin.com': 7 } },
  ];

  test('tries the profiles holding the most LinkedIn cookies first, skipping unreadable and empty ones', () => {
    assert.deepEqual(candidateSources(sources).map((source) => `${source.browser}/${source.profile}`),
      ['arc/Default', 'chrome/Profile 1', 'chrome/Default']);
  });

  test('--from and --profile narrow the choice', () => {
    assert.deepEqual(candidateSources(sources, { from: 'chrome' }).map((source) => source.profile), ['Profile 1', 'Default']);
    assert.deepEqual(candidateSources(sources, { from: 'chrome', profile: 'Default' }).length, 1);
  });
});
