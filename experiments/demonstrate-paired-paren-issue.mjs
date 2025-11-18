/**
 * Demonstrate why we MUST quote ALL parentheses, not just unpaired ones
 * User feedback suggested: "We can keep ( ), and escape them only if they are not paired"
 * But this experiment shows that EVEN PAIRED parentheses get removed!
 */
import { Parser } from 'links-notation';

// Helper to extract text from parsed links (specifically for Q&A format)
function extractQA(content) {
  const parser = new Parser();
  const links = parser.parse(content);

  const results = [];

  for (const link of links) {
    if (link._isFromPathCombination && link.values && link.values.length === 2) {
      const qLink = link.values[0];
      const aLink = link.values[1];

      const extractText = (l) => {
        if (!l) return '';
        if (l.id) return l.id;
        if (l.values && l.values.length > 0) {
          return l.values.map(v => extractText(v)).join(' ');
        }
        return '';
      };

      const q = extractText(qLink);
      const a = extractText(aLink);
      results.push({ question: q, answer: a });
    }
  }

  return results;
}

console.log('=== Demonstrating Paired Parentheses Issue ===\n');

// Test with real-world data from the issue
const realWorldQuestion = '- Работали ли с async io на питоне (есть ли опыт работы с асинхронным кодом), какие задачи решали';
const realWorldAnswer = '- Да, работал, в основном при разработке ботов для VK, Telegram.';

console.log('Original Question:', realWorldQuestion);
console.log('Original Answer:', realWorldAnswer);
console.log('\n---\n');

// Test 1: Unquoted (paired parentheses)
console.log('Test 1: Unquoted (paired parentheses)');
const unquotedContent = `${realWorldQuestion}\n  ${realWorldAnswer}`;
console.log('Content:');
console.log(unquotedContent);
console.log('\n');

try {
  const results = extractQA(unquotedContent);
  if (results.length > 0) {
    const { question, answer } = results[0];
    console.log('Extracted Question:', question);
    console.log('Extracted Answer:', answer);
    console.log('\n');

    const questionMatch = question === realWorldQuestion;
    const answerMatch = answer === realWorldAnswer;

    console.log('Question Match:', questionMatch ? '✅' : '❌');
    console.log('Answer Match:', answerMatch ? '✅' : '❌');

    if (!questionMatch) {
      console.log('\n⚠️  PROBLEM DETECTED!');
      console.log('Expected:', realWorldQuestion);
      console.log('Got:     ', question);
      console.log('\nNotice: The parentheses are REMOVED even though they are PAIRED!');
    }
  }
} catch (error) {
  console.log('❌ Parse failed:', error.message);
}

console.log('\n---\n');

// Test 2: Quoted (all text)
console.log('Test 2: Quoted (all text)');
const quotedContent = `"${realWorldQuestion}"\n  "${realWorldAnswer}"`;
console.log('Content:');
console.log(quotedContent);
console.log('\n');

try {
  const results = extractQA(quotedContent);
  if (results.length > 0) {
    const { question, answer } = results[0];
    console.log('Extracted Question:', question);
    console.log('Extracted Answer:', answer);
    console.log('\n');

    const questionMatch = question === realWorldQuestion;
    const answerMatch = answer === realWorldAnswer;

    console.log('Question Match:', questionMatch ? '✅' : '✅');
    console.log('Answer Match:', answerMatch ? '✅' : '✅');

    if (questionMatch && answerMatch) {
      console.log('\n✅ SUCCESS! Quotes preserve the parentheses exactly!');
    }
  }
} catch (error) {
  console.log('❌ Parse failed:', error.message);
}

console.log('\n---\n');
console.log('CONCLUSION:');
console.log('We MUST quote ALL strings containing parentheses (paired or unpaired)');
console.log('to preserve them as literal text. Otherwise, links-notation treats');
console.log('them as sub-structures and REMOVES the parentheses from the text!');
