/**
 * Logging module using log-lazy library
 * Provides lazy evaluation for efficient logging
 *
 * @module logging
 */

import makeLog from 'log-lazy';

/**
 * Create the logger instance with console logging by default
 * The log-lazy library supports lazy evaluation - wrap expensive computations
 * in arrow functions to defer evaluation until the log level permits output.
 *
 * Default level is 'info', which logs info, warn, error, and fatal messages.
 * Call enableDebugLevel() to also enable debug messages (verbose mode).
 *
 * @example
 * // Only evaluates if debug is enabled
 * log.debug(() => `User: ${JSON.stringify(userData)}`);
 *
 * // Preferred syntax for info level
 * log(() => `Processed ${items.length} items`);
 */
const log = makeLog({ level: 'info' });

/**
 * Enable debug level logging (for verbose mode)
 * This allows debug messages to be logged in addition to info/warn/error/fatal
 */
export function enableDebugLevel() {
  log.enableLevel('debug');
}

export default log;
export { log };
