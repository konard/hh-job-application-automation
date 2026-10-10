/**
 * Tests for chat answers: waiting messages, template replies, rejections, learning, form links
 */
import { describe, test, assert } from 'test-anywhere';
import {
  formLinks, isRejection, knownReply, learnedPairs, pendingMessages, REJECTION_KEY, templateCore,
} from '../src/chat-answers.mjs';

const templates = new Map([
  ['Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.', 'Здравствуйте, благодарю, ожидаю.'],
  [REJECTION_KEY, 'Подскажите, пожалуйста, причину отказа?'],
]);
const qaMap = new Map([['Есть ли у вас опыт работы с моделями компьютерного зрения?', 'Да, Tesseract и vision-модели.']]);

describe('chat answers', () => {
  test('only the messages after the user\'s last one wait for an answer', () => {
    const messages = [
      { id: '1', mine: true, text: 'Отклик' },
      { id: '2', mine: false, text: 'Начнём?' },
      { id: '3', mine: true, text: 'Да' },
      { id: '4', mine: false, text: 'Вопрос 1?' },
      { id: '5', mine: false, text: 'Вопрос 2?' },
    ];
    assert.deepEqual(pendingMessages(messages).map(({ id }) => id), ['4', '5']);
  });

  test('a template message from another company and person gets the saved reply', () => {
    const text = 'Петр Петрович, здравствуйте!\n\nРассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.\n\nСидорова Анна';
    assert.equal(templateCore(text, { sender: 'Анна' }), 'Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.');
    assert.equal(knownReply({ title: 'Анна', text }, { templates, qaMap })?.answer, 'Здравствуйте, благодарю, ожидаю.');
  });

  test('a template inside a longer message still gets its reply', () => {
    const text = 'Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.\n\nПроголосуйте за нас: https://rating.hh.ru/poll';
    assert.equal(knownReply({ title: '', text }, { templates, qaMap })?.answer, 'Здравствуйте, благодарю, ожидаю.');
  });

  test('a rejection asks for the reason, whatever its wording', () => {
    const rejection = { title: 'Анна', rejection: true, text: 'К сожалению, сейчас мы не готовы пригласить вас на следующий этап.' };
    assert.equal(isRejection(rejection), true);
    assert.equal(isRejection({ text: 'К сожалению, мы выбрали другого кандидата' }), true);
    assert.equal(knownReply(rejection, { templates, qaMap })?.answer, 'Подскажите, пожалуйста, причину отказа?');
  });

  test('a bot question takes the saved answer of a close question', () => {
    const reply = knownReply({ title: 'Робот-рекрутер', text: 'Есть ли у вас опыт работы с моделями компьютерного зрения? Если есть, расскажите кратко' }, { templates, qaMap });
    assert.equal(reply?.answer, 'Да, Tesseract и vision-модели.');
  });

  test('a question asking two things is not answered by a saved answer to one of them (it is drafted)', () => {
    const english = new Map([['Какой у вас уровень владения английским языком?', 'Хороший']]);
    const reply = knownReply({ title: '', text: 'Какой у вас уровень владения английским языком и минимально комфортный уровень зарплаты на старте?' }, { templates, qaMap: english });
    assert.equal(reply, null);
  });

  test('what the user answered is learned; questions back and the application are not answers', () => {
    const { questions, templates: learned } = learnedPairs([
      { mine: true, title: 'Отклик на вакансию', text: 'Здравствуйте, ...' },
      { mine: false, title: 'Робот-рекрутер', text: 'Есть ли у вас опыт в CV?' },
      { mine: true, title: '', text: 'Можно без опыта?' },
      { mine: false, title: 'Робот-рекрутер', text: 'Есть ли опыт с BIM?' },
      { mine: true, title: '', text: 'Нет.' },
      { mine: false, title: 'Ирина', text: 'Ирина, добрый день!\nМы получили ваш отклик.\nИванова Ирина' },
      { mine: true, title: '', text: 'Спасибо, жду.' },
    ]);
    assert.deepEqual(questions, [['Есть ли опыт с BIM?', 'Нет.']]);
    assert.deepEqual(learned, [['Мы получили ваш отклик.', 'Спасибо, жду.']]);
  });

  test('questionnaire links, the hh.ru rating poll among them', () => {
    assert.deepEqual(formLinks([{ text: 'Анкета: https://forms.gle/abc123 и рейтинг https://rating.hh.ru/poll.' }]),
      ['https://forms.gle/abc123', 'https://rating.hh.ru/poll']);
  });
});
