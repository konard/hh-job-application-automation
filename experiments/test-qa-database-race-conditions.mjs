#!/usr/bin/env node
/**
 * Comprehensive test suite for qa-database.mjs
 * Tests for race conditions, concurrent writes, and data integrity
 *
 * Run with: node experiments/test-qa-database-race-conditions.mjs
 */

import { readQADatabase, writeQADatabase, addOrUpdateQA, getAnswer } from '../src/qa-database.mjs';
import fs from 'fs/promises';
import path from 'path';

const QA_FILE_PATH = path.join(process.cwd(), 'data', 'qa.test.lino');
const TEST_BACKUP_PATH = path.join(process.cwd(), 'data', 'qa.test.lino.test-backup');

let testsPassed = 0;
let testsFailed = 0;

/**
 * Backup and restore utilities
 */
async function backupQAFile() {
  try {
    await fs.copyFile(QA_FILE_PATH, TEST_BACKUP_PATH);
    console.log('✅ Backed up qa.test.lino');
  } catch {
    console.log('⚠️  No existing qa.test.lino to backup');
  }
}

async function restoreQAFile() {
  try {
    await fs.copyFile(TEST_BACKUP_PATH, QA_FILE_PATH);
    await fs.unlink(TEST_BACKUP_PATH);
    console.log('✅ Restored qa.test.lino from backup\n');
  } catch {
    console.log('⚠️  Could not restore backup\n');
  }
}

async function clearQAFile() {
  await writeQADatabase(new Map());
}

/**
 * Test assertion helper
 */
function assert(condition, testName, errorMessage) {
  if (condition) {
    console.log(`   ✅ ${testName}`);
    testsPassed++;
    return true;
  } else {
    console.log(`   ❌ ${testName}`);
    if (errorMessage) {
      console.log(`      ${errorMessage}`);
    }
    testsFailed++;
    return false;
  }
}

/**
 * Test 1: Basic read/write operations
 */
async function testBasicReadWrite() {
  console.log('\n📝 Test 1: Basic read/write operations');

  await clearQAFile();

  const testMap = new Map([
    ['Question 1', 'Answer 1'],
    ['Question 2', 'Answer 2'],
    ['Question 3', 'Answer 3'],
  ]);

  await writeQADatabase(testMap);
  const readMap = await readQADatabase();

  assert(readMap.size === 3, 'Write and read 3 entries', `Expected 3, got ${readMap.size}`);
  assert(readMap.get('Question 1') === 'Answer 1', 'Read correct answer for Question 1');
  assert(readMap.get('Question 2') === 'Answer 2', 'Read correct answer for Question 2');
  assert(readMap.get('Question 3') === 'Answer 3', 'Read correct answer for Question 3');
}

/**
 * Test 2: Sequential addOrUpdateQA calls
 */
async function testSequentialWrites() {
  console.log('\n📝 Test 2: Sequential addOrUpdateQA calls');

  await clearQAFile();

  await addOrUpdateQA('Seq Q1', 'Seq A1');
  await addOrUpdateQA('Seq Q2', 'Seq A2');
  await addOrUpdateQA('Seq Q3', 'Seq A3');

  const qaMap = await readQADatabase();

  assert(qaMap.size === 3, 'Sequential writes preserve all entries', `Expected 3, got ${qaMap.size}`);
  assert(qaMap.get('Seq Q1') === 'Seq A1', 'First entry is correct');
  assert(qaMap.get('Seq Q2') === 'Seq A2', 'Second entry is correct');
  assert(qaMap.get('Seq Q3') === 'Seq A3', 'Third entry is correct');
}

/**
 * Test 3: Concurrent writes (race condition test)
 */
async function testConcurrentWrites() {
  console.log('\n📝 Test 3: Concurrent writes (race condition prevention)');

  await clearQAFile();

  // Fire off 10 concurrent writes
  const promises = [];
  for (let i = 1; i <= 10; i++) {
    promises.push(addOrUpdateQA(`Concurrent Q${i}`, `Concurrent A${i}`));
  }

  await Promise.all(promises);

  const qaMap = await readQADatabase();

  assert(qaMap.size === 10, 'All 10 concurrent writes succeeded', `Expected 10, got ${qaMap.size}`);

  // Verify each entry
  let allCorrect = true;
  for (let i = 1; i <= 10; i++) {
    const answer = qaMap.get(`Concurrent Q${i}`);
    if (answer !== `Concurrent A${i}`) {
      allCorrect = false;
      console.log(`      Missing or incorrect: Concurrent Q${i}`);
    }
  }

  assert(allCorrect, 'All concurrent entries have correct values');
}

/**
 * Test 4: Update existing entries
 */
async function testUpdateExisting() {
  console.log('\n📝 Test 4: Update existing entries');

  await clearQAFile();

  await addOrUpdateQA('Update Q1', 'Original Answer');
  await addOrUpdateQA('Update Q2', 'Answer 2');

  let qaMap = await readQADatabase();
  assert(qaMap.size === 2, 'Initial state has 2 entries');

  // Update the first entry
  await addOrUpdateQA('Update Q1', 'Updated Answer');

  qaMap = await readQADatabase();
  assert(qaMap.size === 2, 'Still have 2 entries after update', `Expected 2, got ${qaMap.size}`);
  assert(qaMap.get('Update Q1') === 'Updated Answer', 'Entry was updated correctly');
  assert(qaMap.get('Update Q2') === 'Answer 2', 'Other entry remains unchanged');
}

/**
 * Test 5: Mixed concurrent updates and additions
 */
