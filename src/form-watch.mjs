#!/usr/bin/env bun

/**
 * Detached watcher of a prefilled form slot: once the user sends the form, the answers sent are
 * saved to data/qa.lino (contacts as {{placeholders}}) and listed in the prefill report; then it
 * exits. It also exits when the slot browser closes, after the slot's keep-open time, or when a
 * newer prefill of the slot starts its own watcher.
 *
 * Usage: form-watch.mjs <state file> (written by startFormWatch in src/form-answers.mjs)
 */

import fs from 'fs';
import path from 'path';
import { loadContacts, withContacts } from './contacts.mjs';
import { createQADatabase } from './qa-database.mjs';
import { saveSentAnswers, watchSentAnswers } from './form-answers.mjs';

const [stateFile] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const DATA = path.join(process.cwd(), 'data');
const log = (message) => console.log(`${new Date().toISOString()} [slot ${state.slot}] ${message}`);
const isCurrent = () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')).id === state.id;
  } catch {
    return false;
  }
};

log(`👀 Watching the form on port ${state.port}: what you send is saved to qa.lino`);
try {
  const { submitted, answers } = await watchSentAnswers({ port: state.port, timeoutMs: state.timeoutMs, isCurrent, log });
  if (!submitted) {
    log(isCurrent() ? '⏹️  The form was not sent (the browser closed or the time ran out): nothing saved' : '⏹️  A newer prefill watches this slot');
  } else {
    const qaDatabase = withContacts(createQADatabase(path.join(DATA, 'qa.lino')), await loadContacts(path.join(DATA, 'contacts.lino')));
    const saved = await saveSentAnswers(answers, { qaDatabase, prefilled: state.prefilled });
    log(`📨 The form was sent: ${saved.length} of ${answers.length} answer(s) saved to qa.lino`);
    saved.forEach(({ question }) => log(`💾 ${question}`));
    if (state.reportFile) {
      fs.appendFileSync(state.reportFile, `\n## Slot ${state.slot}: sent ${new Date().toISOString()}\n\n${saved.length > 0
        ? `Saved to qa.lino:\n\n${saved.map(({ question }) => `- ${question}`).join('\n')}`
        : 'Nothing new to save to qa.lino.'}\n`);
    }
  }
} catch (error) {
  log(`❌ ${error.message.split('\n')[0]}`);
}
// The state holds the prefill's contact answers: it goes with the watcher
if (isCurrent()) {
  fs.rmSync(stateFile, { force: true });
}
process.exit(0);
