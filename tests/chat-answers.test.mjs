/**
 * Tests for chat answers: waiting messages, template replies, rejections, learning, form links
 */
import { describe, test, assert } from 'test-anywhere';
import {
  formLinks, isPattern, isRejection, knownReply, learnedPairs, learnPatterns, matchesPattern, pendingMessages, PATTERN_PREFIX,
  NO_REPLY, REJECTION_KEY, isSupportChat, questionCore, summaryPairs, templateCore, withLearnedPatterns,
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
    const rejection = { title: 'Анна', heading: 'Rejection', text: 'К сожалению, сейчас мы не готовы пригласить вас на следующий этап.' };
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
      { mine: false, title: 'HR', text: 'Резюме отправлено на рассмотрение.' },
      { mine: true, title: '', text: 'Ответьте на приглашение, даже если оно вам не интересно. Так мы сможем рекомендовать вам более подходящие вакансии.' },
    ]);
    assert.deepEqual(questions, [['Есть ли опыт с BIM?', 'Нет.']]);
    assert.deepEqual(learned, [['Мы получили ваш отклик.', 'Спасибо, жду.']]);
  });

  test('questionnaire links, the hh.ru rating poll among them', () => {
    assert.deepEqual(formLinks([{ text: 'Анкета: https://forms.gle/abc123 и рейтинг https://rating.hh.ru/poll.' }]),
      ['https://forms.gle/abc123', 'https://rating.hh.ru/poll']);
  });
});

describe('template patterns', () => {
  const reply = 'Здравствуйте, благодарю, ожидаю.';
  const examples = new Map([
    ['Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.', reply],
    ['Сообщаем, что Ваше резюме принято в работу. После рассмотрения, в случае соответствия параметров резюме и рабочего опыта требованиям по данной позиции, наш специалист обязательно свяжется с Вами. Хорошего дня!', reply],
    ['Спасибо, что откликнулись на вакансию. В течение двух рабочих дней мы изучим ваше резюме. После этого напишем или позвоним вам.', reply],
    [REJECTION_KEY, 'Подскажите, пожалуйста, причину отказа?'],
  ]);

  test('messages answered the same way are generalized: shared words in order, gaps, word endings', () => {
    const patterns = learnPatterns(examples);
    assert.deepEqual([...patterns], [[`${PATTERN_PREFIX}ваше резюме … опыт* … позиции … свяже* с вами`, reply]]);
  });

  test('a different template with the same reply stays apart, a single example makes no pattern', () => {
    assert.equal(learnPatterns(new Map([...examples].slice(2))).size, 0);
  });

  test('another wording matches the pattern; a question or another message does not', () => {
    const templates = withLearnedPatterns(examples);
    const other = 'Анна, добрый день!\nМы получили ваше резюме. Если ваш опыт подойдёт для этой позиции, наш рекрутер свяжется с вами.';
    assert.equal(knownReply({ title: '', text: other }, { templates, qaMap })?.answer, reply);
    // It says all of the message: sent as a saved reply is
    assert.equal(knownReply({ title: '', text: other }, { templates, qaMap })?.perfect, true);
    // An invitation in the same words is not the template
    const invitation = 'Мы получили ваше резюме. Если ваш опыт подойдёт для этой позиции, свяжемся с вами и пригласим на собеседование.';
    assert.equal(knownReply({ title: '', text: invitation }, { templates, qaMap })?.perfect, false);
    assert.ok(matchesPattern('ваше резюме … свяже* с вами', 'Ваше резюме у нас, свяжемся с вами'));
    assert.equal(knownReply({ title: '', text: 'Ваше резюме подходит, опыт есть, по позиции свяжемся с вами, когда удобно?' }, { templates, qaMap }), null);
    assert.equal(knownReply({ title: '', text: 'Пришлите, пожалуйста, портфолио.' }, { templates, qaMap }), null);
  });

  test('a closing with a signature after it, «вакансии» for «позиции»: still the template', () => {
    const templates = new Map(examples);
    const message = 'Константин Константинович, здравствуйте!\n\nСпасибо за отклик! Рассмотрим ваше резюме. Если навыки и опыт ' +
      'подойдут для вакансии, мы свяжемся с вами.\n\nС уважением, Егор\nHR команды Нонтон';
    assert.equal(templateCore(message, { sender: 'Егор' }),
      'Спасибо за отклик! Рассмотрим ваше резюме. Если навыки и опыт подойдут для вакансии, мы свяжемся с вами.');
    assert.equal(knownReply({ title: 'Егор', text: message }, { templates, qaMap })?.perfect, true);
    // The chat list's line: the whole message in one line
    assert.equal(knownReply({ title: '', text: message.replace(/\n+/g, ' ') }, { templates, qaMap })?.perfect, true);
    // What the company adds asks the user to do something: not sent
    const more = `${message.split('\n\n').slice(0, 2).join('\n\n')} Пройдите, пожалуйста, тестовое задание по ссылке.`;
    assert.equal(knownReply({ title: 'Егор', text: more }, { templates, qaMap })?.perfect, false);
  });

  test('learning again replaces old patterns', () => {
    const stale = new Map([...examples, [`${PATTERN_PREFIX}старый шаблон`, reply]]);
    assert.ok(!withLearnedPatterns(stale).has(`${PATTERN_PREFIX}старый шаблон`));
    assert.ok([...withLearnedPatterns(stale).keys()].some(isPattern));
  });
});

