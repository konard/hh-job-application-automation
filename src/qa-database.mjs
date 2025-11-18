/**
 * Q&A Database module with multiline support
 * Manages reading and writing Q&A pairs from qa.lino file
 * Supports both single-line and multiline questions and answers
 */
import fs from 'fs/promises';
import path from 'path';

const QA_FILE_PATH = path.join(process.cwd(), 'data', 'qa.lino');

// Lock management for preventing concurrent file access
const locks = new Map();

/**
 * Acquires a lock for a given key
 * @param {string} key - The lock key
 * @returns {Promise<void>}
 */
async function acquireLock(key) {
  while (locks.has(key)) {
    // Wait for the current lock to be released
    await locks.get(key);
  }

  // Create a new lock
  let releaseLock;
  const lockPromise = new Promise((resolve) => {
    releaseLock = resolve;
  });

  locks.set(key, lockPromise);

  // Return the release function
  return releaseLock;
}

/**
 * Releases a lock for a given key
 * @param {string} key - The lock key
 * @param {Function} releaseFn - The release function returned by acquireLock
 */
function releaseLock(key, releaseFn) {
  locks.delete(key);
  releaseFn();
}

/**
 * Reads Q&A pairs from qa.lino file
 * Issue #78: Add better error handling and backup recovery to prevent data loss
 * @returns {Promise<Map<string, string>>} Map of questions to answers
 */
export async function readQADatabase() {
  try {
    // Ensure data directory exists
    await fs.mkdir(path.dirname(QA_FILE_PATH), { recursive: true });

    // Try to read the file
    const content = await fs.readFile(QA_FILE_PATH, 'utf8');

    // Parse using custom indentation-based parser
    // Format:
    // - Lines without indentation (or starting at column 0) are questions
    // - Lines starting with exactly 2 spaces are answers
    // - Multiple consecutive lines at same level are joined with newlines
    const qaMap = new Map();
    const lines = content.split('\n');

    let currentQuestion = null;
    let currentAnswer = null;
    let questionLines = [];
    let answerLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Skip empty lines
      if (trimmedLine === '') {
        // Empty line ends current Q&A pair
        if (currentQuestion !== null && currentAnswer !== null) {
          qaMap.set(currentQuestion, currentAnswer);
          currentQuestion = null;
          currentAnswer = null;
          questionLines = [];
          answerLines = [];
        }
        continue;
      }

      // Determine line type by indentation
      const indent = line.length - line.trimStart().length;

      if (indent === 0) {
        // This is a question line
        // Save previous Q&A pair if complete
        if (currentQuestion !== null && currentAnswer !== null) {
          qaMap.set(currentQuestion, currentAnswer);
          // Reset for new Q&A pair
          currentQuestion = null;
          currentAnswer = null;
          questionLines = [];
          answerLines = [];
        }

        // Add to current question
        questionLines.push(trimmedLine);
        currentQuestion = questionLines.join('\n');
      } else if (indent === 2) {
        // This is an answer line
        answerLines.push(trimmedLine);
        currentAnswer = answerLines.join('\n');
      }
      // Lines with other indentation levels are ignored
    }

    // Don't forget the last Q&A pair
    if (currentQuestion !== null && currentAnswer !== null) {
      qaMap.set(currentQuestion, currentAnswer);
    }

    return qaMap;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty map
      return new Map();
    }

    // Issue #78: If parse error occurs, try to recover from backup
    if (error.message && error.message.includes('Parse error')) {
      console.error('Error reading Q&A database:', error);
      console.error('⚠️  Parse error detected! Attempting to recover from backup...');

      try {
        const backupPath = `${QA_FILE_PATH}.backup`;
        const backupContent = await fs.readFile(backupPath, 'utf8');
        const parser = new Parser();
        const links = parser.parse(backupContent);

        const qaMap = new Map();
        for (const link of links) {
          if (link._isFromPathCombination && link.values && link.values.length === 2) {
            const question = extractText(link.values[0]);
            const answer = extractText(link.values[1]);
            if (question && answer) {
              qaMap.set(question, answer);
            }
          }
        }

        console.error('✅ Successfully recovered data from backup!');
        // Restore the corrupted file with the backup
        await fs.copyFile(backupPath, QA_FILE_PATH);
        return qaMap;
      } catch (backupError) {
        console.error('❌ Could not recover from backup:', backupError.message);
        console.error('⚠️  WARNING: Q&A database is corrupted and could not be recovered!');
        console.error(`⚠️  Please manually fix ${QA_FILE_PATH} or restore from backup.`);
        // Return empty map to prevent crashes, but log the issue clearly
        return new Map();
      }
    }

    console.error('Error reading Q&A database:', error);
    return new Map();
  }
}

/**
 * Escapes a string for safe use in links-notation format
 * Issue #78: Quote strings with `:` to preserve literal text
 *   - Without quotes: `Question: text` → treated as key-value structure (parse error)
 *   - With quotes: `"Question: text"` → preserved as literal text
 *
 * Issue #78: Quote ALL strings with `()` to preserve them as literal characters
 *   - Without quotes: `Question (with parens)` → `Question with parens` (parens REMOVED!)
 *   - With quotes: `"Question (with parens)"` → `Question (with parens)` (preserved!)
 *   - This applies to BOTH paired and unpaired parentheses
 *   - See experiments/demonstrate-paired-paren-issue.mjs for proof
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped and quoted string if needed
 */
