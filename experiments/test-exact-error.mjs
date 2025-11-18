/**
 * Reproduce the exact error from the issue
 */
import { Parser } from 'links-notation';

// This is the exact content that causes the parse error mentioned in the issue
const problematicContent = `Вопрос с двоеточием: как дела?
  Хорошо!
`;

console.log('Testing content:');
console.log(problematicContent);
console.log('---\n');

try {
  const parser = new Parser();
  const result = parser.parse(problematicContent);
  console.log('✅ Parse successful (unexpected)');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log('❌ Parse error (expected):');
  console.log(error.message);
  console.log('\nFull error:');
  console.log(error);
}

// Now test with quotes
const fixedContent = `"Вопрос с двоеточием: как дела?"
  "Хорошо!"
`;

console.log('\n\n=== Testing with quotes ===');
console.log('Testing content:');
console.log(fixedContent);
console.log('---\n');

try {
  const parser = new Parser();
  const result = parser.parse(fixedContent);
  console.log('✅ Parse successful');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log('❌ Parse error:');
  console.log(error.message);
}
