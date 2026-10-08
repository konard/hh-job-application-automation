#!/usr/bin/env bun

/**
 * Experiment to understand multiline answer behavior in qa-database
 */

import { createQADatabase } from '../src/qa-database.mjs';
import fs from 'fs/promises';
import path from 'path';

const TEST_FILE = path.join(process.cwd(), 'data', 'test-qa-multiline.lino');

async function main() {
  // Clean up test file
  try {
    await fs.unlink(TEST_FILE);
  } catch {
    // File doesn't exist, that's fine
  }

  const { addOrUpdateQA, getAnswer, readQADatabase, filePath } = createQADatabase(TEST_FILE);

  console.log('Test file:', filePath);

  // Test 1: Short multiline answer (what the test expects to be an array)
  const question1 = 'What are your GitHub profiles?';
  const multilineAnswer = `github.com/konard
github.com/link-assistant
github.com/linksplatform
github.com/link-foundation`;

  console.log('\n--- Test 1: Short multiline answer ---');
  console.log('Question:', question1);
  console.log('Answer:\n', multilineAnswer);

  await addOrUpdateQA(question1, multilineAnswer);

  // Check raw file content
  const rawContent = await fs.readFile(TEST_FILE, 'utf8');
  console.log('\n--- Raw file content ---');
  console.log(rawContent);

  // Get the answer back
  const retrieved = await getAnswer(question1);
  console.log('\n--- Retrieved answer ---');
  console.log('Type:', typeof retrieved);
  console.log('Is Array:', Array.isArray(retrieved));
  console.log('Value:', retrieved);

  // Check the full database
  const qaMap = await readQADatabase();
  console.log('\n--- Full QA Map ---');
  for (const [q, a] of qaMap.entries()) {
    console.log('Q:', q);
    console.log('A (type:', typeof a, ', isArray:', Array.isArray(a), '):', a);
  }
}

main().catch(console.error);
