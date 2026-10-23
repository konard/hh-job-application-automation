import { describe, test, assert } from 'test-anywhere';
import { alertScripts, alertsEnabled, alertUser, appleScriptString } from '../src/notify.mjs';

describe('alerts when the run waits for you', () => {
  test('on on macOS unless NOTIFY=0; never in tests or elsewhere', () => {
    assert.equal(alertsEnabled({}, 'darwin'), true);
    assert.equal(alertsEnabled({ NOTIFY: '0' }, 'darwin'), false);
    assert.equal(alertsEnabled({ NOTIFY: 'off' }, 'darwin'), false);
    assert.equal(alertsEnabled({ NODE_ENV: 'test' }, 'darwin'), false);
    assert.equal(alertsEnabled({}, 'linux'), false);
  });

  test('the text cannot break out of the AppleScript string', () => {
    assert.equal(appleScriptString('Ответьте "да" \\ нет'), '"Ответьте \\"да\\" \\\\ нет"');
    const { notification, window } = alertScripts('Answer the open question(s)\n   in the browser');
    assert.equal(notification, 'display notification "Answer the open question(s) in the browser" with title "hh.ru automation"');
    assert.ok(window.startsWith('display alert "hh.ru automation" message "Answer the open question(s) in the browser"'));
    assert.ok(window.endsWith('giving up after 3600'));
  });

  test('nothing is shown in tests, and ending it is safe', () => {
    const end = alertUser('Log in to hh.ru');
    end();
    end();
  });
});