describe('recruiter bot summaries and messages without a reply', () => {
  const summary = 'Есть ли у вас опыт работы в качестве ML инженера в направлении CV? Если есть, то сколько лет?: Можно без опыта?\n' +
    'Работали ли с архитектурными или строительными чертежами?: Нет.\n' +
    'Какой у вас уровень владения английским языком?: Английский — C1.';

  test('the summary lines are learned, answers that are questions back are not', () => {
    const { questions } = learnedPairs([{ mine: false, title: 'Робот-рекрутер', text: summary }]);
    assert.deepEqual(questions, [
      ['Работали ли с архитектурными или строительными чертежами?', 'Нет.'],
      ['Какой у вас уровень владения английским языком?', 'Английский — C1.'],
    ]);
    assert.deepEqual(summaryPairs('Есть ли опыт? Расскажите'), []);
  });

  test('a bot summary keeps the answers to questions asked without «?»', () => {
    const bot = 'Есть опыт автоматизации на Python или TypeScript?: Да\nОпыт работы с Playwright или Cypress/Selenium: Да\nОпыт использования AI для автоматизации тестирования?: Да';
    assert.deepEqual(summaryPairs(bot), [
      ['Есть опыт автоматизации на Python или TypeScript?', 'Да'],
      ['Опыт работы с Playwright или Cypress/Selenium', 'Да'],
      ['Опыт использования AI для автоматизации тестирования?', 'Да'],
    ]);
    assert.deepEqual(learnedPairs([{ mine: false, title: 'Робот-рекрутер', text: bot }]).questions.length, 3);
    // Lines with colons but no question are not a summary
    assert.deepEqual(summaryPairs('Адрес: Москва\nГрафик: 5/2'), []);
  });

  test('a summary and a template saved without a reply need no reply', () => {
    const closing = 'Спасибо!\nВаши ответы отправлены работодателю. Если ваш отклик его заинтересует, он напишет в этом же чате или позвонит по номеру, который вы указали.';
    const withClosing = new Map([...templates, [closing.replace('\n', ' '), NO_REPLY]]);
    assert.equal(knownReply({ title: 'Робот-рекрутер', text: summary }, { templates, qaMap })?.noReply, true);
    const reply = knownReply({ title: 'Робот-рекрутер', text: closing }, { templates: withClosing, qaMap });
    assert.equal(reply?.noReply, true);
    assert.equal(reply?.answer, '');
  });
});

