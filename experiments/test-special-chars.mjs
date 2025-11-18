/**
 * Test which characters need escaping in links-notation
 */
import { Parser } from 'links-notation';

const testStrings = [
  'Normal text',
  'Text: with colon',
  'Text (with parens)',
  'Text "with quotes"',
  "Text 'with single quotes'",
  '- Text with hyphen',
  'Question?',
  'Exclamation!',
  'Comma, separated',
  'Period.',
  'Multiple: (special) "chars"',
];

console.log('=== Testing which strings need quoting ===\n');

for (const testStr of testStrings) {
  const unquoted = `${testStr}\n  Answer`;
  const quoted = `"${testStr.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n  "Answer"`;

  console.log(`Testing: "${testStr}"`);

  // Test unquoted
  try {
    const parser = new Parser();
    parser.parse(unquoted);
    console.log('  Unquoted: ✅ OK');
  } catch (error) {
    console.log('  Unquoted: ❌ FAILS -', error.message.substring(0, 80));
  }

  // Test quoted
  try {
    const parser = new Parser();
    parser.parse(quoted);
    console.log('  Quoted: ✅ OK');
  } catch (error) {
    console.log('  Quoted: ❌ FAILS -', error.message.substring(0, 80));
  }

  console.log('');
}

// Determine safe quoting strategy
console.log('\n=== Determining safe quoting strategy ===\n');

function needsQuoting(str) {
  // Check if string contains special characters that require quoting
  return /[:()"]/.test(str);
}

function escapeString(str) {
  // Escape backslashes and quotes
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatQA(question, answer) {
  const q = needsQuoting(question) ? `"${escapeString(question)}"` : question;
  const a = needsQuoting(answer) ? `"${escapeString(answer)}"` : answer;
  return `${q}\n  ${a}`;
}

const testCases = [
  ['Simple question', 'Simple answer'],
  ['Question: with colon', 'Answer'],
  ['Question (with parens)', 'Answer'],
  ['Question "with quotes"', 'Answer "with quotes"'],
  ['- List item question', '- List item answer'],
];

for (const [q, a] of testCases) {
  const formatted = formatQA(q, a);
  console.log(`Q: ${q}`);
  console.log(`A: ${a}`);
  console.log(`Formatted:\n${formatted}`);

  try {
    const parser = new Parser();
    parser.parse(formatted);
    console.log('✅ Parse OK\n');
  } catch (error) {
    console.log(`❌ Parse FAILED: ${error.message}\n`);
  }
}
