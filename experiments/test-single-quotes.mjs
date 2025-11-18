/**
 * Test single quotes vs double quotes
 */
import { Parser } from 'links-notation';

const tests = [
  {
    name: 'Double quotes with backslash escape',
    content: `"Question with \\"double quotes\\"?"
  "Answer"`,
  },
  {
    name: 'Single quotes with double quotes inside',
    content: `'Question with "double quotes"?'
  'Answer'`,
  },
  {
    name: 'Double quotes without inner quotes',
    content: `"Question without quotes?"
  "Answer without quotes"`,
  },
];

for (const test of tests) {
  console.log(`\n=== ${test.name} ===`);
  console.log('Input:');
  console.log(test.content);
  console.log('\n');

  try {
    const parser = new Parser();
    const links = parser.parse(test.content);

    for (const link of links) {
      if (link._isFromPathCombination && link.values && link.values.length === 2) {
        const qLink = link.values[0];
        const aLink = link.values[1];

        // Extract text
        const extractText = (l) => {
          if (!l) return '';
          if (l.id && (!l.values || l.values.length === 0)) {
            return l.id;
          }
          if (!l.id && l.values && l.values.length > 0) {
            return l.values.map(v => v.id || '').join(' ');
          }
          if (l.id) {
            return l.id;
          }
          return '';
        };

        const q = extractText(qLink);
        const a = extractText(aLink);

        console.log(`Question: "${q}"`);
        console.log(`Answer: "${a}"`);
      }
    }

    console.log('✅ Parse successful');
  } catch (error) {
    console.log('❌ Parse failed:', error.message);
  }
}
