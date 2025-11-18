/**
 * Test strings with both single and double quotes
 */
import { Parser } from 'links-notation';

// The most problematic case: both single and double quotes
const testString = 'Question with \'single\' and "double" quotes?';

console.log('Testing:', testString);
console.log('\n');

const strategies = [
  {
    name: 'Double quotes with escaped inner double quotes',
    format: (s) => `"${s.replace(/"/g, '\\"')}"`,
  },
  {
    name: 'Single quotes with escaped inner single quotes',
    format: (s) => `'${s.replace(/'/g, "\\'")}'`,
  },
  {
    name: 'Parentheses wrapper',
    format: (s) => `(${s})`,
  },
];

for (const strategy of strategies) {
  console.log(`Strategy: ${strategy.name}`);
  const formatted = strategy.format(testString);
  const content = `${formatted}\n  Answer`;

  console.log('Formatted:', formatted);

  try {
    const parser = new Parser();
    const links = parser.parse(content);

    for (const link of links) {
      if (link._isFromPathCombination && link.values && link.values.length === 2) {
        const qLink = link.values[0];

        const extractText = (l) => {
          if (!l) return '';
          if (l.id) return l.id;
          if (l.values && l.values.length > 0) {
            return l.values.map(v => v.id || '').join(' ');
          }
          return '';
        };

        const q = extractText(qLink);
        console.log('Extracted:', q);
        console.log('Match:', q === testString ? '✅' : '❌');
      }
    }
  } catch (error) {
    console.log('❌ Parse failed:', error.message);
  }

  console.log('\n');
}