describe('hh.ru AI assistant chats', () => {
  const messages = [
    { mine: false, title: 'ИИ-помощник', text: 'Расскажите, пожалуйста, был ли у вас опыт работы с Node.js?' },
    { mine: true, title: '', text: 'Да.' },
    { mine: false, title: 'ИИ-помощник', text: 'Хорошо, а расскажите, пожалуйста, в каких проектах или задачах вы использовали Node.js?' },
    { mine: true, title: '', text: 'В Kaiten и Deep.Foundation.' },
    { mine: false, title: 'ИИ-помощник', text: 'Понял, спасибо за подробности. А есть ли у вас опыт работы с NestJS?' },
    { mine: true, title: '', text: 'Нет.' },
    { mine: false, title: 'ИИ-помощник', text: 'В разговоре с кандидатом я узнал:\n- Работали ли вы с Node.js? Ответ:\n- Да.\n- Есть ли у вас опыт использования NestJS? Ответ:\n- Нет.\n\nВопросы к работодателю, на которые помощник не смог ответить:\nВопросов не было' },
  ];

  test('the questions are learned without the acknowledgement of the last answer, and from the summary', () => {
    assert.deepEqual(learnedPairs(messages).questions, [
      ['Был ли у вас опыт работы с Node.js?', 'Да.'],
      ['В каких проектах или задачах вы использовали Node.js?', 'В Kaiten и Deep.Foundation.'],
      ['Есть ли у вас опыт работы с NestJS?', 'Нет.'],
      ['Работали ли вы с Node.js?', 'Да.'],
      ['Есть ли у вас опыт использования NestJS?', 'Нет.'],
    ]);
  });

  test('a question asked again in other words is answered word for word', () => {
    const learned = new Map(learnedPairs(messages).questions);
    const reply = knownReply({ title: 'ИИ-помощник', text: 'Спасибо! А был ли у вас опыт работы с Node.js?' }, { templates, qaMap: learned });
    assert.equal(reply?.answer, 'Да.');
    assert.equal(reply?.perfect, true);
  });

  test('the summary needs no reply', () => {
    assert.equal(knownReply(messages.at(-1), { templates, qaMap: new Map() })?.noReply, true);
  });

  test('only acknowledgements and polite openers are taken off a question', () => {
    assert.equal(questionCore('Хорошо понимаете английский?'), 'Хорошо понимаете английский?');
    assert.equal(questionCore('Расскажите о вашем опыте работы с Go?'), 'Расскажите о вашем опыте работы с Go?');
    assert.equal(questionCore('Ок, а где вы находитесь?'), 'Где вы находитесь?');
  });
});

describe('reminders', () => {
  test('the answer after a reminder is the answer to the question before it', () => {
    const { questions } = learnedPairs([
      { mine: false, title: 'Анна', text: 'Какой самый нагруженный проект у вас был?' },
      { mine: false, title: 'Анна', text: 'Здравствуйте. К сожалению, не дождалась вашего ответа. Мы можем продолжить наше общение по вакансии?' },
      { mine: true, title: '', text: '150 млн туров, поиск до 50 мс.' },
    ]);
    assert.deepEqual(questions, [['Какой самый нагруженный проект у вас был?', '150 млн туров, поиск до 50 мс.']]);
  });
  test('a greeting alone is not an answer: the answer after it is', () => {
    const { questions, templates: learned } = learnedPairs([
      { mine: false, title: 'Анна', text: 'Какой самый нагруженный проект у вас был?' },
      { mine: true, title: '', text: 'Здравствуйте!' },
      { mine: true, title: '', text: '150 млн туров, поиск до 50 мс.' },
    ]);
    assert.deepEqual(questions, [['Какой самый нагруженный проект у вас был?', '150 млн туров, поиск до 50 мс.']]);
    assert.deepEqual(learned, []);
  });

  test('the hh.ru support chat is not learned from', () => {
    assert.equal(isSupportChat({ vacancy: '', company: 'Техническая поддержка' }), true);
    assert.equal(isSupportChat({ vacancy: 'Senior Java Developer', company: 'Росгосстрах' }), false);
  });
});

describe('requests without a question mark', () => {
  test('are learned as questions, without the acknowledgement before them', () => {
    const { questions, templates: learned } = learnedPairs([
      { mine: false, title: 'ИИ-помощник', text: 'Хорошо, учту ваш опыт. Теперь расскажите, пожалуйста, о вашем опыте работы с платёжными интеграциями.' },
      { mine: true, title: '', text: 'Т-Банк, ЮKassa.' },
      { mine: false, title: 'Анна', text: 'Проживаете в РФ или РБ' },
      { mine: true, title: '', text: 'Нет' },
    ]);
    assert.deepEqual(questions, [
      ['Расскажите, пожалуйста, о вашем опыте работы с платёжными интеграциями.', 'Т-Банк, ЮKassa.'],
      ['Проживаете в РФ или РБ', 'Нет'],
    ]);
    assert.deepEqual(learned, []);
  });
});

