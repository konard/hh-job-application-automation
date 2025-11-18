/**
 * Test Cyrillic text with colons - the exact scenario from the issue
 */
import { Parser } from 'links-notation';

const tests = [
  {
    name: 'Cyrillic with colon unquoted',
    content: `Вопрос с двоеточием: как дела?
  Хорошо!`,
  },
  {
    name: 'Cyrillic with colon quoted',
    content: `"Вопрос с двоеточием: как дела?"
  "Хорошо!"`,
  },
  {
    name: 'English with colon unquoted',
    content: `Question with colon: how are you?
  Good!`,
  },
  {
    name: 'Simple Cyrillic without colon',
    content: `Простой вопрос
  Простой ответ`,
  },
];

console.log('=== Testing Cyrillic with colons ===\n');

for (const test of tests) {
  console.log(`Test: ${test.name}`);
  console.log(`Content:\n${test.content}\n`);

  try {
    const parser = new Parser();
    const result = parser.parse(test.content);
    console.log('✅ Parse successful');
    console.log(`Links count: ${result.length}\n`);
  } catch (error) {
    console.log('❌ Parse failed');
    console.log(`Error: ${error.message}\n`);
  }
}

// Now test the actual problematic content from data/qa.test.lino
console.log('\n=== Testing actual content from qa.test.lino ===\n');

const actualContent = `Вопрос с двоеточием: как дела?
  Хорошо!
- Вопрос с дефисом в начале?
  - Ответ с дефисом
- Работали ли с async io на питоне (есть ли опыт работы с асинхронным кодом), какие задачи решали
  - Да, работал, в основном при разработке ботов для VK, Telegram.`;

console.log('Content:');
console.log(actualContent);
console.log('\n---\n');

try {
  const parser = new Parser();
  const result = parser.parse(actualContent);
  console.log('✅ Parse successful (unexpected!)');
  console.log(`Links count: ${result.length}`);
} catch (error) {
  console.log('❌ Parse failed (expected)');
  console.log(`Error: ${error.message}`);
  console.log('\nThis confirms the bug!');
}
