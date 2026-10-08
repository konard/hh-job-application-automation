/**
 * Q&A Database module using Links Notation parser
 * Manages reading and writing Q&A pairs from qa.lino file
 *
 * IMPORTANT: This module REQUIRES explicit file path configuration!
 * Use createQADatabase(filePath) to create an instance.
 *
 * ============================================================================
 * LINKS NOTATION FORMAT - Multiline Support
 * ============================================================================
 *
 * Links Notation NATIVELY supports multiline strings through indentation:
 *
 * Format:
 *   Question (no indentation)
 *     Answer line 1 (2 spaces)
 *     Answer line 2 (2 spaces)
 *     Answer line 3 (2 spaces)
 *
 * Key Features:
 * - Questions are NOT indented (0 spaces)
 * - Answers are indented with exactly 2 spaces
 * - Multiline answers: EVERY line must have 2-space indentation
 * - Newlines are preserved NATURALLY - DO NOT use \n escaping!
 * - Only quote characters (") need escaping if present in content
 *
 * Example:
 *   What is your experience?
 *     I have worked with:
 *     - JavaScript for 5 years
 *     - Python for 3 years
 *
 * This format preserves multiline content without any special escape sequences.
 * ============================================================================
 */
import { Parser } from 'links-notation';
import fs from 'fs/promises';
import path from 'path';
import { createMutex } from './helpers/mutex.mjs';

/**
 * Creates a Q&A database instance with the specified file path
 * @param {string} filePath - REQUIRED: Path to the qa.lino file
 * @returns {Object} Q&A database instance with methods
 * @throws {Error} If filePath is not provided
 */
