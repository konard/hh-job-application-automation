/**
 * Test that write and read operations preserve multiline Q&A
 */
import { readQADatabase, writeQADatabase } from '../src/qa-database.mjs';
import fs from 'fs/promises';

console.log('Testing write/read roundtrip with multiline Q&A...\n');

// Read current database
const original = await readQADatabase();
console.log(`Original database has ${original.size} entries\n`);

// Backup paths
const backupPath = 'data/qa.lino';
const testBackupPath = 'data/qa.lino.backup';

// Backup original file
await fs.copyFile(backupPath, testBackupPath);

try {
  // Write to original location
  await writeQADatabase(original);

  // Read back
  const readBack = await readQADatabase();

  console.log(`Read back ${readBack.size} entries\n`);

  // Compare
  if (original.size !== readBack.size) {
    console.error(`ERROR: Size mismatch! Original: ${original.size}, Read back: ${readBack.size}`);
  } else {
    console.log('✓ Size matches');
  }

  let allMatch = true;
  for (const [question, answer] of original.entries()) {
    const readBackAnswer = readBack.get(question);
    if (readBackAnswer !== answer) {
      console.error(`ERROR: Answer mismatch for question: ${question.substring(0, 50)}...`);
      console.error(`  Original: ${answer.substring(0, 50)}...`);
      console.error(`  Read back: ${readBackAnswer ? readBackAnswer.substring(0, 50) : 'null'}...`);
      allMatch = false;
    }
  }

  if (allMatch) {
    console.log('✓ All Q&A pairs match exactly');
  }

  // Check multiline entry specifically
  const multilineQ = `- Работали ли с async io на питоне (есть ли опыт работы с асинхронным кодом), какие задачи решали
- Приходилось ли работать на проектах с микросервисной архитектурой? Если да, сколько было микросервисов, примерно.
- Какой был размер самой крупной команды, где вам удалось поработать (примерно)?Сколько было разработчиков? Был ли BA, QA отдел?
- Был ли опыт управления командой? Если был, то сколько человек было в команде?
- Какие плюсы и минусы Python вы видите при разработке больших и высоконагруженных проектов?
- Какой был размер (или количество записей) в самой большой таблице с которой удалось столкнутся в работе? Что хранила таблица? Можете ли привести какой-то пример кроме таблицы с логами?`;

  const multilineA = readBack.get(multilineQ);
  if (multilineA) {
    console.log('\n✓ Multiline Q&A found in read back');
    console.log('Question has', multilineQ.split('\n').length, 'lines');
    console.log('Answer has', multilineA.split('\n').length, 'lines');
  } else {
    console.error('\n✗ Multiline Q&A NOT found in read back');
  }

} finally {
  // Restore original file
  await fs.copyFile(testBackupPath, backupPath);
  await fs.unlink(testBackupPath);
}

console.log('\nTest complete!');
