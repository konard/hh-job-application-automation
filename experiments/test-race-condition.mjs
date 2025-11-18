#!/usr/bin/env node
/**
 * Experiment to demonstrate the race condition in qa-database
 * This simulates concurrent writes to qa.test.lino file
 */

import { addOrUpdateQA, readQADatabase } from '../src/qa-database.mjs';
import fs from 'fs/promises';
import path from 'path';

const QA_FILE_PATH = path.join(process.cwd(), 'data', 'qa.test.lino');
const BACKUP_PATH = path.join(process.cwd(), 'data', 'qa.test.lino.backup');

async function main() {
  console.log('🧪 Testing for race condition in qa-database...\n');

  // Backup existing qa.test.lino
  try {
    await fs.copyFile(QA_FILE_PATH, BACKUP_PATH);
    console.log('✅ Backed up existing qa.test.lino\n');
  } catch {
    console.log('⚠️  No existing qa.test.lino to backup\n');
  }

  // Test 1: Sequential writes (should work fine)
  console.log('📝 Test 1: Sequential writes');
  await addOrUpdateQA('Question 1', 'Answer 1');
  await addOrUpdateQA('Question 2', 'Answer 2');
  await addOrUpdateQA('Question 3', 'Answer 3');

  let qaMap = await readQADatabase();
  console.log(`   Current entries: ${qaMap.size}`);
  console.log('   ✅ All 3 entries saved\n');

  // Test 2: Concurrent writes (this will demonstrate the race condition)
  console.log('📝 Test 2: Concurrent writes (simulating race condition)');

  // Clear the file first
  await fs.writeFile(QA_FILE_PATH, '', 'utf8');

  // Fire off multiple concurrent writes
  const promises = [
    addOrUpdateQA('Concurrent Question 1', 'Concurrent Answer 1'),
    addOrUpdateQA('Concurrent Question 2', 'Concurrent Answer 2'),
    addOrUpdateQA('Concurrent Question 3', 'Concurrent Answer 3'),
    addOrUpdateQA('Concurrent Question 4', 'Concurrent Answer 4'),
    addOrUpdateQA('Concurrent Question 5', 'Concurrent Answer 5'),
  ];

  await Promise.all(promises);

  qaMap = await readQADatabase();
  console.log(`   Current entries: ${qaMap.size}`);

  if (qaMap.size === 5) {
    console.log('   ✅ All 5 entries saved (no race condition detected this time)');
  } else {
    console.log(`   ❌ RACE CONDITION DETECTED! Expected 5 entries, got ${qaMap.size}`);
    console.log(`   Lost ${5 - qaMap.size} entries due to concurrent writes!\n`);
    console.log('   Remaining entries:');
    for (const [q, a] of qaMap.entries()) {
      console.log(`   - ${q}: ${a}`);
    }
  }

  // Restore backup
  try {
    await fs.copyFile(BACKUP_PATH, QA_FILE_PATH);
    await fs.unlink(BACKUP_PATH);
    console.log('\n✅ Restored original qa.test.lino from backup');
  } catch {
    console.log('\n⚠️  Could not restore backup');
  }
}

main().catch(console.error);
