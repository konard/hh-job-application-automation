/**
 * Test to understand the quotes issue
 */
import { addOrUpdateQA, readQADatabase } from '../src/qa-database.mjs';
import fs from 'fs/promises';

const TEST_DATA_DIR = 'data';
const TEST_QA_FILE = 'data/qa.test.lino';

// Clean up
try {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
} catch {}

console.log('=== Testing quotes handling ===\n');

const question = 'Question with "double quotes"?';
const answer = 'Answer with "double quotes" too';

console.log(`Q: ${question}`);
console.log(`A: ${answer}\n`);

await addOrUpdateQA(question, answer);

console.log('File content after writing:');
const content = await fs.readFile(TEST_QA_FILE, 'utf8');
console.log(content);
console.log('---\n');

const result = await readQADatabase();
console.log('Read back result:');
console.log(`Size: ${result.size}`);
console.log(`Has question: ${result.has(question)}`);
console.log(`Answer: ${result.get(question)}`);

if (result.get(question) !== answer) {
  console.log('\n❌ MISMATCH!');
  console.log(`Expected: "${answer}"`);
  console.log(`Got: "${result.get(question)}"`);

  // Check all keys
  console.log('\nAll keys in database:');
  for (const [q, a] of result) {
    console.log(`  Q: "${q}"`);
    console.log(`  A: "${a}"`);
  }
} else {
  console.log('\n✅ Perfect match!');
}

// Clean up
await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
