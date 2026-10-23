import { describe, test, assert } from 'test-anywhere';
import { alertScripts, alertsEnabled, alertUser, appleScriptString, focusActive, senderAllowed } from '../src/notify.mjs';

const app = (bundleId, auth) => `\t\t<dict>\n${auth === undefined ? '' : `\t\t\t<key>auth</key>\n\t\t\t<integer>${auth}</integer>\n`}\t\t\t<key>bundle-id</key>\n\t\t\t<string>${bundleId}</string>\n\t\t\t<key>src</key>\n\t\t\t<array>\n\t\t\t\t<dict>\n\t\t\t\t\t<key>auth</key>\n\t\t\t\t\t<integer>7</integer>\n\t\t\t\t</dict>\n\t\t\t</array>\n\t\t</dict>`;
const prefs = (...apps) => `<plist><dict>\n\t<key>apps</key>\n\t<array>\n${apps.join('\n')}\n\t</array>\n</dict></plist>`;

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

  test('a Focus is on while one of its assertions is not ended', () => {
    const on = { assertionUUID: 'A' };
    const ended = { invalidationAssertion: { assertionUUID: 'A' } };
    assert.equal(focusActive({ data: [{ storeAssertionRecords: [on] }] }), true);
    assert.equal(focusActive({ data: [{ storeAssertionRecords: [on], storeInvalidationRecords: [ended] }] }), false);
    assert.equal(focusActive({ data: [{}] }), false);
    assert.equal(focusActive({}), false);
  });

  test('notifications of an app are allowed only with its own auth entry', () => {
    const xml = prefs(app('ru.keepcoder.Telegram', 7), app('com.apple.ScriptEditor2'), app('com.apple.mail', 0));
    assert.equal(senderAllowed(xml, 'ru.keepcoder.Telegram'), true);
    assert.equal(senderAllowed(xml), false);
    assert.equal(senderAllowed(xml, 'com.apple.mail'), false);
    assert.equal(senderAllowed(xml, 'com.example.missing'), false);
    assert.equal(senderAllowed(prefs(app('com.apple.ScriptEditor2', 7))), true);
  });

  test('nothing is shown in tests, and ending it is safe', () => {
    const end = alertUser('Log in to hh.ru');
    end();
    end();
  });
});
