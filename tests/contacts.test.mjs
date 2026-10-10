/**
 * Tests for contacts as placeholders in saved answers and the cover letter
 */
import { describe, test, assert } from 'test-anywhere';
import { contractContacts, expandContacts, withContacts } from '../src/contacts.mjs';

const contacts = {
  telegram: '@petr_dev',
  phone: '+79001234567',
  linkedin: 'https://www.linkedin.com/in/petr',
  github: ['github.com/petr', 'github.com/petr-org'],
};

describe('contacts', () => {
  test('placeholders are filled in, a list on separate lines, unknown ones stay', () => {
    assert.equal(expandContacts('Telegram: {{telegram}} ({{phone}})', contacts), 'Telegram: @petr_dev (+79001234567)');
    assert.equal(expandContacts('{{github}}', contacts), 'github.com/petr\ngithub.com/petr-org');
    assert.equal(expandContacts('{{skype}}', contacts), '{{skype}}');
  });

  test('contact values in a new answer become placeholders', () => {
    assert.equal(contractContacts('Пишите в @petr_dev или +79001234567', contacts), 'Пишите в {{telegram}} или {{phone}}');
  });

  test('the phone as people write it (and as prefilled forms type it) becomes a placeholder too', () => {
    assert.equal(contractContacts('Петр, +7 900 123-45-67, Telegram: @petr_dev', contacts), 'Петр, {{phone}}, Telegram: {{telegram}}');
    assert.equal(contractContacts('+7 (900) 123 45 67', contacts), '{{phone}}');
    // Not a part of a longer number
    assert.equal(contractContacts('ИНН 179001234567', contacts), 'ИНН 179001234567');
  });

  test('the database reads filled in and keeps templates on writing', async () => {
    const stored = new Map([['Ваш телеграм?', 'Telegram: {{telegram}}']]);
    const writes = [];
    const db = withContacts({
      readQADatabase: async () => stored,
      addOrUpdateQA: async (question, answer) => writes.push([question, answer]),
    }, contacts);
    assert.equal((await db.readQADatabase()).get('Ваш телеграм?'), 'Telegram: @petr_dev');
    // The same answer read back from the page does not overwrite the template
    await db.addOrUpdateQA('Ваш телеграм?', 'Telegram: @petr_dev');
    assert.deepEqual(writes, []);
    await db.addOrUpdateQA('Ваш LinkedIn?', 'https://www.linkedin.com/in/petr');
    assert.deepEqual(writes, [['Ваш LinkedIn?', '{{linkedin}}']]);
  });
});
