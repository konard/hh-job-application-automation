/**
 * Unit tests for fuzzy matching helper functions
 * Issue #74: Comprehensive coverage of all fuzzy matching algorithms
 */
import { describe, test, assert } from 'test-anywhere';
import {
  levenshteinDistance,
  stringSimilarity,
  normalizeQuestion,
  extractKeywords,
  keywordSimilarity,
} from '../src/qa-database.mjs';

describe('Levenshtein Distance', () => {

  test('Identical strings have distance 0', () => {
    assert.equal(levenshteinDistance('hello', 'hello'), 0);
    assert.equal(levenshteinDistance('', ''), 0);
    assert.equal(levenshteinDistance('тест', 'тест'), 0);
  });

  test('One empty string', () => {
    assert.equal(levenshteinDistance('hello', ''), 5);
    assert.equal(levenshteinDistance('', 'hello'), 5);
  });

  test('Single character difference', () => {
    assert.equal(levenshteinDistance('cat', 'bat'), 1);
    assert.equal(levenshteinDistance('hello', 'hallo'), 1);
  });

  test('Insertion distance', () => {
    assert.equal(levenshteinDistance('cat', 'cats'), 1);
    assert.equal(levenshteinDistance('hello', 'helllo'), 1);
  });

  test('Deletion distance', () => {
    assert.equal(levenshteinDistance('cats', 'cat'), 1);
    assert.equal(levenshteinDistance('helllo', 'hello'), 1);
  });

  test('Multiple operations', () => {
    assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
    assert.equal(levenshteinDistance('saturday', 'sunday'), 3);
  });

  test('Russian strings', () => {
    assert.equal(levenshteinDistance('привет', 'привет'), 0);
    assert.equal(levenshteinDistance('зарплата', 'зарплатный'), 3);
  });

  test('Completely different strings', () => {
    const dist = levenshteinDistance('abc', 'xyz');
    assert.equal(dist, 3);
  });

  test('Case sensitive', () => {
    const dist = levenshteinDistance('Hello', 'hello');
    assert.equal(dist, 1); // H vs h
  });

});

describe('String Similarity', () => {

  test('Identical strings have similarity 1.0', () => {
    assert.equal(stringSimilarity('hello', 'hello'), 1.0);
    assert.equal(stringSimilarity('тест', 'тест'), 1.0);
  });

  test('Empty strings have similarity 1.0', () => {
    assert.equal(stringSimilarity('', ''), 1.0);
  });

  test('One empty string has similarity 0', () => {
    assert.equal(stringSimilarity('hello', ''), 0);
    assert.equal(stringSimilarity('', 'hello'), 0);
  });

  test('Similar strings have high similarity', () => {
    const sim = stringSimilarity('hello', 'hallo');
    assert.ok(sim >= 0.8, `Expected similarity >= 0.8, got ${sim}`);
  });

  test('Different strings have low similarity', () => {
    const sim = stringSimilarity('abc', 'xyz');
    assert.ok(sim < 0.2, `Expected similarity < 0.2, got ${sim}`);
  });

  test('Similarity is between 0 and 1', () => {
    const sim = stringSimilarity('test', 'toast');
    assert.ok(sim >= 0 && sim <= 1, `Similarity should be 0-1, got ${sim}`);
  });

  test('Similarity is symmetric', () => {
    const sim1 = stringSimilarity('abc', 'xyz');
    const sim2 = stringSimilarity('xyz', 'abc');
    assert.equal(sim1, sim2);
  });

  test('Russian strings similarity', () => {
    const sim = stringSimilarity('зарплата', 'зарплатный');
    assert.ok(sim > 0.5, `Expected similarity > 0.5 for related Russian words, got ${sim}`);
  });

});

