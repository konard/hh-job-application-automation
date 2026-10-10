#!/usr/bin/env bun
/**
 * Contacts as placeholders in the saved answers: `bun run contacts-migrate [-- --dry-run]`
 *
 * The contact values of data/contacts.lino (LinkedIn, Telegram, phone, e-mail) written out in
 * data/qa.lino, data/chat-templates.lino and data/cover-letter.txt are replaced with their
 * {{placeholders}}, so a changed contact is changed once, in data/contacts.lino. Every reader
 * (apply, prefill-form, answer-chats) fills the placeholders in again.
 */

import fs from 'fs/promises';
import path from 'path';
import { contractContacts, loadContacts } from './contacts.mjs';
import { createQADatabase } from './qa-database.mjs';

const DATA = path.join(process.cwd(), 'data');
const dryRun = process.argv.includes('--dry-run');
const contacts = await loadContacts(path.join(DATA, 'contacts.lino'));
const contract = (answer) => (Array.isArray(answer) ? answer.map((item) => contractContacts(item, contacts)) : contractContacts(answer, contacts));

for (const file of ['qa.lino', 'chat-templates.lino']) {
  const db = createQADatabase(path.join(DATA, file));
  const before = await db.readQADatabase();
  const after = new Map([...before].map(([question, answer]) => [question, contract(answer)]));
  const changed = [...after].filter(([question, answer]) => JSON.stringify(answer) !== JSON.stringify(before.get(question))).length;
  if (changed > 0 && !dryRun) {
    await db.writeQADatabase(after);
  }
  console.log(`${file}: ${changed} answer(s) ${dryRun ? 'would use' : 'now use'} placeholders`);
}

const letterFile = path.join(DATA, 'cover-letter.txt');
const letter = await fs.readFile(letterFile, 'utf8').catch(() => null);
if (letter !== null) {
  const contracted = contractContacts(letter, contacts);
  if (contracted !== letter && !dryRun) {
    await fs.writeFile(letterFile, contracted);
  }
  console.log(`cover-letter.txt: ${contracted === letter ? 'no contact values' : `${dryRun ? 'would use' : 'now uses'} placeholders`}`);
}
