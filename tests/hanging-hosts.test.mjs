import { describe, expect, test } from 'bun:test';
import { hangingHost } from '../src/hanging-hosts.mjs';

describe('hanging hosts', () => {
  test('a third-party host that timed out is blocked', () => {
    expect(hangingHost('https://rap.skcrtxr.com/pixel?x=1', 'net::ERR_CONNECTION_TIMED_OUT')).toBe('rap.skcrtxr.com');
  });
  test('hh.ru hosts and other failures are not', () => {
    expect(hangingHost('https://chatik.hh.ru/chatik/api/unread', 'net::ERR_CONNECTION_TIMED_OUT')).toBe(null);
    expect(hangingHost('https://i.hhcdn.ru/x.png', 'net::ERR_TIMED_OUT')).toBe(null);
    expect(hangingHost('https://mdd.yandex.net/x', 'net::ERR_CERT_AUTHORITY_INVALID')).toBe(null);
  });
});
