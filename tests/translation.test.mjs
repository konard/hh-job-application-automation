/**
 * Tests for the translators: batch replies, what counts as a failed translation, combining the
 * three results, and deduplicated Formal AI issue reports
 */
import { describe, test, assert } from 'test-anywhere';
import {
  batchPrompt, batchTexts, buildIssue, combineTranslations, createTranslator, failureKind, formalAiCommand, formalAiPrompt,
  ISSUE_MARKER, isFormalAiFault, issueMatchesFailure, issueSearches, parseBatchReply, reportFormalAiFailures, translationFailure,
} from '../src/translation.mjs';

describe('batches', () => {
  test('the prompt carries the texts as JSON and asks for as many answers', () => {
    const prompt = batchPrompt(['Программист', 'Руководитель'], 'en');
    assert.ok(prompt.includes('from Russian to English'));
    assert.ok(prompt.includes('JSON array of 2 translated strings'));
    assert.ok(prompt.endsWith('["Программист","Руководитель"]'));
  });

  test('a reply is parsed when it holds an array of as many strings', () => {
    assert.deepEqual(parseBatchReply('Sure:\n["Programmer", "Lead"]\n', 2), ['Programmer', 'Lead']);
    assert.equal(parseBatchReply('["Programmer"]', 2), null);
    assert.equal(parseBatchReply('I cannot help', 1), null);
    assert.equal(parseBatchReply('[1, 2]', 2), null);
  });

  test('texts are split by size, a long one alone', () => {
    assert.deepEqual(batchTexts(['aaa', 'bbb', 'cccccccc', 'd'], 6), [['aaa', 'bbb'], ['cccccccc'], ['d']]);
  });
});

describe('failures', () => {
  test('Formal AI gaps, empty and placeholder answers are failures', () => {
    const gap = translationFailure('Программист', 'I could not translate "Программист" from ru to en with the available formalization data. I recorded this as a translation gap for follow-up.', 'en');
    assert.ok(gap.startsWith('not translated'));
    assert.equal(failureKind(gap), 'gap');
    assert.equal(failureKind(gap, 'Ведущий разработчик'), 'short-phrase');
    assert.equal(failureKind(gap, 'Руководство командой из 5-ти старших разработчиков, архитектура и код-ревью.'), 'gap');
    assert.equal(failureKind(translationFailure('Программист', '', 'en')), 'empty');
    assert.equal(failureKind(translationFailure('Программист', 'response:translate', 'en')), 'placeholder');
  });

  test('a web search request instead of a translation is a misroute', () => {
    const reason = translationFailure('Разработка системы.\nПоддержка.', 'Поиск в интернете запрошен для `Translate "Разработка системы."`', 'en');
    assert.equal(failureKind(reason), 'misrouted');
  });

  test('an answer left in the source language is a failure', () => {
    assert.equal(failureKind(translationFailure('Программист', 'Программист', 'en')), 'untranslated');
    assert.equal(failureKind(translationFailure('Руководитель команды', 'Руководитель отдела', 'en')), 'wrong-language');
  });

  test('a real translation is none', () => {
    assert.equal(translationFailure('Программист', '"Programmer"', 'en'), null);
    assert.equal(translationFailure('Team lead', 'Руководитель команды', 'ru'), null);
  });

  test('errors are their own kind', () => {
    assert.equal(failureKind('error: formal-ai failed: timeout'), 'error');
  });

  test('a wrong command line, a timeout or a missing binary is not Formal AI\'s fault', () => {
    assert.equal(isFormalAiFault('error: formal-ai failed: Command failed: formal-ai chat … For more information, try \'--help\'.'), false);
    assert.equal(isFormalAiFault('error: formal-ai failed: spawn formal-ai ENOENT'), false);
    assert.equal(isFormalAiFault('not translated: I could not translate "x"'), true);
  });

  test('failures that are not Formal AI\'s fault are not reported', async () => {
    const gh = async () => {
      throw new Error('gh must not be called');
    };
    const results = await reportFormalAiFailures({ failures: [{ text: 'x', to: 'en', reason: 'error: try \'--help\'', reportable: false }], version: '1', gh });
    assert.deepEqual(results, []);
  });
});