describe('A message in English is answered in English', () => {
  test('an acknowledgement in English is thanked for in English; a Russian template reply is not reused', async () => {
    const { knownReply, isThanks } = await import('../src/chat-answers.mjs');
    const templates = new Map([
      ['Спасибо за отклик! Мы рассмотрим Ваше резюме и позже сообщим о своем решении.', 'Здравствуйте, благодарю.'],
      ['Thank you for your application! We will review your resume and get back to you.', 'Здравствуйте, благодарю.'],
    ]);
    const message = { title: '', text: 'Thanks for applying! Our team will review your CV and contact you if your experience is a match.' };
    assert.equal(knownReply(message, { templates, qaMap: new Map() }).answer, 'Hello, thank you.');
    // An English thanks saved before is the one used
    templates.set('We have received your application and will get back to you.', 'Hello, thank you very much.');
    templates.set('Your application is under review, we will contact you soon.', 'Hello, thank you very much.');
    assert.equal(knownReply(message, { templates, qaMap: new Map() }).answer, 'Hello, thank you very much.');
    assert.equal(isThanks('Hello, thank you, I look forward to hearing from you.'), true);
    // A Russian message keeps its Russian thanks
    const russian = { title: '', text: 'Спасибо за отклик! Мы рассмотрим резюме и свяжемся с вами, если опыт подойдёт.' };
    assert.equal(knownReply(russian, { templates, qaMap: new Map() }).answer, 'Здравствуйте, благодарю.');
  });

  test('a question in English takes no saved answer in Russian; a Russian one takes either', async () => {
    const { findBestMatch, isEnglish, speaksLanguageOf } = await import('../src/qa-database.mjs');
    assert.equal(isEnglish('Are you comfortable with interviews in English?'), true);
    assert.equal(isEnglish('Python, FastAPI?'), false);
    assert.equal(speaksLanguageOf('Where are you located?', 'Во Вьетнаме.'), false);
    assert.equal(speaksLanguageOf('Где вы находитесь?', "I'm in Vietnam."), true);
    const qaMap = new Map([['pattern: experience … kafka', 'Да, 3 года.']]);
    assert.equal(findBestMatch('Do you have commercial experience with Kafka?', qaMap), null);
    assert.equal(findBestMatch('Какой у вас experience с Kafka?', qaMap).answer, 'Да, 3 года.');
    qaMap.set('pattern: experience with kafka', 'Yes, 3 years.');
    assert.equal(findBestMatch('Do you have commercial experience with Kafka?', qaMap).answer, 'Yes, 3 years.');
  });
});

