/**
 * Verify that parentheses are lost even when paired
 */
import { Parser } from 'links-notation';

// Helper to extract text from parsed links
function extractText(link) {
  if (!link) return '';
  if (link.id) return link.id;
  if (link.values && link.values.length > 0) {
    return link.values.map(v => extractText(v)).join(' ');
  }
  return '';
}

const tests = [
  {
    name: 'Paired parens - unquoted',
    input: 'Question (with parens)',
    quoted: false,
  },
  {
    name: 'Paired parens - quoted',
    input: 'Question (with parens)',
    quoted: true,
  },
];

console.log('=== Verifying Parentheses Loss ===\n');

for (const test of tests) {
  console.log(`Test: ${test.name}`);
  const content = test.quoted ? `"${test.input}"` : test.input;
  console.log(`Input: ${test.input}`);
  console.log(`Content: ${content}`);

  try {
    const parser = new Parser();
    const links = parser.parse(content);

    // Extract the text from first link
    const extracted = extractText(links[0]);

    console.log(`Extracted: ${extracted}`);
    console.log(`Match: ${extracted === test.input ? '✅' : '❌'}`);

    if (extracted !== test.input) {
      console.log(`Lost: "${test.input}" → "${extracted}"`);
    }
  } catch (error) {
    console.log('❌ Parse failed:', error.message);
  }

  console.log('\n---\n');
}