describe('combining', () => {
  test('Haiku first, then Luna, then Formal AI; agreement of the first two', () => {
    const result = combineTranslations([
      { name: 'Haiku', text: 'Head of Development Team' },
      { name: 'Luna', text: 'Development Team Lead' },
      { name: 'Formal AI', text: null, error: 'not translated' },
    ]);
    assert.equal(result.chosen, 'Head of Development Team');
    assert.equal(result.chosenBy, 'Haiku');
    assert.equal(result.agree, true);
  });

  test('a failed translator is passed over', () => {
    const result = combineTranslations([{ name: 'Haiku', text: null, error: 'timeout' }, { name: 'Luna', text: 'Programmer' }]);
    assert.equal(result.chosenBy, 'Luna');
    assert.equal(result.agree, false);
  });

  test('the Formal AI prompt is the quoted form, inner quotes replaced', () => {
    assert.equal(formalAiPrompt('ООО "ЕВИРМА"', 'en'), 'Translate "ООО \'\'ЕВИРМА\'\'" to English');
  });

  test('the Formal AI command is quoted for a shell, line breaks kept', () => {
    assert.equal(formalAiCommand('A\nB', 'ru'), 'FORMAL_AI_LIVE_API=1 formal-ai chat --silent --prompt \'Translate "A\nB" to Russian\'');
    assert.ok(formalAiCommand('it\'s', 'ru').includes('it\'\\\'\'s'));
  });
});

describe('translator', () => {
  test('each translator runs on every text not yet in the target language, and results are cached', async () => {
    const calls = { haiku: 0, luna: 0, formalAi: 0 };
    const engines = {
      haiku: async (texts) => {
        calls.haiku++;
        return texts.map((text) => `H:${text === 'Программист' ? 'Programmer' : 'Lead'}`);
      },
      luna: async (texts) => {
        calls.luna++;
        return texts.map(() => 'Programmer');
      },
      formalAi: async (text) => {
        calls.formalAi++;
        return text === 'Программист' ? 'Programmer' : `I could not translate "${text}" from ru to en with the available formalization data. I recorded this as a translation gap for follow-up.`;
      },
      formalAiVersion: async () => '0.352.1',
    };
    const translator = await createTranslator({ engines });
    await translator.translate(['Программист', 'Руководитель команды', 'Tech Lead'], 'en');
    assert.deepEqual(calls, { haiku: 1, luna: 1, formalAi: 2 });
    // Formal AI first; where it fails, Haiku
    assert.equal(translator.chosen('Программист', 'en'), 'Programmer');
    assert.equal(translator.chosen('Руководитель команды', 'en'), 'H:Lead');
    assert.equal(translator.chosen('Tech Lead', 'en'), 'Tech Lead');
    const variants = translator.variantsOf('Программист', 'en');
    assert.deepEqual(variants.map((variant) => variant.text), ['Programmer', 'H:Programmer', 'Programmer']);
    assert.equal(translator.failures().length, 1);
    assert.equal(translator.failures()[0].text, 'Руководитель команды');
    await translator.translate(['Программист'], 'en');
    assert.deepEqual(calls, { haiku: 1, luna: 1, formalAi: 2 });
  });
});

describe('judging every translator', () => {
  test('a text Haiku returns as is falls through to Luna', async () => {
    const translator = await createTranslator({
      translators: ['haiku', 'luna'],
      engines: { haiku: async (texts) => texts, luna: async () => ['Ассоциативные технологии.'] },
    });
    await translator.translate(['Associative technologies.'], 'ru');
    assert.equal(translator.chosen('Associative technologies.', 'ru'), 'Ассоциативные технологии.');
  });

  test('Formal AI keeping a text every translator keeps is not reported', async () => {
    const translator = await createTranslator({
      engines: { haiku: async (texts) => texts, luna: async (texts) => texts, formalAi: async (text) => text, formalAiVersion: async () => '1' },
    });
    await translator.translate(['Tech Lead'], 'ru');
    assert.equal(translator.failures()[0].reportable, false);
  });
});

