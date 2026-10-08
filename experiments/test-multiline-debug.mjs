/**
 * Experiment to debug multiline QA behavior
 */
import { createQADatabase } from '../src/qa-database.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_FILE = path.join(__dirname, 'test-multiline-debug.lino');

async function cleanup() {
  try {
    await fs.unlink(TEST_FILE);
  } catch {
    // File doesn't exist
  }
}

async function main() {
  await cleanup();

  const db = createQADatabase(TEST_FILE);

  // Test 1: Short multiline answer (like GitHub links)
  console.log('=== Test 1: Short multiline answers ===');
  const question1 = 'What are your GitHub links?';
  const multilineAnswer1 = `github.com/konard
github.com/link-assistant
github.com/linksplatform
github.com/link-foundation`;

  console.log('Input answer:', JSON.stringify(multilineAnswer1));
  console.log('Input contains newlines:', multilineAnswer1.includes('\n'));
  console.log('Input lines:', multilineAnswer1.split('\n'));

  await db.addOrUpdateQA(question1, multilineAnswer1);

  // Check what was written
  const fileContent1 = await fs.readFile(TEST_FILE, 'utf8');
  console.log('\nFile content:');
  console.log(fileContent1);
  console.log('File lines:', fileContent1.split('\n'));

  // Check what is read back
  const retrieved1 = await db.getAnswer(question1);
  console.log('\nRetrieved:', retrieved1);
  console.log('Is array:', Array.isArray(retrieved1));
  console.log('Type:', typeof retrieved1);

  await cleanup();

  // Test 2: Longer multiline answer (should be joined with newlines)
  console.log('\n\n=== Test 2: Long multiline answers ===');
  const question2 = 'Describe your experience';
  const multilineAnswer2 = `I have extensive experience in software development spanning over 10 years.
I specialize in distributed systems, database design, and high-performance computing.
My focus areas include scalability, reliability, and developer productivity tools.`;

  console.log('Input answer:', JSON.stringify(multilineAnswer2));
  console.log('Input lines:', multilineAnswer2.split('\n').map(l => `(${l.length}) ${l}`));

  await db.addOrUpdateQA(question2, multilineAnswer2);

  const fileContent2 = await fs.readFile(TEST_FILE, 'utf8');
  console.log('\nFile content:');
  console.log(fileContent2);

  const retrieved2 = await db.getAnswer(question2);
  console.log('\nRetrieved:', retrieved2);
  console.log('Is array:', Array.isArray(retrieved2));
  console.log('Type:', typeof retrieved2);

  await cleanup();

  // Test 3: Quoted multiline answer
  console.log('\n\n=== Test 3: Answer needing quotes (has colons) ===');
  const question3 = 'Multi-line question?';
  const answer3 = `Line 1: with colon
Line 2: with colon
Line 3: with colon`;

  console.log('Input answer:', JSON.stringify(answer3));

  await db.addOrUpdateQA(question3, answer3);

  const fileContent3 = await fs.readFile(TEST_FILE, 'utf8');
  console.log('\nFile content:');
  console.log(fileContent3);
  console.log('File lines:', fileContent3.split('\n'));

  const retrieved3 = await db.getAnswer(question3);
  console.log('\nRetrieved:', retrieved3);
  console.log('Type:', typeof retrieved3);

  await cleanup();

  // Test 4: Simple multiline without special chars (matching test case)
  console.log('\n\n=== Test 4: Simple multiline (test case) ===');
  const question4 = 'Multi-line question?';
  const answer4 = `Line 1
Line 2
Line 3`;

  console.log('Input answer:', JSON.stringify(answer4));

  await db.addOrUpdateQA(question4, answer4);

  const fileContent4 = await fs.readFile(TEST_FILE, 'utf8');
  console.log('\nFile content:');
  console.log(fileContent4);
  console.log('Raw file lines:');
  fileContent4.split('\n').forEach((line, i) => {
    console.log(`  ${i}: ${JSON.stringify(line)}`);
  });

  const retrieved4 = await db.getAnswer(question4);
  console.log('\nRetrieved:', retrieved4);
  console.log('Is array:', Array.isArray(retrieved4));
  console.log('Type:', typeof retrieved4);

  // What the test expects:
  console.log('\nTest expects at line questionLineIndex + 1: "  Line 1"');

  const lines = fileContent4.split('\n');
  const questionLineIndex = lines.findIndex(l => l.trim() === question4);
  console.log('Question at index:', questionLineIndex);
  console.log('Line at questionLineIndex + 1:', JSON.stringify(lines[questionLineIndex + 1]));
  console.log('Expected:', JSON.stringify('  Line 1'));
  console.log('Match:', lines[questionLineIndex + 1] === '  Line 1');

  await cleanup();
}

main().catch(console.error);