function escapeForLinksNotation(str) {
  // Check if string needs quoting
  const hasColon = str.includes(':');
  const hasQuotes = str.includes('"') || str.includes("'");
  const hasParens = str.includes('(') || str.includes(')');

  // Issue #78: Quote if has colon or parentheses (to preserve literal text)
  // Note: We quote ALL parentheses, not just unpaired ones, because even
  // paired parentheses get removed by links-notation when unquoted
  const needsQuoting = hasColon || hasQuotes || hasParens;

  if (needsQuoting) {
    // If string contains double quotes, use single quotes to wrap it
    // If string contains single quotes, use double quotes to wrap it
    // If string contains both, use double quotes and escape the inner double quotes
    const hasDoubleQuotes = str.includes('"');
    const hasSingleQuotes = str.includes("'");

    if (hasDoubleQuotes && hasSingleQuotes) {
      // Has both - use double quotes and escape inner double quotes
      const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    } else if (hasDoubleQuotes) {
      // Has double quotes - use single quotes to wrap
      return `'${str}'`;
    } else if (hasSingleQuotes) {
      // Has single quotes - use double quotes to wrap
      return `"${str}"`;
    } else {
      // Has colon or parens - use double quotes
      return `"${str}"`;
    }
  }

  return str;
}

/**
 * Writes Q&A pairs to qa.lino file
 * Issue #78: Properly escape special characters to prevent parse errors and data loss
 * Creates a backup before writing to enable recovery from corruption
 * @param {Map<string, string>} qaMap - Map of questions to answers
 */
export async function writeQADatabase(qaMap) {
  try {
    // Ensure data directory exists
    await fs.mkdir(path.dirname(QA_FILE_PATH), { recursive: true });

    // Create backup of existing file before writing
    try {
      await fs.access(QA_FILE_PATH);
      const backupPath = `${QA_FILE_PATH}.backup`;
      await fs.copyFile(QA_FILE_PATH, backupPath);
    } catch {
      // File doesn't exist yet, no backup needed
    }

    // Format as indented Q&A pairs
    // Support multiline questions and answers
    const lines = [];
    for (const [question, answer] of qaMap.entries()) {
      // Handle multiline questions - each line should be at indent 0
      const questionLines = question.split('\n');
      for (const qLine of questionLines) {
        lines.push(escapeForLinksNotation(qLine));
      }

      // Handle multiline answers - each line should be indented with 2 spaces
      const answerLines = answer.split('\n');
      for (const aLine of answerLines) {
        lines.push(`  ${escapeForLinksNotation(aLine)}`);
      }
    }
    }

    const content = lines.join('\n') + '\n';
    await fs.writeFile(QA_FILE_PATH, content, 'utf8');
  } catch (error) {
    console.error('Error writing Q&A database:', error);
    throw error;
  }
}

/**
 * Adds or updates a Q&A pair in the database
 * Uses file locking to prevent race conditions and data loss
 * @param {string} question - The question
 * @param {string} answer - The answer
 */
export async function addOrUpdateQA(question, answer) {
  const lockKey = 'qa-database';
  const release = await acquireLock(lockKey);

  try {
    const qaMap = await readQADatabase();
    qaMap.set(question, answer);
    await writeQADatabase(qaMap);
  } finally {
    releaseLock(lockKey, release);
  }
}

/**
 * Gets the answer for a given question
 * @param {string} question - The question
 * @returns {Promise<string|null>} The answer, or null if not found
 */
export async function getAnswer(question) {
  const qaMap = await readQADatabase();
  return qaMap.get(question) || null;
}
<<<<<<< HEAD
=======

/**
 * Extracts text from a Link object
 * Handles both simple links and compound links
 * @param {Link} link - The link to extract text from
 * @returns {string} The extracted text
 */
function extractText(link) {
  if (!link) return '';

  // If link has an id and no values, return the id
  if (link.id && (!link.values || link.values.length === 0)) {
    return link.id;
  }

  // If link has values but no id, reconstruct from values
  if (!link.id && link.values && link.values.length > 0) {
    return link.values.map(v => extractText(v)).join(' ');
  }

  // If link has both id and values, prefer id
  if (link.id) {
    return link.id;
  }

  return '';
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(a, b) {
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
export function stringSimilarity(a, b) {
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
export function normalizeQuestion(question) {
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
export function extractKeywords(question) {
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
    // Simple stemming: take first 5 chars for words longer than 6 chars
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
export function keywordSimilarity(a, b) {
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
 * Find the best matching question from a database using fuzzy matching
 * Issue #74: Questions may be phrased differently but mean the same thing
 * @param {string} question - Question to match
 * @param {Map<string, string>} qaDatabase - Q&A database
 * @param {number} threshold - Minimum similarity threshold (0-1), default 0.4
 * @returns {{question: string, answer: string, score: number} | null}
 */
export function findBestMatch(question, qaDatabase, threshold = 0.4) {
  // First try exact match for performance
  if (qaDatabase.has(question)) {
    return { question, answer: qaDatabase.get(question), score: 1.0 };
  }

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

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestMatch = { question: dbQuestion, answer, score: combinedScore };
    }
  }

  return bestMatch;
}
>>>>>>> origin/main