describe('Acknowledgements of the application, in any company\'s words', () => {
  test('are thanked for as the saved ones; one that asks, invites or rejects is not', async () => {
    const { isAcknowledgement, knownReply } = await import('../src/chat-answers.mjs');
    const templates = new Map([
      ['Спасибо за отклик! Мы рассмотрим Ваше резюме и позже сообщим о своем решении.', 'Здравствуйте, благодарю, ожидаю.'],
      ['Рассмотрим ваше резюме. Если навыки и опыт подойдут для позиции, мы свяжемся с вами.', 'Здравствуйте, благодарю, ожидаю.'],
      ['Компания Рога и копыта рассмотрит Ваше резюме на вакансию Разработчик и позже сообщит Вам о своем решении.', 'Здравствуйте, благодарю.'],
    ]);
    const message = 'Константин Константинович, здравствуйте!\n\nСпасибо за интерес к нашей вакансии! Мы обязательно рассмотрим ' +
      'ваше резюме. Если навыки и опыт покажутся нам подходящими для данной позиции, мы свяжемся с вами.\n\nС уважением,\nКоманда HR Интерлизинг';
    const reply = knownReply({ title: 'Дарья', text: message }, { templates, qaMap: new Map() });
    assert.equal(reply.answer, 'Здравствуйте, благодарю, ожидаю.');
    assert.equal(reply.perfect, true);
    assert.equal(isAcknowledgement('Спасибо за ваш отклик, ознакомимся с Вашим резюме и дадим обратную связь.'), true);
    assert.equal(isAcknowledgement('Ваш отклик мы получили! Внимательно изучим ваше резюме. Если ваш опыт совпадёт с нашими задачами — наша команда свяжется с вами.'), true);
    assert.equal(isAcknowledgement('Благодарим вас за проявленный интерес к нашей компании Рога и копыта, а также за участие в процессе ' +
      'отбора на позицию Python разработчик. Мы ценим время и усилия, которые вы вложили в знакомство с нами. На данный момент мы ' +
      'продолжаем рассматривать кандидатов и анализировать результаты собеседований. Ваша кандидатура остается в числе тех, кто нас ' +
      'заинтересовал. Если мы примем положительное решение -- обязательно свяжемся с вами в ближайшее время.'), true);
    // Asks, invites, sends a link or rejects: left to the user
    assert.equal(isAcknowledgement('Мы рассмотрим ваше резюме. Какой у вас опыт с Kafka? Свяжемся с вами.'), false);
    assert.equal(isAcknowledgement('Мы рассмотрим ваше резюме и пригласим на интервью, если опыт подойдёт. Свяжемся с вами.'), false);
    assert.equal(isAcknowledgement('Мы рассмотрим ваше резюме, пройдите тест по ссылке https://example.com, и мы свяжемся с вами.'), false);
    assert.equal(isAcknowledgement('Мы рассмотрели ваше резюме, но, к сожалению, опыт не подходит. Свяжемся, если появится позиция.'), false);
    assert.equal(isAcknowledgement('Расскажите о своем опыте, мы рассмотрим резюме и свяжемся с вами.'), false);
  });
});

describe('Rejections read as they show in the chat window', () => {
  test('only the unread «Отказ» cells', async () => {
    const { visibleRejections } = await import('../src/chat-answers.mjs');
    const chats = [
      { id: '1', unread: true, last: 'Отказ' },
      { id: '2', unread: false, last: 'Отказ' },
      { id: '3', unread: true, last: 'Собеседование' },
      { id: '4', unread: true, last: 'Здравствуйте! Отказ от...' },
    ];
    assert.deepEqual(visibleRejections(chats).map((chat) => chat.id), ['1']);
  });

  test('in any language: the word, or a red status in place of the last message', async () => {
    const { isApplication, isRejection, isRejectionCell, learnedPairs, visibleRejections } = await import('../src/chat-answers.mjs');
    const chats = [
      { id: '1', unread: true, last: 'Rejection' },
      // hh.ru's status in a language without its word here: red is a rejection, green an invitation
      { id: '2', unread: true, last: 'Rad etildi', status: 'red' },
      { id: '3', unread: true, last: 'Interview', status: 'green' },
      // A message is not a status, whatever its color
      { id: '4', unread: true, last: 'Unfortunately, we have chosen another candidate.', status: 'red' },
    ];
    assert.deepEqual(visibleRejections(chats).map((chat) => chat.id), ['1', '2']);
    assert.equal(isRejectionCell({ last: 'Отказ' }), true);
    assert.equal(isRejection({ mine: false, heading: 'Rejection', text: 'Thank you for your interest.' }), true);
    assert.equal(isRejection({ mine: false, heading: '', text: 'Thank you for your interest.' }), false);
    // The application: hh.ru's title in either language, or any title on the user's own message
    assert.equal(isApplication({ mine: true, title: 'Vacancy application' }), true);
    assert.equal(isApplication({ mine: true, title: 'Bewerbung' }), true);
    assert.equal(isApplication({ mine: true, title: '' }), false);
    assert.equal(isApplication({ title: 'Отклик на вакансию' }), true);
    const { templates } = learnedPairs([
      { mine: true, title: 'Vacancy application', text: 'Здравствуйте, мне интересна вакансия.' },
      { mine: false, title: 'Анна', text: 'Спасибо, рассмотрим ваше резюме.' },
      { mine: true, title: '', text: 'Благодарю, ожидаю.' },
      { mine: false, title: 'Анна', text: 'Приглашаем вас на интервью в четверг.' },
      // hh.ru's own notice on the user's side is not the user's answer
      { mine: true, title: '', text: 'Respond to the invitation, even if you are not interested. This helps us.' },
    ]);
    assert.deepEqual(templates, [['Спасибо, рассмотрим ваше резюме.', 'Благодарю, ожидаю.']]);
  });

  test('the user\'s activity is counted, the tool\'s own clicks are not', async () => {
    const { readUserActivity } = await import('../src/chat-answers.mjs');
    const listeners = {};
    globalThis.window = {};
    globalThis.document = {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      querySelector: () => ({ value: '  ' }),
    };
    const first = readUserActivity();
    assert.equal(first.typing, false);
    assert.ok(first.at > 0);
    window.__chatUserActivity.at = 1;
    window.__chatAutomating = true;
    listeners.pointerdown({ isTrusted: true });
    assert.equal(readUserActivity().at, 1);
    window.__chatAutomating = false;
    listeners.pointerdown({ isTrusted: true });
    assert.ok(readUserActivity().at > 1);
    delete globalThis.window;
    delete globalThis.document;
  });
});

