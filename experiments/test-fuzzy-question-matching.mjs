/**
 * Experiment to test fuzzy question matching algorithm
 * Issue #74: Saved questions are not filled on vacancy response page form
 *
 * The problem is that questions in the database might be phrased differently
 * than on the form, but they mean the same thing.
 *
 * Example:
 * - Form: "Укажите, пожалуйста, свои зарплатные ожидания"
 * - Database: "Укажите ваши ожидания по заработной плате"
 *
 * We need fuzzy matching to handle these variations.
 */

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  const matrix = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1,      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1, where 1 is identical)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score
 */
function stringSimilarity(a, b) {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLength;
}

/**
 * Normalize a question string for comparison
 * @param {string} question - Question to normalize
 * @returns {string} Normalized question
 */
function normalizeQuestion(question) {
  return question
    .toLowerCase()
    .replace(/[.,!?;:]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim();
}

/**
 * Extract key words from a question
 * @param {string} question - Question string
 * @returns {Set<string>} Set of key words
 */
function extractKeywords(question) {
  // Common stopwords in Russian that don't carry much meaning
  const stopwords = new Set([
    'пожалуйста', 'свои', 'ваши', 'от', 'до', 'в', 'на', 'с', 'по',
    'о', 'об', 'и', 'а', 'но', 'или', 'то', 'как', 'что', 'это',
    'вы', 'ты', 'он', 'она', 'они', 'мы', 'я', 'к', 'для', 'при',
    'чуть', 'данный', 'момент',
  ]);

  const normalized = normalizeQuestion(question);
  const words = normalized.split(/\s+/);

  const keywords = new Set(
    words.filter(word => word.length > 2 && !stopwords.has(word)),
  );

  // Also extract word stems/roots for better matching
  // For example: "ожидания" -> "ожидан", "зарплатные" -> "зарплат"
  const stems = new Set();
  for (const word of keywords) {
    // Simple stemming: take first 5-6 chars for words longer than 6 chars
    if (word.length > 6) {
      stems.add(word.substring(0, 5));
    }
  }

  return new Set([...keywords, ...stems]);
}

/**
 * Calculate keyword overlap similarity
 * @param {string} a - First question
 * @param {string} b - Second question
 * @returns {number} Similarity score (0-1)
 */
function keywordSimilarity(a, b) {
  const keywordsA = extractKeywords(a);
  const keywordsB = extractKeywords(b);

  if (keywordsA.size === 0 && keywordsB.size === 0) return 1.0;
  if (keywordsA.size === 0 || keywordsB.size === 0) return 0.0;

  // Calculate Jaccard similarity
  const intersection = new Set([...keywordsA].filter(x => keywordsB.has(x)));
  const union = new Set([...keywordsA, ...keywordsB]);

  return intersection.size / union.size;
}

/**
 * Find the best matching question from a database
 * @param {string} question - Question to match
 * @param {Map<string, string>} qaDatabase - Q&A database
 * @param {number} threshold - Minimum similarity threshold (0-1)
 * @param {boolean} debug - Enable debug output
 * @returns {{question: string, answer: string, score: number} | null}
 */
function findBestMatch(question, qaDatabase, threshold = 0.6, debug = false) {
  let bestMatch = null;
  let bestScore = threshold;

  for (const [dbQuestion, answer] of qaDatabase.entries()) {
    // Calculate combined similarity score
    const editSimilarity = stringSimilarity(
      normalizeQuestion(question),
      normalizeQuestion(dbQuestion),
    );
    const kwSimilarity = keywordSimilarity(question, dbQuestion);

    // Weight keyword similarity more heavily as it's more semantic
    // But also give some weight to edit distance for exact matches
    const combinedScore = (editSimilarity * 0.4) + (kwSimilarity * 0.6);

    if (debug) {
      console.log(`    vs "${dbQuestion.substring(0, 50)}..."`);
      console.log(`      Edit: ${editSimilarity.toFixed(3)}, Keyword: ${kwSimilarity.toFixed(3)}, Combined: ${combinedScore.toFixed(3)}`);
    }

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestMatch = { question: dbQuestion, answer, score: combinedScore };
    }
  }

  return bestMatch;
}

// Test cases
console.log('Testing fuzzy question matching algorithm\n');

// Create a test Q&A database
const qaDatabase = new Map([
  ['Укажите ваши ожидания по заработной плате', 'От 450000 рублей в месяц на руки.'],
  ['Укажите размер заработной платы, от которого вы рассматриваете предложения.', 'От 450000 рублей в месяц на руки.'],
  ['От какой суммы сейчас отталкиваешься на руки ?', 'От 450000 рублей в месяц на руки.'],
  ['Расскажи чуть детальнее о проекте, пожалуйста.', 'Детальнее не получится, NDA.'],
  ['Территориально где находишься на данный момент?', 'В Гоа, в Индии.'],
]);

// Test question from issue #74
const testQuestions = [
  'Укажите, пожалуйста, свои зарплатные ожидания',
  'Какая у вас зарплата?',
  'Расскажи о проекте',
  'Где вы находитесь?',
  'Территориально где ты?',
  'Совершенно не связанный вопрос о чем-то другом',
];

console.log('Q&A Database:');
for (const [q, a] of qaDatabase.entries()) {
  console.log(`  Q: ${q}`);
  console.log(`  A: ${a}\n`);
}

console.log('\nTesting matching:\n');

for (const question of testQuestions) {
  console.log(`Question: "${question}"`);
  const match = findBestMatch(question, qaDatabase, 0.4, true);

  if (match) {
    console.log(`  ✅ Match found (score: ${match.score.toFixed(3)})`);
    console.log(`  Matched Q: ${match.question}`);
    console.log(`  Answer: ${match.answer}`);
  } else {
    console.log('  ❌ No match found');
  }
  console.log();
}

// Export functions for use in other modules
export {
  levenshteinDistance,
  stringSimilarity,
  normalizeQuestion,
  extractKeywords,
  keywordSimilarity,
  findBestMatch,
};
