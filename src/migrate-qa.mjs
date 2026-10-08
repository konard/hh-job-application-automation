#!/usr/bin/env bun

/**
 * Migration script to normalize qa.lino format
 *
 * Reads the Q&A database through the Links Notation parser and writes it back
 * in the canonical format produced by qa-database.mjs:
 * 1. Single-line answers: Just one indented line
 * 2. Multi-line text: Quoted
 * 3. Multiple options (checkboxes): Each on separate line, no quotes
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createQADatabase } from './qa-database.mjs';

const QA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'qa.lino');

try {
  const { readQADatabase, writeQADatabase } = createQADatabase(QA_FILE);
  const qaMap = await readQADatabase();
  await writeQADatabase(qaMap);
  console.log(`✅ Migration complete! Normalized ${qaMap.size} entries`);
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}
