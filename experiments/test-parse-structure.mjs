/**
 * Test to understand the parser structure
 */
import { Parser } from 'links-notation';

const content = `"Question with \\"double quotes\\"?"
  "Answer with \\"double quotes\\" too"
`;

console.log('Input:');
console.log(content);
console.log('---\n');

const parser = new Parser();
const links = parser.parse(content);

console.log('Parsed result:');
console.log(JSON.stringify(links, null, 2));
console.log('\n---\n');

console.log('Extracting Q&A:');
for (const link of links) {
  if (link._isFromPathCombination && link.values && link.values.length === 2) {
    const questionLink = link.values[0];
    const answerLink = link.values[1];

    console.log('Question link:', JSON.stringify(questionLink, null, 2));
    console.log('Answer link:', JSON.stringify(answerLink, null, 2));

    // Try different extraction methods
    console.log('\nQuestion ID:', questionLink.id);
    console.log('Answer ID:', answerLink.id);

    if (questionLink.values && questionLink.values.length > 0) {
      console.log('Question values:', questionLink.values);
      console.log('Question first value ID:', questionLink.values[0].id);
    }
  }
}