describe('A bot offering the answers given before', async () => {
  const { compareReusedAnswers, describeReuse, isReuseOffer, reuseOption } = await import('../src/chat-answers.mjs');
  const offer = (list) => [
    { id: '1', mine: true, title: 'Отклик на вакансию', text: 'Здравствуйте' },
    { id: '2', mine: false, title: '', text: 'Похоже, вы отвечали на часть вопросов:' },
    { id: '3', mine: false, title: '', text: list },
    { id: '4', mine: false, title: '', text: 'Используем эти ответы?' },
  ];
  const saved = new Map([
    ['Are you currently located in Russia or Belarus?', 'Нет'],
    ['How would you rate your English level?', 'B2 or higher'],
  ]);
  const answersFor = async () => saved;
  const options = ['Да. Используем те же ответы', 'Нет. Отвечу заново'];

  test('the offer is found and is not answered from the saved answers or learned', () => {
    assert.equal(isReuseOffer('Используем эти ответы?'), true);
    assert.equal(isReuseOffer('Какие ответы вы используете?'), false);
    assert.equal(knownReply({ text: 'Используем эти ответы?' }, { templates: new Map(), qaMap: new Map([['Используем эти ответы?', 'Да']]) }), null);
    const chat = [...offer('Are you currently located in Russia or Belarus?: No'), { id: '5', mine: true, title: '', text: 'Да. Используем те же ответы' }];
    assert.deepEqual(learnedPairs(chat).questions.map(([question]) => question), ['Are you currently located in Russia or Belarus?']);
  });

  test('every answer the saved one («No» is «Нет»): «Да»', async () => {
    const compared = await compareReusedAnswers(offer('Are you currently located in Russia or Belarus?: No\nHow would you rate your English level?: B2 or higher'), answersFor);
    assert.equal(compared.decision, 'yes');
    assert.equal(reuseOption(compared.decision, options), 'Да. Используем те же ответы');
  });

  test('an answer that differs: «Нет», and the log says which', async () => {
    const compared = await compareReusedAnswers(offer('Are you currently located in Russia or Belarus?: Yes\nHow would you rate your English level?: B2 or higher'), answersFor);
    assert.equal(compared.decision, 'no');
    assert.equal(reuseOption(compared.decision, options), 'Нет. Отвечу заново');
    assert.match(describeReuse(compared), /✗ Are you currently located in Russia or Belarus\?: Yes \(saved: Нет\)/);
  });

  test('a question not saved word for word: the user decides', async () => {
    const compared = await compareReusedAnswers(offer('Are you currently located in Russia or Belarus?: No\nDo you have a team?: Yes'), answersFor);
    assert.equal(compared.decision, null);
    assert.equal(reuseOption(compared.decision, options), null);
    assert.match(describeReuse(compared), /\? Do you have a team\?: Yes \(not saved\)/);
  });
});
