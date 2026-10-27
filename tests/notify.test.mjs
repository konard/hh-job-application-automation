import { describe, test, assert } from 'test-anywhere';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALERT_TEXT, WINDOW_SCRIPT, alertNeeded, alertsEnabled, alertUser, browserWindowActive, focusActive, notificationSoundEnabled, prepareAlerts, readNotifierOutput } from '../src/notify.mjs';

describe('alerts when the run waits for you', () => {
  test('macOS window activity uses the actual browser process, including address-bar focus', async () => {
    const page = { evaluate: async () => ({ hidden: false, focused: false }) };
    const same = { platform: 'darwin', browserProcess: () => 100, frontProcess: () => 100 };
    assert.equal(await browserWindowActive(page, same), true);
    assert.equal(await browserWindowActive(page, { ...same, frontProcess: () => 200 }), false);
    assert.equal(await browserWindowActive(page, { ...same, frontProcess: () => null }), null);
    assert.equal(await browserWindowActive({ evaluate: async () => ({ hidden: true, focused: false }) }, same), false);
  });

  test('on on macOS unless NOTIFY=0; never in tests or elsewhere', () => {
    assert.equal(alertsEnabled({}, 'darwin'), true);
    assert.equal(alertsEnabled({ NOTIFY: '0' }, 'darwin'), false);
    assert.equal(alertsEnabled({ NOTIFY: 'off' }, 'darwin'), false);
    assert.equal(alertsEnabled({ NODE_ENV: 'test' }, 'darwin'), false);
    assert.equal(alertsEnabled({}, 'linux'), false);
  });

  test('muting notification sounds leaves visual alerts enabled', () => {
    for (const value of ['false', '0', 'no', 'off', 'FALSE']) {
      assert.equal(notificationSoundEnabled({ env: { NOTIFY_SOUND: value } }), false);
      assert.equal(alertsEnabled({ NOTIFY_SOUND: value }, 'darwin'), true);
    }
    assert.equal(notificationSoundEnabled({ env: { NOTIFY_SOUND: 'true' } }), true);
  });

  test('standalone alerts read the local sound setting, with the environment taking precedence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-notification-sound-'));
    const file = path.join(dir, '.lenv');
    try {
      assert.equal(notificationSoundEnabled({ env: {}, file }), true);
      fs.writeFileSync(file, '# NOTIFY_SOUND: true\nNOTIFY_SOUND: "false"\n');
      assert.equal(notificationSoundEnabled({ env: {}, file }), false);
      assert.equal(notificationSoundEnabled({ env: { NOTIFY_SOUND: 'true' }, file }), true);
      fs.writeFileSync(file, 'NOTIFY_SOUND: true\n');
      assert.equal(notificationSoundEnabled({ env: {}, file }), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the text is one short line: what is needed is told in the terminal', () => {
    assert.ok(ALERT_TEXT.length < 80);
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

  test('no alert while the browser that waits for you is the app in front', () => {
    assert.equal(alertNeeded(19883, 19883), false);
    assert.equal(alertNeeded(19883, 49284), true);
    assert.equal(alertNeeded(19883, null), true);
    assert.equal(alertNeeded(null, 49284), true);
  });

  test('nothing is shown or built in tests, and ending it is safe', async () => {
    const end = alertUser({ port: 9340 });
    end();
    end();
    assert.equal(await prepareAlerts(), false);
  });
});
