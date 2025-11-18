#!/usr/bin/env node

/**
 * Experiment to test Q&A database functionality
 * Tests reading, writing, and parsing with links-notation
 */

import { readQADatabase, writeQADatabase, addOrUpdateQA } from '../src/qa-database.mjs';
import { Parser } from 'links-notation';
import fs from 'fs/promises';
import path from 'path';

const QA_FILE_PATH = path.join(process.cwd(), 'data', 'qa.test.lino');

async function testQADatabase() {
  console.log('🧪 Testing Q&A Database functionality\n');

  // Test 1: Read existing qa.test.lino file
  console.log('📖 Test 1: Reading existing qa.test.lino file...');
  try {
    const content = await fs.readFile(QA_FILE_PATH, 'utf8');
    console.log('File contents:');
    console.log(content);
    console.log('');
  } catch (error) {
    console.error('❌ Error reading file:', error.message);
  }

  // Test 2: Parse with links-notation
  console.log('🔍 Test 2: Parsing with links-notation...');
  try {
    const content = await fs.readFile(QA_FILE_PATH, 'utf8');
    const parser = new Parser();
    const links = parser.parse(content);

    console.log('Parsed links:');
    console.log(JSON.stringify(links, null, 2));
    console.log('');

    // Check for path combinations
    const pathCombinations = links.filter(link => link._isFromPathCombination);
    console.log('Path combinations found:', pathCombinations.length);
    pathCombinations.forEach((link, i) => {
      console.log(`  [${i}] Values:`, link.values?.map(v => v.id || JSON.stringify(v)));
    });
    console.log('');
  } catch (error) {
    console.error('❌ Error parsing:', error.message);
  }

  // Test 3: Read Q&A database
  console.log('📚 Test 3: Reading Q&A database...');
  try {
    const qaMap = await readQADatabase();
    console.log('Q&A Map size:', qaMap.size);
    console.log('Q&A Map contents:');
    for (const [question, answer] of qaMap.entries()) {
      console.log(`  Q: "${question}"`);
      console.log(`  A: "${answer}"`);
      console.log('');
    }
  } catch (error) {
    console.error('❌ Error reading Q&A database:', error.message);
  }

  // Test 4: Add a new Q&A pair
  console.log('➕ Test 4: Adding a new Q&A pair...');
  try {
    await addOrUpdateQA('Test question', 'Test answer');
    console.log('✅ Added Q&A pair successfully');

    const qaMap = await readQADatabase();
    console.log('Q&A Map size after addition:', qaMap.size);
  } catch (error) {
    console.error('❌ Error adding Q&A pair:', error.message);
  }

  // Test 5: Verify file format
  console.log('📝 Test 5: Verifying file format...');
  try {
    const content = await fs.readFile(QA_FILE_PATH, 'utf8');
    console.log('Current file format:');
    console.log(content);

    // Check format
    const lines = content.trim().split('\n');
    let formatCorrect = true;
    for (let i = 0; i < lines.length; i += 2) {
      if (i + 1 >= lines.length) {
        console.log('⚠️  Odd number of lines, format might be incorrect');
        formatCorrect = false;
        break;
      }

      const answer = lines[i + 1];

      if (answer.startsWith('  ')) {
        console.log(`✅ Line ${i + 1}-${i + 2} format correct`);
      } else {
        console.log(`❌ Line ${i + 2} should start with 2 spaces`);
        formatCorrect = false;
      }
    }

    if (formatCorrect) {
      console.log('✅ File format is correct');
    }
  } catch (error) {
    console.error('❌ Error verifying format:', error.message);
  }

  // Test 6: Remove the test Q&A pair
  console.log('\n🧹 Test 6: Removing test Q&A pair...');
  try {
    const qaMap = await readQADatabase();
    qaMap.delete('Test question');
    await writeQADatabase(qaMap);
    console.log('✅ Removed test Q&A pair');

    const finalMap = await readQADatabase();
    console.log('Final Q&A Map size:', finalMap.size);
  } catch (error) {
    console.error('❌ Error removing test pair:', error.message);
  }

  console.log('\n✅ All tests completed!');
}

testQADatabase().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