describe('Formal AI issues', () => {
  const failure = {
    text: 'Руководство командой разработки из пяти человек', to: 'en', reason: 'not translated: I could not translate "Руководство командой разработки из пяти человек"',
    output: 'I could not translate "Руководство командой разработки из пяти человек" from ru to en with the available formalization data. I recorded this as a translation gap for follow-up.',
    command: 'FORMAL_AI_LIVE_API=1 formal-ai chat --silent --prompt "Translate \\"Руководство командой разработки из пяти человек\\" to English"',
    others: ['Haiku: Head of Development Team'],
  };

  test('an existing issue on sentence translation is the same failure', () => {
    const epic = { title: 'E139: summarization, translation, rewriting … do not work', body: '"Translate to Russian: …" → "I could not identify a source phrase to translate from en to ru."' };
    assert.ok(issueMatchesFailure(epic, 'gap'));
    assert.ok(!issueMatchesFailure(epic, 'placeholder'));
    assert.ok(issueMatchesFailure({ title: 'x', body: `<!-- ${ISSUE_MARKER} kind=placeholder version=1 -->` }, 'placeholder'));
  });

  test('searches look for this tool\'s marker first', () => {
    assert.equal(issueSearches('gap')[0], `"${ISSUE_MARKER} kind=gap"`);
  });

  test('a new issue has the version, the exact input, the command, the output and the expected behavior', () => {
    const { title, body } = buildIssue({ kind: 'gap', version: '0.352.1', failures: [failure] });
    assert.ok(title.includes('formal-ai 0.352.1'));
    assert.ok(body.includes('Руководство командой разработки из пяти человек'));
    assert.ok(body.includes('FORMAL_AI_LIVE_API=1 formal-ai chat'));
    assert.ok(body.includes('### Expected behavior'));
    assert.ok(body.includes('Haiku: Head of Development Team'));
    assert.ok(body.includes(`${ISSUE_MARKER} kind=gap version=0.352.1`));
  });

  const fakeGh = (issues, comments = []) => {
    const calls = [];
    const gh = async (args) => {
      calls.push(args);
      if (args[1] === 'list') {
        return JSON.stringify(issues);
      }
      if (args[1] === 'view') {
        return JSON.stringify({ comments });
      }
      return args[1] === 'create' ? 'https://github.com/link-assistant/formal-ai/issues/9999\n' : 'https://github.com/link-assistant/formal-ai/issues/1174#issuecomment-1\n';
    };
    return { gh, calls };
  };

  test('an open issue on the failure gets one comment per version instead of a duplicate', async () => {
    const open = { number: 1174, title: 'translation does not work', body: 'I could not identify a source phrase', state: 'OPEN', url: 'https://github.com/link-assistant/formal-ai/issues/1174' };
    const { gh, calls } = fakeGh([open]);
    const results = await reportFormalAiFailures({ failures: [failure], version: '0.352.1', gh });
    assert.deepEqual(results.map((result) => result.action), ['commented']);
    assert.ok(!calls.some((args) => args[1] === 'create'));

    const again = fakeGh([open], [{ body: `<!-- ${ISSUE_MARKER} kind=gap version=0.352.1 -->` }]);
    const second = await reportFormalAiFailures({ failures: [failure], version: '0.352.1', gh: again.gh });
    assert.equal(second[0].action, 'already reported for 0.352.1');
    assert.ok(!again.calls.some((args) => args[1] === 'comment' || args[1] === 'create'));
  });

  test('two kinds of failure on one open issue share one comment', async () => {
    const open = { number: 1174, title: 'translation does not work', body: 'I could not identify a source phrase; Web search requested for …', state: 'OPEN', url: 'https://github.com/link-assistant/formal-ai/issues/1174' };
    const { gh, calls } = fakeGh([open]);
    const misrouted = { ...failure, text: 'Разработка.\nПоддержка.', reason: 'misrouted to a web search: Поиск в интернете запрошен' };
    const results = await reportFormalAiFailures({ failures: [failure, misrouted], version: '0.352.1', gh });
    assert.deepEqual(results.map((result) => `${result.kind} ${result.action}`).sort(), ['gap commented', 'misrouted commented']);
    const comments = calls.filter((args) => args[1] === 'comment');
    assert.equal(comments.length, 1);
    const body = comments[0][comments[0].indexOf('--body') + 1];
    assert.ok(body.includes('kind=gap version=0.352.1') && body.includes('kind=misrouted version=0.352.1'));
  });

  test('without an open issue a new one is filed; a closed one is named as a regression', async () => {
    const closed = { number: 218, title: 'Translation issues', body: 'translation gap', state: 'CLOSED', url: 'u' };
    const { gh, calls } = fakeGh([closed]);
    const results = await reportFormalAiFailures({ failures: [failure], version: '0.352.1', gh });
    assert.equal(results[0].action, 'filed');
    const create = calls.find((args) => args[1] === 'create');
    assert.ok(create[create.indexOf('--body') + 1].includes('regression of #218'));
  });

  test('a dry run files nothing', async () => {
    const { gh, calls } = fakeGh([]);
    const results = await reportFormalAiFailures({ failures: [failure], version: '0.352.1', gh, dryRun: true });
    assert.equal(results[0].action, 'would file');
    assert.ok(!calls.some((args) => args[1] === 'create' || args[1] === 'comment'));
  });
});