describe('Normalize Question', () => {

  test('Convert to lowercase', () => {
    assert.equal(normalizeQuestion('Hello World'), 'hello world');
    assert.equal(normalizeQuestion('ПРИВЕТ МИР'), 'привет мир');
  });

  test('Remove punctuation', () => {
    assert.equal(normalizeQuestion('Hello, World!'), 'hello world');
    assert.equal(normalizeQuestion('Что? Как!'), 'что как');
    assert.equal(normalizeQuestion('Test;test:test.'), 'testtesttest');
  });

  test('Normalize whitespace', () => {
    assert.equal(normalizeQuestion('hello   world'), 'hello world');
    assert.equal(normalizeQuestion('  hello  world  '), 'hello world');
    assert.equal(normalizeQuestion('hello\t\nworld'), 'hello world');
  });

  test('Trim whitespace', () => {
    assert.equal(normalizeQuestion('  hello  '), 'hello');
    assert.equal(normalizeQuestion('hello'), 'hello');
  });

  test('Empty string', () => {
    assert.equal(normalizeQuestion(''), '');
    assert.equal(normalizeQuestion('   '), '');
  });

  test('Only punctuation', () => {
    assert.equal(normalizeQuestion('.,!?;:'), '');
  });

  test('Combined normalization', () => {
    assert.equal(
      normalizeQuestion('  Hello,   World!!!  '),
      'hello world',
    );
    assert.equal(
      normalizeQuestion('Укажите, пожалуйста, свои зарплатные ожидания'),
      'укажите пожалуйста свои зарплатные ожидания',
    );
  });

});

describe('Extract Keywords', () => {

  test('Extract basic keywords', () => {
    const keywords = extractKeywords('Укажите ваши ожидания по заработной плате');
    assert.ok(keywords.has('укажите'));
    assert.ok(keywords.has('ожидания') || keywords.has('ожида')); // stem
    assert.ok(keywords.has('заработной') || keywords.has('зараб')); // stem
    assert.ok(keywords.has('плате'));
  });

  test('Filter out stopwords', () => {
    const keywords = extractKeywords('Укажите ваши ожидания по заработной плате');
    assert.ok(!keywords.has('ваши'), 'Should filter out stopword "ваши"');
    assert.ok(!keywords.has('по'), 'Should filter out stopword "по"');
  });

  test('Filter out short words', () => {
    const keywords = extractKeywords('Я в от то');
    // All words are either stopwords or too short (<=2 chars)
    // Should only have very few or no keywords
    assert.ok(keywords.size <= 2, `Expected few keywords, got ${keywords.size}`);
  });

  test('Handle punctuation', () => {
    const keywords = extractKeywords('Укажите, пожалуйста, свои зарплатные ожидания!');
    assert.ok(keywords.has('укажите'));
    assert.ok(keywords.has('зарплатные') || keywords.has('зарпл')); // stem
    assert.ok(keywords.has('ожидания') || keywords.has('ожида')); // stem
    assert.ok(!keywords.has('пожалуйста'), 'Should filter stopword');
  });

  test('Empty string returns empty set', () => {
    const keywords = extractKeywords('');
    assert.equal(keywords.size, 0);
  });

  test('Only stopwords returns empty or minimal set', () => {
    const keywords = extractKeywords('пожалуйста свои ваши');
    // All are stopwords, should be filtered out
    assert.ok(keywords.size <= 1, `Expected 0-1 keywords, got ${keywords.size}`);
  });

  test('Generate word stems', () => {
    const keywords = extractKeywords('заработной');
    // Should include both the word and its stem
    assert.ok(keywords.has('заработной'));
    // For words longer than 6 chars, should have a 5-char stem
    assert.ok(keywords.has('зараб'));
  });

  test('Case insensitive', () => {
    const keywords1 = extractKeywords('Зарплата');
    const keywords2 = extractKeywords('зарплата');
    // Both should produce same keywords (case normalized)
    assert.ok(keywords1.has('зарплата'));
    assert.ok(keywords2.has('зарплата'));
  });

  test('Multiple spaces handled', () => {
    const keywords = extractKeywords('Укажите   ваши   ожидания');
    assert.ok(keywords.has('укажите'));
    assert.ok(keywords.has('ожидания') || keywords.has('ожида'));
  });

});

