/**
 * Experiment to reproduce issue #78: Saved questions are destroyed
 * This tests parsing the exact content that causes the parse error
 */
import { Parser } from 'links-notation';
import { readQADatabase, writeQADatabase } from '../src/qa-database.mjs';

console.log('=== Testing Issue #78: Parse Error and Data Loss ===\n');

// Test 1: Parse the problematic multi-line format
console.log('Test 1: Parsing multi-line Q&A with hyphens');
const problematicInput = `- Работали ли с async io на питоне (есть ли опыт работы с асинхронным кодом), какие задачи решали
- Приходилось ли работать на проектах с микросервисной архитектурой? Если да, сколько было микросервисов, примерно.
- Какой был размер самой крупной команды, где вам удалось поработать (примерно)?Сколько было разработчиков? Был ли BA, QA отдел?
- Был ли опыт управления командой? Если был, то сколько человек было в команде?
- Какие плюсы и минусы Python вы видите при разработке больших и высоконагруженных проектов?
- Какой был размер (или количество записей) в самой большой таблице с которой удалось столкнутся в работе? Что хранила таблица? Можете ли привести какой-то пример кроме таблицы с логами?
  - Да, работал, в основном при разработке ботов для VK, Telegram.
  - Да, десятки микросервисов
  - Работал в командах до 40 разработчиков. QA отдел был.
  - Был опыт управления командой до 10 разработчиков.
  - Python имеет очень низкую производительность, я предпочитаю JavaScript или Rust. Из плюсов Python имеет высокую популярность среди разработчиков, это значит что легко находить сотрудников на такую вакансию.
  - 150 млн туров было в самой большой таблице с которой я работал. Это была поисковая система туров в AlpOnline.
`;

try {
  const parser = new Parser();
  const result = parser.parse(problematicInput);
  console.log('✅ Parsing successful!');
  console.log('Parsed links count:', result.length);
  console.log('');
} catch (error) {
  console.error('❌ Parse error:', error.message);
  console.error('Full error:', error);
  console.log('');
}

// Test 2: Try simpler version with colon
console.log('Test 2: Testing colon in questions');
const colonInput = `Какой был размер (или количество записей) в самой большой таблице?
  150 млн туров
`;

try {
  const parser = new Parser();
  const result = parser.parse(colonInput);
  console.log('✅ Parsing with colon successful!');
  console.log('Parsed links count:', result.length);
  console.log('');
} catch (error) {
  console.error('❌ Parse error with colon:', error.message);
  console.log('');
}

// Test 3: Read current database to see if it parses
console.log('Test 3: Reading current Q&A database');
try {
  const qaMap = await readQADatabase();
  console.log('✅ Successfully read database!');
  console.log('Q&A pairs count:', qaMap.size);
  console.log('Questions in database:');
  for (const [question] of qaMap) {
    console.log(`  - ${question.substring(0, 60)}${question.length > 60 ? '...' : ''}`);
  }
  console.log('');
} catch (error) {
  console.error('❌ Error reading database:', error.message);
  console.log('');
}

// Test 4: Test writing and reading back
console.log('Test 4: Write and read back test');
const testQAMap = new Map();
testQAMap.set('Простой вопрос?', 'Простой ответ');
testQAMap.set('Вопрос с двоеточием: как дела?', 'Хорошо!');
testQAMap.set('- Вопрос с дефисом в начале?', '- Ответ с дефисом');
testQAMap.set(
  '- Работали ли с async io на питоне (есть ли опыт работы с асинхронным кодом), какие задачи решали',
  '- Да, работал, в основном при разработке ботов для VK, Telegram.',
);

try {
  console.log('Writing test data...');
  await writeQADatabase(testQAMap);
  console.log('✅ Write successful!');

  console.log('Reading back...');
  const readBack = await readQADatabase();
  console.log('✅ Read successful!');
  console.log('Original size:', testQAMap.size);
  console.log('Read back size:', readBack.size);

  if (testQAMap.size === readBack.size) {
    console.log('✅ All data preserved!');
  } else {
    console.error('❌ DATA LOSS DETECTED!');
    console.log('Lost questions:');
    for (const [question] of testQAMap) {
      if (!readBack.has(question)) {
        console.log(`  - ${question}`);
      }
    }
  }
  console.log('');
} catch (error) {
  console.error('❌ Error in write/read test:', error.message);
  console.log('');
}

console.log('=== End of tests ===');
