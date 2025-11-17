/**
 * Experiment to understand links-notation parser behavior with multiline text
 */
import { Parser } from 'links-notation';
import fs from 'fs/promises';

console.log('Testing links-notation parser with multiline Q&A...\n');

// Read the actual qa.lino file
const content = await fs.readFile('data/qa.lino', 'utf8');

console.log('File content length:', content.length);
console.log('\n--- Parsing with links-notation ---');

const parser = new Parser();
const links = parser.parse(content);

console.log(`\nTotal links parsed: ${links.length}`);

// Show details of each link
links.forEach((link, index) => {
  console.log(`\n--- Link ${index + 1} ---`);
  console.log('Link object:', JSON.stringify(link, null, 2));
  console.log('_isFromPathCombination:', link._isFromPathCombination);
  if (link.values) {
    console.log('Values count:', link.values.length);
    link.values.forEach((val, i) => {
      console.log(`  Value ${i}:`, JSON.stringify(val));
    });
  }
});

console.log('\n--- Checking specific lines 19-30 ---');
const lines = content.split('\n');
console.log('Lines 19-30:');
for (let i = 18; i < 30; i++) {
  console.log(`${i + 1}: ${JSON.stringify(lines[i])}`);
}