describe('Keyword Similarity', () => {

  test('Identical questions have similarity 1.0', () => {
    const sim = keywordSimilarity(
      'Укажите ваши ожидания по заработной плате',
      'Укажите ваши ожидания по заработной плате',
    );
    assert.equal(sim, 1.0);
  });

  test('Similar salary questions have high similarity', () => {
    const sim = keywordSimilarity(
      'Укажите ваши ожидания по заработной плате',
      'Укажите свои зарплатные ожидания',
    );
    assert.ok(sim > 0.3, `Expected similarity > 0.3, got ${sim}`);
  });

  test('Different questions have low similarity', () => {
    const sim = keywordSimilarity(
      'Укажите ваши ожидания по заработной плате',
      'Территориально где находишься',
    );
    assert.ok(sim < 0.3, `Expected similarity < 0.3, got ${sim}`);
  });

  test('Empty questions return 1.0', () => {
    const sim = keywordSimilarity('', '');
    assert.equal(sim, 1.0);
  });

  test('One empty question returns 0', () => {
    const sim1 = keywordSimilarity('hello', '');
    const sim2 = keywordSimilarity('', 'hello');
    assert.equal(sim1, 0);
    assert.equal(sim2, 0);
  });

  test('Only stopwords questions', () => {
    const sim = keywordSimilarity('пожалуйста свои ваши', 'от до в на');
    // Both questions contain only stopwords, so both have empty/minimal keyword sets
    // Should return 1.0 (both empty) or some reasonable value
    assert.ok(sim >= 0, 'Similarity should be >= 0');
    assert.ok(sim <= 1, 'Similarity should be <= 1');
  });

  test('Similarity is symmetric', () => {
    const sim1 = keywordSimilarity('Зарплата ожидания', 'Ожидания зарплата');
    const sim2 = keywordSimilarity('Ожидания зарплата', 'Зарплата ожидания');
    assert.equal(sim1, sim2);
  });

  test('Similarity between 0 and 1', () => {
    const sim = keywordSimilarity(
      'Какая зарплата',
      'Территориально где находишься',
    );
    assert.ok(sim >= 0 && sim <= 1, `Similarity should be 0-1, got ${sim}`);
  });

  test('Word order does not matter', () => {
    const sim1 = keywordSimilarity('зарплата ожидания', 'ожидания зарплата');
    // Same keywords, different order - should have high similarity
    assert.ok(sim1 > 0.8, `Expected high similarity for same keywords, got ${sim1}`);
  });

  test('Case insensitive comparison', () => {
    const sim1 = keywordSimilarity('Зарплата Ожидания', 'зарплата ожидания');
    const sim2 = keywordSimilarity('зарплата ожидания', 'зарплата ожидания');
    assert.equal(sim1, sim2);
  });

  test('Punctuation does not affect similarity', () => {
    const sim1 = keywordSimilarity('Зарплата, ожидания!', 'Зарплата ожидания');
    const sim2 = keywordSimilarity('Зарплата ожидания', 'Зарплата ожидания');
    assert.equal(sim1, sim2);
  });

  test('Stems increase similarity', () => {
    // Words with same root should have higher similarity
    const sim = keywordSimilarity('зарплатный', 'зарплата');
    // Both should extract "зарпл" stem
    assert.ok(sim > 0, `Expected some similarity due to stem matching, got ${sim}`);
  });

  test('Partial overlap', () => {
    const sim = keywordSimilarity(
      'Укажите зарплату пожалуйста',
      'Укажите территорию пожалуйста',
    );
    // "Укажите" should match, "зарплату" vs "территорию" won't
    // "пожалуйста" is a stopword
    assert.ok(sim > 0 && sim < 1, `Expected partial similarity, got ${sim}`);
  });

});