export function createQADatabase(filePath) {
  if (!filePath) {
    throw new Error(
      'CRITICAL: QA Database file path is REQUIRED!\n' +
      'Usage: createQADatabase("/path/to/qa.lino")\n' +
      'This prevents accidental usage without explicit path configuration.',
    );
  }

  const QA_FILE_PATH = filePath;

  const exclusive = createMutex();

  /**
   * Reads Q&A pairs from qa.lino file
   *
   * IMPORTANT: Links Notation multiline indented format:
   * - Each indented line creates a SEPARATE link with the same question
   * - Multiple short answers (< 150 chars, unquoted) are kept as array (checkbox options)
   * - Multiple long/quoted answers are combined with newlines (multiline text)
   * - Example file format:
   *     Question
   *       Answer line 1
   *       Answer line 2
   *   Becomes 3 separate links in parser, we combine into 1 Q&A pair
   *
   * @returns {Promise<Map<string, string|Array<string>>>} Map of questions to answers
   */
  async function readQADatabase() {
    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(QA_FILE_PATH), { recursive: true });

      // Try to read the file
      const content = await fs.readFile(QA_FILE_PATH, 'utf8');

      // Parse using Links Notation
      const parser = new Parser();
      const links = parser.parse(content);

      // Extract Q&A pairs from parsed links
      // Note: Multiple indented answer lines create multiple links with same question
      // Strategy:
      // - If answers look like separate options (short, no internal newlines), keep as array
      // - Otherwise, treat as multiline text and concatenate with newlines
      const qaMap = new Map();
      const answersByQuestion = new Map(); // Temporary: collect all answers per question

      for (const link of links) {
        if (link._isFromPathCombination && link.values && link.values.length === 2) {
          const question = extractText(link.values[0]);
          const answer = extractText(link.values[1]);

          if (question && answer) {
            if (!answersByQuestion.has(question)) {
              answersByQuestion.set(question, []);
            }
            answersByQuestion.get(question).push(answer);
          }
        }
      }

      // Process collected answers
      for (const [question, answers] of answersByQuestion.entries()) {
        if (answers.length === 1) {
          // Single answer - store as-is
          qaMap.set(question, answers[0]);
        } else {
          // Multiple answers - check if they're checkbox options or multiline text
          // Heuristic: if all answers are short (< 150 chars) and have no quotes, likely checkboxes
          const allShort = answers.every(a => a.length < 150);
          const anyQuoted = answers.some(a =>
            (a.startsWith('"') && a.endsWith('"')) ||
            (a.startsWith("'") && a.endsWith("'")),
          );

          if (allShort && !anyQuoted) {
            // Likely checkbox options - store as array (join with special delimiter)
            qaMap.set(question, answers);
          } else {
            // Multiline text - concatenate with newlines
            qaMap.set(question, answers.join('\n'));
          }
        }
      }

      return qaMap;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, return empty map
        return new Map();
      }

      console.error('Error reading Q&A database:', error);
      return new Map();
    }
  }

  /**
   * Escapes a link reference for safe use in Links Notation format
   *
   * IMPORTANT: Link references cannot contain certain characters unquoted:
   * - Newlines (\n) - must be quoted to preserve as single reference
   * - Quotes (" or ') - must be wrapped and escaped
   * - Colons (:) - delimiter for self-reference, must be quoted in content
   * - Parentheses (()) - borders of nested links, must be quoted in content
   *
   * Simple quoting rules:
   *   - Has " but not ' → wrap with '...'
   *   - Has ' but not " → wrap with "..."
   *   - Has both " and ' → wrap with "..." and use "" to escape "
   *   - Has colon/parens/newlines but no quotes → wrap with "..."
   *
   * Issue #78: Quote strings with special chars to preserve literal text
   * @param {string} str - String to format (preserves newlines as-is)
   * @returns {string} Escaped link reference (may be quoted if needed)
   */
  function escapeReference(str) {
    // Check for characters that need quoting
    const hasColon = str.includes(':');
    const hasDoubleQuotes = str.includes('"');
    const hasSingleQuotes = str.includes("'");
    const hasParens = str.includes('(') || str.includes(')');
    const hasNewline = str.includes('\n');

    const needsQuoting = hasColon || hasDoubleQuotes || hasSingleQuotes || hasParens || hasNewline;

    if (needsQuoting) {
      if (hasDoubleQuotes && !hasSingleQuotes) {
        // Has " but not ' → use single quotes
        return `'${str}'`;
      } else if (hasSingleQuotes && !hasDoubleQuotes) {
        // Has ' but not " → use double quotes
        return `"${str}"`;
      } else if (hasDoubleQuotes && hasSingleQuotes) {
        // Has both " and ' → choose the wrapper with fewer escapes needed
        const doubleQuoteCount = (str.match(/"/g) || []).length;
        const singleQuoteCount = (str.match(/'/g) || []).length;

        if (singleQuoteCount < doubleQuoteCount) {
          // Fewer single quotes → wrap with " and escape ' as ''
          const escaped = str.replace(/'/g, "''");
          return `"${escaped}"`;
        } else {
          // Fewer or equal double quotes → wrap with ' and escape " as ""
          const escaped = str.replace(/"/g, '""');
          return `'${escaped}'`;
        }
      } else {
        // Has colon, parentheses, or newlines but no quotes → use double quotes
        return `"${str}"`;
      }
    }

    // No special characters - no quoting needed
    return str;
  }

  /**
   * Writes Q&A pairs to qa.lino file
   *
   * IMPORTANT: Links Notation multiline format:
   * - Questions are not indented
   * - Answers are indented with 2 spaces
   * - If answer contains newlines, EVERY line must be indented with 2 spaces
   * - If answer is an array (checkboxes), each option on separate indented line
   * - This preserves multiline content naturally without \n escaping
   *
   * Optimization: Skips writing if content is unchanged (no IO)
   *
   * @param {Map<string, string|Array<string>>} qaMap - Map of questions to answers (string or array)
   */
  async function writeQADatabase(qaMap) {
    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(QA_FILE_PATH), { recursive: true });

      // Format as indented Q&A pairs with proper multiline handling
      const lines = [];
      for (const [question, answer] of qaMap.entries()) {
        // Question handling: escapeReference handles all cases including multiline
        const escapedQuestion = escapeReference(question);
        lines.push(escapedQuestion);

        // Answer handling:
        // - If answer is an array (checkbox options), write each on separate line
        // - If answer is quoted string, write as single quoted multiline
        // - Otherwise, split by newlines and indent each line with 2 spaces
        if (Array.isArray(answer)) {
          // Array of checkbox options - each on separate line
          for (const option of answer) {
            const escapedOption = escapeReference(option);
            lines.push(`  ${escapedOption}`);
          }
        } else {
          const escapedAnswer = escapeReference(answer);
          const isQuoted = escapedAnswer.startsWith('"') || escapedAnswer.startsWith("'");

          if (isQuoted) {
            // Quoted answer - write as-is with 2-space indent (quotes preserve newlines)
            lines.push(`  ${escapedAnswer}`);
          } else {
            // Unquoted answer - split by newlines and indent each line
            const answerLines = escapedAnswer.split('\n');
            for (const answerLine of answerLines) {
              lines.push(`  ${answerLine}`);
            }
          }
        }
      }

      const newContent = lines.join('\n') + '\n';

      // Check if content has changed - skip write if identical (optimization)
      let existingContent = '';
      try {
        existingContent = await fs.readFile(QA_FILE_PATH, 'utf8');
      } catch {
        // File doesn't exist yet, will be created
      }

      if (existingContent === newContent) {
        // No changes - skip write operation
        return;
      }

      // Write new content
      await fs.writeFile(QA_FILE_PATH, newContent, 'utf8');
    } catch (error) {
      console.error('Error writing Q&A database:', error);
      throw error;
    }
  }

  /**
   * Adds or updates a Q&A pair in the database
   * Uses file locking to prevent race conditions
   * @param {string} question - The question
   * @param {string} answer - The answer
   */
  function addOrUpdateQA(question, answer) {
    return exclusive(async () => {
      const qaMap = await readQADatabase();
      qaMap.set(question, answer);
      await writeQADatabase(qaMap);
    });
  }

  /**
   * Gets the answer for a given question
   * @param {string} question - The question
   * @returns {Promise<string|null>} The answer, or null if not found
   */
  async function getAnswer(question) {
    const qaMap = await readQADatabase();
    return qaMap.get(question) || null;
  }

  /**
   * Unescapes a link reference from Links Notation format
   *
   * IMPORTANT: Links Notation naturally preserves newlines!
   * - Multiline content is already in the string as actual newlines
   * - Unescape doubled quotes: "" → " and '' → '
   * - DO NOT process \n sequences - they should not exist in properly formatted files
   *
   * @param {string} str - Link reference to unescape (already contains real newlines)
   * @returns {string} Unescaped link reference (only quotes unescaped)
   */
  function unescapeReference(str) {
    if (!str) return str;

    // Unescape doubled quotes (Links Notation escape sequences)
    let unescaped = str.replace(/""/g, '"');  // "" → "
    unescaped = unescaped.replace(/''/g, "'"); // '' → '

    return unescaped;
  }

  /**
   * Extracts text from a Link object
   *
   * IMPORTANT: Links Notation multiline support:
   * - Quoted multiline: "text\nline2" - parser preserves actual newlines in .id
   * - Indented multiline: Parser concatenates all indented lines into word tokens
   *   We join word tokens with spaces (parser handles line boundaries internally)
   *
   * @param {Object} link - The link to extract text from
   * @returns {string} The extracted text (with actual newlines if quoted, spaces if indented)
   */
  function extractText(link) {
    if (!link) return '';

    let text = '';

    if (link.id && (!link.values || link.values.length === 0)) {
      // Single value with .id (might contain actual newlines if quoted)
      text = link.id;
    } else if (!link.id && link.values && link.values.length > 0) {
      // Multiple word tokens - join with spaces
      // Note: For indented multiline, parser concatenates lines into words
      text = link.values.map(v => extractText(v)).join(' ');
    } else if (link.id) {
      text = link.id;
    }

    // Unescape the text before returning
    return unescapeReference(text);
  }

  // Return the public API
  return {
    readQADatabase,
    writeQADatabase,
    addOrUpdateQA,
    getAnswer,
    filePath: QA_FILE_PATH,
  };
}

// Export utility functions that don't require file path
/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1)
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
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'пожалуйста', 'свои', 'ваши', 'от', 'до', 'в', 'на', 'с', 'по',
  'о', 'об', 'и', 'а', 'но', 'или', 'то', 'как', 'что', 'это',
  'вы', 'ты', 'он', 'она', 'они', 'мы', 'я', 'к', 'для', 'при',
  'чуть', 'данный', 'момент',
]);