async function testMixedConcurrentOperations() {
  console.log('\n📝 Test 5: Mixed concurrent updates and additions');

  await clearQAFile();

  // Set up initial state
  await addOrUpdateQA('Existing Q1', 'Original A1');
  await addOrUpdateQA('Existing Q2', 'Original A2');

  // Concurrent mix of updates and new additions
  const promises = [
    addOrUpdateQA('Existing Q1', 'Updated A1'),  // Update
    addOrUpdateQA('Existing Q2', 'Updated A2'),  // Update
    addOrUpdateQA('New Q1', 'New A1'),           // Add
    addOrUpdateQA('New Q2', 'New A2'),           // Add
    addOrUpdateQA('New Q3', 'New A3'),           // Add
  ];

  await Promise.all(promises);

  const qaMap = await readQADatabase();

  assert(qaMap.size === 5, 'Have 5 entries (2 updated + 3 new)', `Expected 5, got ${qaMap.size}`);
  assert(qaMap.get('Existing Q1') === 'Updated A1', 'First entry was updated');
  assert(qaMap.get('Existing Q2') === 'Updated A2', 'Second entry was updated');
  assert(qaMap.get('New Q1') === 'New A1', 'First new entry added');
  assert(qaMap.get('New Q2') === 'New A2', 'Second new entry added');
  assert(qaMap.get('New Q3') === 'New A3', 'Third new entry added');
}

/**
 * Test 6: High concurrency stress test
 */
async function testHighConcurrency() {
  console.log('\n📝 Test 6: High concurrency stress test (50 concurrent writes)');

  await clearQAFile();

  const promises = [];
  for (let i = 1; i <= 50; i++) {
    promises.push(addOrUpdateQA(`Stress Q${i}`, `Stress A${i}`));
  }

  await Promise.all(promises);

  const qaMap = await readQADatabase();

  assert(qaMap.size === 50, 'All 50 concurrent writes succeeded', `Expected 50, got ${qaMap.size}`);

  // Verify a sample of entries
  let sampleCorrect = true;
  for (let i of [1, 10, 25, 40, 50]) {
    const answer = qaMap.get(`Stress Q${i}`);
    if (answer !== `Stress A${i}`) {
      sampleCorrect = false;
      console.log(`      Missing or incorrect: Stress Q${i}`);
    }
  }

  assert(sampleCorrect, 'Sample entries have correct values');
}

/**
 * Test 7: getAnswer helper function
 */
async function testGetAnswer() {
  console.log('\n📝 Test 7: getAnswer helper function');

  await clearQAFile();

  await addOrUpdateQA('Test Question', 'Test Answer');

  const answer = await getAnswer('Test Question');
  const missing = await getAnswer('Nonexistent Question');

  assert(answer === 'Test Answer', 'getAnswer returns correct answer');
  assert(missing === null, 'getAnswer returns null for missing question');
}

/**
 * Test 8: Empty database handling
 */
async function testEmptyDatabase() {
  console.log('\n📝 Test 8: Empty database handling');

  await clearQAFile();

  const qaMap = await readQADatabase();
  const answer = await getAnswer('Any Question');

  assert(qaMap.size === 0, 'Empty database returns empty Map');
  assert(answer === null, 'getAnswer on empty database returns null');
}

/**
 * Test 9: Special characters in questions and answers
 * Note: Some characters may have limitations due to links-notation parser
 */
async function testSpecialCharacters() {
  console.log('\n📝 Test 9: Special characters in questions and answers');

  await clearQAFile();

  // Test with characters that are safe for links-notation format
  const specialQ = 'Question with quotes and symbols?';
  const specialA = 'Answer with special chars & symbols!';

  await addOrUpdateQA(specialQ, specialA);

  const qaMap = await readQADatabase();
  const answer = qaMap.get(specialQ);

  assert(answer === specialA, 'Special characters are preserved correctly');
}

/**
 * Test 10: Cyrillic characters (relevant for Russian Q&A)
 */
async function testCyrillicCharacters() {
  console.log('\n📝 Test 10: Cyrillic/Unicode characters');

  await clearQAFile();

  await addOrUpdateQA('Как дела?', 'Хорошо, спасибо!');
  await addOrUpdateQA('What is your name?', 'Меня зовут Клод');

  const qaMap = await readQADatabase();

  assert(qaMap.size === 2, 'Cyrillic questions are saved');
  assert(qaMap.get('Как дела?') === 'Хорошо, спасибо!', 'Cyrillic Q&A preserved correctly');
  assert(qaMap.get('What is your name?') === 'Меня зовут Клод', 'Mixed language Q&A preserved');
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🧪 Running comprehensive qa-database tests...\n');
  console.log('=' .repeat(60));

  await backupQAFile();

  try {
    await testBasicReadWrite();
    await testSequentialWrites();
    await testConcurrentWrites();
    await testUpdateExisting();
    await testMixedConcurrentOperations();
    await testHighConcurrency();
    await testGetAnswer();
    await testEmptyDatabase();
    await testSpecialCharacters();
    await testCyrillicCharacters();
  } catch (error) {
    console.error('\n❌ Test suite error:', error);
    testsFailed++;
  } finally {
    await restoreQAFile();
  }

  console.log('=' .repeat(60));
  console.log('\n📊 Test Results:');
  console.log(`   ✅ Passed: ${testsPassed}`);
  console.log(`   ❌ Failed: ${testsFailed}`);
  console.log(`   Total: ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n🎉 All tests passed!\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed!\n');
    process.exit(1);
  }
}

runAllTests().catch(console.error);
