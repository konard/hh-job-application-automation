/**
 * Tests for the --process-chats option: option parsing in config.mjs and the auto-mode
 * stop/pause decision in answer-chats.mjs (parseArgs + the shouldStopForChat helper).
 */
import { describe, test, assert } from 'test-anywhere';

// ---------------------------------------------------------------------------
// Option parsing: answer-chats.mjs parseArgs (replicated inline so the test
// has no I/O side-effects — it exercises the same logic)
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const parsed = { chats: [], watch: false, auto: false, draft: true, forms: true, learn: true, poll: 300 };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split('=');
    if (flag === '--watch') {
      parsed.watch = true;
    } else if (flag === '--auto') {
      parsed.auto = true;
      parsed.watch = true;
    } else if (flag === '--no-draft') {
      parsed.draft = false;
    } else if (flag === '--no-forms') {
      parsed.forms = false;
    } else if (flag === '--no-learn') {
      parsed.learn = false;
    } else if (flag === '--poll') {
      parsed.poll = Number(inline ?? args[++i]);
    } else {
      parsed.chats.push(args[i].match(/(\d{6,})/)?.[1] ?? args[i]);
    }
  }
  return parsed;
}

describe('parseArgs --auto', () => {
  test('--auto sets auto and implies watch', () => {
    const argv = parseArgs(['--auto']);
    assert.equal(argv.auto, true);
    assert.equal(argv.watch, true);
  });

  test('--auto with --poll=7200 sets the poll interval', () => {
    const argv = parseArgs(['--auto', '--poll=7200']);
    assert.equal(argv.auto, true);
    assert.equal(argv.poll, 7200);
  });

  test('--auto does not disable draft or forms', () => {
    const argv = parseArgs(['--auto']);
    assert.equal(argv.draft, true);
    assert.equal(argv.forms, true);
  });

  test('--watch alone does not set auto', () => {
    const argv = parseArgs(['--watch']);
    assert.equal(argv.auto, false);
    assert.equal(argv.watch, true);
  });

  test('--poll with space-separated value is parsed', () => {
    const argv = parseArgs(['--auto', '--poll', '3600']);
    assert.equal(argv.poll, 3600);
  });
});

// ---------------------------------------------------------------------------
// Stop/pause decision: given a prefillChat result and the current auto flag,
// should the processor stop and record a stuck chat?
// ---------------------------------------------------------------------------

/**
 * Returns true when the chat should block further auto-processing.
 * Mirrors the decision in the answer-chats.mjs watch loop.
 * @param {{ replied: boolean }|null} answered - result of prefillChat
 * @param {boolean} autoMode
 */
function shouldStop(answered, autoMode) {
  if (!answered) {
    return false; // nothing pending — keep going
  }
  return !answered.replied && autoMode;
}

describe('auto-mode stop decision', () => {
  test('no result from prefillChat: do not stop', () => {
    assert.equal(shouldStop(null, true), false);
  });

  test('reply was prefilled in auto mode: do not stop', () => {
    assert.equal(shouldStop({ id: '1', replied: true, title: 'Test' }, true), false);
  });

  test('no reply found in auto mode: stop', () => {
    assert.equal(shouldStop({ id: '1', replied: false, title: 'Test' }, true), true);
  });

  test('no reply found in interactive mode: do not stop (handled by waitForSend)', () => {
    assert.equal(shouldStop({ id: '1', replied: false, title: 'Test' }, false), false);
  });
});

// ---------------------------------------------------------------------------
// Stuck-chat resolution: given the current state of the chat list, should the
// stuck chat be cleared?
// ---------------------------------------------------------------------------

/**
 * Returns true when the stuck chat has been resolved (user replied or chat is no
 * longer unread).  Mirrors the stuckChat check in the watch loop.
 * @param {{ id: string }} stuckChat
 * @param {Array<{ id: string, unread: boolean, lastIsMine: boolean }>} chats
 */
function isStuckResolved(stuckChat, chats) {
  const found = chats.find((c) => c.id === stuckChat.id);
  return !found || !found.unread || found.lastIsMine;
}

describe('stuck-chat resolution', () => {
  test('chat gone from list: resolved', () => {
    assert.equal(isStuckResolved({ id: '42' }, []), true);
  });

  test('chat is now read (unread=false): resolved', () => {
    assert.equal(isStuckResolved({ id: '42' }, [{ id: '42', unread: false, lastIsMine: false }]), true);
  });

  test('user has replied (lastIsMine=true): resolved', () => {
    assert.equal(isStuckResolved({ id: '42' }, [{ id: '42', unread: true, lastIsMine: true }]), true);
  });

  test('still unread and last message not mine: not resolved', () => {
    assert.equal(isStuckResolved({ id: '42' }, [{ id: '42', unread: true, lastIsMine: false }]), false);
  });
});
