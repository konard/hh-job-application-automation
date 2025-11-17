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
    console.error('Error reading Q&A database:', error);
    return new Map();
  }
}

/**
 * Writes Q&A pairs to qa.lino file
 * @param {Map<string, string>} qaMap - Map of questions to answers
 */
export async function writeQADatabase(qaMap) {
  try {
    // Ensure data directory exists
    await fs.mkdir(path.dirname(QA_FILE_PATH), { recursive: true });

    // Format as indented Q&A pairs
    // Support multiline questions and answers
    const lines = [];
    for (const [question, answer] of qaMap.entries()) {
      // Handle multiline questions - each line should be at indent 0
      const questionLines = question.split('\n');
      for (const qLine of questionLines) {
        lines.push(qLine);
      }

      // Handle multiline answers - each line should be indented with 2 spaces
      const answerLines = answer.split('\n');
      for (const aLine of answerLines) {
        lines.push(`  ${aLine}`);
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
