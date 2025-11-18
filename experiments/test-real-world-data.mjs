/**
 * Test with exact real-world data from issue #78
 */
import { writeQADatabase, readQADatabase } from '../src/qa-database.mjs';
import path from 'path';
import fs from 'fs/promises';

// Note: writeQADatabase uses hardcoded path data/qa.test.lino
// So we'll save current qa.test.lino, run test, then restore it
const QA_FILE = path.join(process.cwd(), 'data', 'qa.test.lino');
const BACKUP_FILE = path.join(process.cwd(), 'data', 'qa.test.lino.test-backup');

// Exact problematic data from the issue
const realWorldData = new Map([
  ['Вопрос с двоеточием: как дела?', 'Хорошо!'],
  [
    '- Работали ли с async io на питоне (есть ли опыт работы с асинхронным кодом), какие задачи решали',
    '- Да, работал, в основном при разработке ботов для VK, Telegram.',
  ],
  ['Простой вопрос', 'Простой ответ'],
  ['Question (with parens)', 'Answer (with parens too)'],
  ['От какой суммы вы рассматриваете предложения $/net ?', 'От $5500 ежемесячно на руки.'],
]);

console.log('🧪 Testing with real-world data from issue #78\n');

async function test() {
  try {
    // Backup current qa.test.lino
    try {
      await fs.copyFile(QA_FILE, BACKUP_FILE);
      console.log('💾 Backed up current qa.test.lino\n');
    } catch {
      console.log('ℹ️  No existing qa.test.lino to backup\n');
    }

    console.log('📝 Writing real-world Q&A data...');
    await writeQADatabase(realWorldData);
    console.log('✅ Write successful\n');

    // Read the file content to see what was written
    const fileContent = await fs.readFile(QA_FILE, 'utf8');
    console.log('📄 File content:');
    console.log('---');
    console.log(fileContent);
    console.log('---\n');

    console.log('📖 Reading Q&A data back...');
    const result = await readQADatabase();
    console.log('✅ Read successful\n');

    console.log(`📊 Results: ${result.size} entries (expected ${realWorldData.size})\n`);

    // Verify all data
    let allCorrect = true;
    for (const [question, answer] of realWorldData) {
      const retrievedAnswer = result.get(question);
      const matches = retrievedAnswer === answer;

      if (!matches) {
        console.log(`❌ MISMATCH for question: "${question.substring(0, 50)}..."`);
        console.log(`   Expected: "${answer}"`);
        console.log(`   Got: "${retrievedAnswer}"`);
        allCorrect = false;
      } else {
        console.log(`✅ "${question.substring(0, 50)}..."`);
      }
    }

    if (allCorrect && result.size === realWorldData.size) {
      console.log('\n✅ ✅ ✅ SUCCESS! NO DATA LOSS! ✅ ✅ ✅');
      console.log('All real-world Q&A pairs preserved correctly!');
    } else {
      console.log('\n❌ FAILED: Data loss detected!');
      process.exit(1);
    }
  } finally {
    // Restore original qa.test.lino
    try {
      await fs.copyFile(BACKUP_FILE, QA_FILE);
      await fs.unlink(BACKUP_FILE);
      console.log('\n♻️  Restored original qa.test.lino');
    } catch {
      console.log('\nℹ️  No backup to restore');
    }
  }
}

test().catch((error) => {
  console.error('❌ Test failed with error:', error);
  process.exit(1);
});