/**
 * Extract key words (plus 5-char stems of long words) from a question
 * @param {string} question - Question string
 * @param {Object} [options]
 * @param {boolean} [options.caseSensitive=false] - Preserve case of keywords
 * @returns {Set<string>} Set of key words
 */
export function extractKeywords(question, { caseSensitive = false } = {}) {
  const cleaned = caseSensitive
    ? question.replace(/[.,!?;:]/g, '').replace(/\s+/g, ' ').trim()
    : normalizeQuestion(question);
  const keywords = cleaned
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOPWORDS.has(word.toLowerCase()));
  const stems = keywords.filter(word => word.length > 6).map(word => word.substring(0, 5));
  return new Set([...keywords, ...stems]);
}

/**
 * Calculate keyword overlap (Jaccard) similarity
 * @param {string} a - First question
 * @param {string} b - Second question
 * @param {Object} [options] - Passed to extractKeywords
 * @returns {number} Similarity score (0-1)
 */
export function keywordSimilarity(a, b, options) {
  const keywordsA = extractKeywords(a, options);
  const keywordsB = extractKeywords(b, options);

  if (keywordsA.size === 0 && keywordsB.size === 0) return 1.0;
  if (keywordsA.size === 0 || keywordsB.size === 0) return 0.0;

  const intersection = [...keywordsA].filter(x => keywordsB.has(x));
  const union = new Set([...keywordsA, ...keywordsB]);

  return intersection.length / union.size;
}

