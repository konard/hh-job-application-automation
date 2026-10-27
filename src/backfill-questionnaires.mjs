/** Reindex local questionnaires without opening or sending anything in a browser. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createQADatabase } from './qa-database.mjs';
import { createChatHistory } from './chat-history.mjs';
import { learnedPairs, isSupportChat } from './chat-answers.mjs';
import { hasPrivateRecruiterLinks } from './chat-learning.mjs';
import { separateQuestionAnswers } from './multi-question.mjs';

export async function backfillQuestionnaires({
  qaDatabase = createQADatabase(path.resolve('data/qa.lino'), { resolveVariants: true }),
  history = createChatHistory(),
} = {}) {
  const saved = await qaDatabase.backfillQuestionAnswers();
  const recount = await history.recount();
  let learned = 0;
  for (const chat of Object.values(await history.read())) {
    if (isSupportChat(chat)) continue;
    for (const [question, answer] of learnedPairs(chat.messages).questions) {
      if (hasPrivateRecruiterLinks(question) || !separateQuestionAnswers(question, answer).length) continue;
      // The database writes the complete block and its components in one locked transaction.
      if (await qaDatabase.addQAIfMissing(question, answer)) learned += 1;
    }
  }
  return { ...saved, ...recount, learnedBlocks: learned };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await backfillQuestionnaires(), null, 2));
}
