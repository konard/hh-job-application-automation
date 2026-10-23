import { describe, test, assert } from 'test-anywhere';
import { WINDOW_SCRIPT, alertText, alertsEnabled, alertUser, focusActive, prepareAlerts, readNotifierOutput } from '../src/notify.mjs';

describe('alerts when the run waits for you', () => {
  test('on on macOS unless NOTIFY=0; never in tests or elsewhere', () => {
    assert.equal(alertsEnabled({}, 'darwin'), true);
    assert.equal(alertsEnabled({ NOTIFY: '0' }, 'darwin'), false);
    assert.equal(alertsEnabled({ NOTIFY: 'off' }, 'darwin'), false);
    assert.equal(alertsEnabled({ NODE_ENV: 'test' }, 'darwin'), false);
    assert.equal(alertsEnabled({}, 'linux'), false);
  });

  test('the text is one line of at most 300 characters', () => {
    assert.equal(alertText('Answer the open question(s)\n   in the browser'), 'Answer the open question(s) in the browser');
    assert.equal(alertText('x'.repeat(400)).length, 300);
  });

  test('a Focus is on while one of its assertions is not ended', () => {
    const on = { assertionUUID: 'A' };
    const ended = { invalidationAssertion: { assertionUUID: 'A' } };
    assert.equal(focusActive({ data: [{ storeAssertionRecords: [on] }] }), true);
    assert.equal(focusActive({ data: [{ storeAssertionRecords: [on], storeInvalidationRecords: [ended] }] }), false);
    assert.equal(focusActive({ data: [{}] }), false);
    assert.equal(focusActive({}), false);
  });

  test('the notification app tells its pid, that it is up, and the button pressed', () => {
    assert.deepEqual(readNotifierOutput(''), { pid: null, posted: false, failed: false, answer: null });
    assert.deepEqual(readNotifierOutput('pid 42\nposted\n'), { pid: 42, posted: true, failed: false, answer: null });
    assert.equal(readNotifierOutput('pid 42\nposted\nshow\n').answer, 'show');
    assert.equal(readNotifierOutput('pid 42\nposted\nlater\n').answer, 'later');
    assert.equal(readNotifierOutput('pid 42\ndenied Notifications are not allowed for this application\n').failed, true);
  });

  test('the window offers Show browser (the default, so a stray Return only brings the browser forward) and Later', () => {
    assert.ok(WINDOW_SCRIPT.includes("buttons: ['Later', 'Show browser'], defaultButton: 'Show browser'"));
    // The text comes in as an argument, never inside the script
    assert.ok(WINDOW_SCRIPT.startsWith('function run([title, message, pid])'));
  });

  test('nothing is shown or built in tests, and ending it is safe', async () => {
    const end = alertUser('Log in to hh.ru', { port: 9340 });
    end();
    end();
    assert.equal(await prepareAlerts(), false);
  });
});