// Cyrillic letters that look like Latin ones, as in "С#" typed with a Cyrillic С
const LATIN_LOOKALIKES = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x' };

/**
 * Names a question is about: words with Latin letters, # or + (C#, Go, MongoDB, AWS, Lead, net, $).
 * Two questions about different names need different answers, however similar the wording.
 * @param {string} question
 * @returns {string} Sorted, comma-joined names
 */
export function extractSubjectTerms(question) {
  return [...new Set(question.toLowerCase().split(/[\s,.;:!?()«»"'/]+/)
    .filter((word) => /[a-z#+$]/.test(word))
    .map((word) => word.replace(/[а-яё]/g, (letter) => LATIN_LOOKALIKES[letter] ?? letter)))]
    .sort()
    .join(',');
}

export const extractKeywordsCaseSensitive = (question) => extractKeywords(question, { caseSensitive: true });
export const keywordSimilarityCaseSensitive = (a, b) => keywordSimilarity(a, b, { caseSensitive: true });

/**
 * Find all matching questions from a database using fuzzy matching
 * @param {string} question - Question to match
 * @param {Map<string, string>} qaDatabase - Q&A database
 * @param {Object} options - Matching options
 * @param {number} options.threshold - Minimum similarity threshold (0-1), default 0.4
 * @param {boolean} options.caseSensitive - Whether to use case-sensitive matching, default false
 * @param {boolean} options.returnAll - Return all matches sorted by score (true) or just best match (false), default false
 * @returns {Array<{question: string, answer: string, score: number}>|{question: string, answer: string, score: number}|null}
 */
export function findBestMatch(question, qaDatabase, options = {}) {
  // Handle backward compatibility: if options is a number, treat it as threshold
  const threshold = typeof options === 'number' ? options : (options.threshold ?? 0.4);
  const caseSensitive = typeof options === 'object' ? (options.caseSensitive ?? false) : false;
  const returnAll = typeof options === 'object' ? (options.returnAll ?? false) : false;

  // Normalization function that respects case sensitivity option
  const normalize = (str) => caseSensitive ? str : normalizeQuestion(str);

  // Check for exact match first
  if (qaDatabase.has(question)) {
    const result = { question, answer: qaDatabase.get(question), score: 1.0 };
    return returnAll ? [result] : result;
  }

  const matches = [];
  const subjectTerms = extractSubjectTerms(question);

  for (const [dbQuestion, answer] of qaDatabase.entries()) {
    // "опыт на C#" must not take the answer of "опыт на Go" (threshold 0 still lists everything)
    if (threshold > 0 && extractSubjectTerms(dbQuestion) !== subjectTerms) {
      continue;
    }

    const editSimilarity = stringSimilarity(
      normalize(question),
      normalize(dbQuestion),
    );

    const kwSimilarity = keywordSimilarity(question, dbQuestion, { caseSensitive });

    const combinedScore = (editSimilarity * 0.4) + (kwSimilarity * 0.6);

    if (combinedScore >= threshold) {
      matches.push({ question: dbQuestion, answer, score: combinedScore });
    }
  }

  // Sort matches by score in descending order (highest score first)
  matches.sort((a, b) => b.score - a.score);

  if (returnAll) {
    return matches;
  } else {
    // Return best match (first in sorted array) or null if no matches
    return matches.length > 0 ? matches[0] : null;
  }
}
