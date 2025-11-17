/**
 * Experiment to test how current parser handles multiline Q&A
 */
import { readQADatabase } from '../src/qa-database.mjs';

console.log('Testing current parser with existing qa.lino file...\n');

const qaMap = await readQADatabase();

console.log(`Total entries parsed: ${qaMap.size}\n`);

let i = 1;
for (const [question, answer] of qaMap.entries()) {
  console.log(`--- Entry ${i} ---`);
  console.log('Question:', JSON.stringify(question));
  console.log('Answer:', JSON.stringify(answer));
  console.log();
  i++;
}

// Check for the multiline question specifically
const multilineQuestion = `- Работали ли с async io на питоне (есть ли опыт работы с асинхронным кодом), какие задачи решали
- Приходилось ли работать на проектах с микросервисной архитектурой? Если да, сколько было микросервисов, примерно.
- Какой был размер самой крупной команды, где вам удалось поработать (примерно)?Сколько было разработчиков? Был ли BA, QA отдел?
- Был ли опыт управления командой? Если был, то сколько человек было в команде?
- Какие плюсы и минусы Python вы видите при разработке больших и высоконагруженных проектов?
- Какой был размер (или количество записей) в самой большой таблице с которой удалось столкнутся в работе? Что хранила таблица? Можете ли привести какой-то пример кроме таблицы с логами?`;

console.log('Looking for multiline question...');
const foundAnswer = qaMap.get(multilineQuestion);
if (foundAnswer) {
  console.log('Found! Answer:', JSON.stringify(foundAnswer));
} else {
  console.log('Not found with exact match. Trying to find similar questions...');
  for (const [q, a] of qaMap.entries()) {
    if (q.includes('async io') || q.includes('микросервисной')) {
      console.log('Similar question found:');
      console.log('Q:', JSON.stringify(q));
      console.log('A:', JSON.stringify(a));
    }
  }
}
