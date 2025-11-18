/**
 * Experiment to test QA database module
 */
import { readQADatabase, addOrUpdateQA, getAnswer } from '../src/qa-database.mjs';

async function test() {
  console.log('Testing QA Database Module\n');

  // Test 1: Read existing qa.test.lino
  console.log('Test 1: Reading existing qa.test.lino...');
  let qaMap = await readQADatabase();
  console.log('Found', qaMap.size, 'Q&A pairs:');
  for (const [question, answer] of qaMap.entries()) {
    console.log(`  Q: ${question}`);
    console.log(`  A: ${answer}\n`);
  }

  // Test 2: Add a new Q&A pair
  console.log('Test 2: Adding new Q&A pair...');
  await addOrUpdateQA('Какой ваш любимый язык программирования?', 'JavaScript');
  console.log('Added successfully');

  // Test 3: Read again to verify
  console.log('\nTest 3: Reading again to verify...');
  qaMap = await readQADatabase();
  console.log('Found', qaMap.size, 'Q&A pairs:');
  for (const [question, answer] of qaMap.entries()) {
    console.log(`  Q: ${question}`);
    console.log(`  A: ${answer}\n`);
  }

  // Test 4: Get specific answer
  console.log('Test 4: Getting specific answer...');
  const answer = await getAnswer('Чем вы любите заниматься в свободное время?');
  console.log('Answer:', answer);

  // Test 5: Update existing Q&A
  console.log('\nTest 5: Updating existing Q&A...');
  await addOrUpdateQA('Чем вы любите заниматься в свободное время?', 'Программированием и чтением');
  const updatedAnswer = await getAnswer('Чем вы любите заниматься в свободное время?');
  console.log('Updated answer:', updatedAnswer);

  console.log('\nAll tests completed!');
}

test().catch(console.error);
