/**
 * Experiment to understand how links-notation handles special characters
 */
import { Parser } from 'links-notation';

console.log('=== Testing links-notation format handling ===\n');

// Test different formats
const tests = [
  {
    name: 'Simple unquoted',
    input: 'Question\n  Answer',
  },
  {
    name: 'With colon unquoted (FAILS)',
    input: 'Question: detail\n  Answer',
  },
  {
    name: 'With colon in quotes',
    input: '"Question: detail"\n  Answer',
  },
  {
    name: 'With colon in single quotes',
    input: "'Question: detail'\n  Answer",
  },
  {
    name: 'With colon in parentheses',
    input: '(Question: detail)\n  Answer',
  },
  {
    name: 'Question and answer both quoted',
    input: '"Question: detail"\n  "Answer"',
  },
  {
    name: 'Hyphen at start unquoted',
    input: '- Question\n  - Answer',
  },
  {
    name: 'Hyphen at start with colon unquoted (FAILS)',
    input: '- Question: detail\n  - Answer',
  },
  {
    name: 'Hyphen at start with colon quoted',
    input: '"- Question: detail"\n  "- Answer"',
  },
];

for (const test of tests) {
  console.log(`Test: ${test.name}`);
  console.log(`Input:\n${test.input}\n`);

  try {
    const parser = new Parser();
    const result = parser.parse(test.input);
    console.log('✅ Parse successful!');
    console.log('Result:', JSON.stringify(result, null, 2));

    // Try to extract Q&A
    for (const link of result) {
      if (link._isFromPathCombination && link.values && link.values.length === 2) {
        const q = link.values[0].id || JSON.stringify(link.values[0]);
        const a = link.values[1].id || JSON.stringify(link.values[1]);
        console.log(`Extracted -> Q: "${q}" | A: "${a}"`);
      }
    }
  } catch (error) {
    console.log('❌ Parse failed:', error.message);
  }

  console.log('---\n');
}

console.log('=== Testing serialization ===\n');

// Test how to properly write Q&A pairs
const parser = new Parser();

const testPairs = [
  ['Simple question', 'Simple answer'],
  ['Question: with colon', 'Answer: with colon'],
  ['- Question with hyphen', '- Answer with hyphen'],
  ['Question (with parentheses)', 'Answer (with parentheses)'],
];

for (const [question, answer] of testPairs) {
  // Try escaping with quotes
  const escaped = `"${question.replace(/"/g, '\\"')}"\n  "${answer.replace(/"/g, '\\"')}"`;
  console.log(`Original: Q="${question}" A="${answer}"`);
  console.log(`Escaped:\n${escaped}`);

  try {
    const result = parser.parse(escaped);
    console.log('✅ Parse successful!');

    // Extract back
    for (const link of result) {
      if (link._isFromPathCombination && link.values && link.values.length === 2) {
        const q = link.values[0].id;
        const a = link.values[1].id;
        console.log(`Read back: Q="${q}" A="${a}"`);
        if (q === question && a === answer) {
          console.log('✅ Perfect match!');
        } else {
          console.log('⚠️  Mismatch!');
        }
      }
    }
  } catch (error) {
    console.log('❌ Parse failed:', error.message);
  }

  console.log('---\n');
}
