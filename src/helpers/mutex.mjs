/**
 * Minimal async mutex: runs the given functions one at a time, in call order.
 *
 * @returns {(fn: () => Promise<any>) => Promise<any>} Function that runs `fn` exclusively
 */
export function createMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}
