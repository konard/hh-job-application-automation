/**
 * Experiment to test links-notation parser with Q&A format
 */
import { Parser } from 'links-notation';

// Test parsing existing qa.test.lino format
const testInput = `Чем вы любите заниматься в свободное время?
  Программированием
Какой ваш любимый язык программирования?
  JavaScript
`;

console.log('Testing links-notation parser with Q&A format\n');
console.log('Input:');
console.log(testInput);
console.log('\n---\n');

try {
  const parser = new Parser();
  const result = parser.parse(testInput);

  console.log('Parsed result:');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n---\n');

  console.log('Formatted output:');
  result.forEach(link => {
    console.log(link.toString());
  });
  console.log('\n---\n');

  console.log('Extracting Q&A pairs:');
  result.forEach(link => {
    if (link.id && link.values && link.values.length > 0) {
      const question = link.id;
      // Get the first value as answer
      const answer = link.values[0].id || link.values[0].toString();
      console.log(`Q: ${question}`);
      console.log(`A: ${answer}`);
      console.log('');
    }
  });

} catch (error) {
  console.error('Parse error:', error.message);
  console.error(error);
}
