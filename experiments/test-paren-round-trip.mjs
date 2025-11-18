/**
 * Test round-trip parsing of parentheses
 */
import { Parser } from 'links-notation';

const testCases = [
  {
    name: 'Paired parens unquoted',
    input: 'Question (with paired parens)\n  Answer (also paired)',
  },
  {
    name: 'Paired parens quoted',
    input: '"Question (with paired parens)"\n  "Answer (also paired)"',
  },
];

console.log('=== Testing round-trip parsing ===\n');

for (const { name, input } of testCases) {
  console.log(`Test: ${name}`);
  console.log(`Input:\n${input}\n`);

  try {
    const parser = new Parser();
    const links = parser.parse(input);

    console.log('✅ Parse successful');
    console.log('Parsed structure:');

    const pathCombos = links.filter(l => l._isFromPathCombination);
    if (pathCombos.length > 0) {
      const combo = pathCombos[0];
      console.log('Path combination found:');
      console.log(`  Values: ${combo.values?.length}`);

      if (combo.values?.length >= 2) {
        const extractText = (link) => {
          if (!link) return '';
          if (link.id && (!link.values || link.values.length === 0)) return link.id;
          if (!link.id && link.values && link.values.length > 0) {
            return link.values.map(v => extractText(v)).join(' ');
          }
          if (link.id) return link.id;
          return '';
        };

        const question = extractText(combo.values[0]);
        const answer = extractText(combo.values[1]);

        console.log(`  Question extracted: "${question}"`);
        console.log(`  Answer extracted: "${answer}"`);
      }
    }
  } catch (error) {
    console.log('❌ Parse failed');
    console.log(`Error: ${error.message}`);
  }

  console.log('\n---\n');
}
