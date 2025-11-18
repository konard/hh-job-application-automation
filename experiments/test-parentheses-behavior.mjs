/**
 * Test parentheses behavior in links-notation
 * User feedback: Keep () unescaped if they are paired
 */
import { Parser } from 'links-notation';

const testCases = [
  {
    name: 'Paired parentheses',
    question: 'Question (with paired parens)',
    answer: 'Answer (also paired)',
  },
  {
    name: 'Unpaired opening paren',
    question: 'Question (without closing',
    answer: 'Answer',
  },
  {
    name: 'Unpaired closing paren',
    question: 'Question without opening)',
    answer: 'Answer',
  },
  {
    name: 'Multiple paired parens',
    question: 'Question (first) and (second)',
    answer: 'Answer',
  },
  {
    name: 'Nested parens',
    question: 'Question (outer (nested))',
    answer: 'Answer',
  },
  {
    name: 'Colon without quotes',
    question: 'Question: with colon',
    answer: 'Answer',
  },
  {
    name: 'Colon with single quotes',
    question: "'Question: with colon'",
    answer: 'Answer',
  },
  {
    name: 'Colon with double quotes',
    question: '"Question: with colon"',
    answer: 'Answer',
  },
];

console.log('=== Testing Parentheses and Colon Behavior ===\n');

for (const { name, question, answer } of testCases) {
  console.log(`Test: ${name}`);
  console.log(`Question: ${question}`);
  console.log(`Answer: ${answer}`);

  const content = `${question}\n  ${answer}`;
  console.log(`Content:\n${content}\n`);

  try {
    const parser = new Parser();
    const links = parser.parse(content);
    console.log('✅ Parse OK');
    console.log(`Parsed links: ${JSON.stringify(links, null, 2)}`);
  } catch (error) {
    console.log('❌ Parse FAILED');
    console.log(`Error: ${error.message}`);
  }

  console.log('\n---\n');
}
