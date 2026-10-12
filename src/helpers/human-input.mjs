/**
 * Mouse and wheel input that looks like a person's, and stays smooth on a screen recording: the
 * pointer glides to its target along a slight curve, easing in and out, about 60 steps a second;
 * a scroll is a stream of small wheel steps with the same easing, never one jump; a click lands
 * near the middle of its target, not on the same pixel each time.
 *
 * @module human-input
 */

const FRAME_MS = 16;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Slow start, slow end
 * @param {number} t - 0..1
 * @returns {number} 0..1
 */
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

/**
 * The wheel steps of one scroll: eased, whole pixels, adding up to the scroll
 * @param {number} deltaY - Pixels, down when positive
 * @param {number} frames
 * @returns {number[]}
 */
export function wheelSteps(deltaY, frames) {
  const steps = [];
  let done = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const target = Math.round(deltaY * easeInOut(frame / frames));
    if (target !== done) {
      steps.push(target - done);
      done = target;
    }
  }
  return steps;
}

/**
 * The pointer's path to a point: eased, bent a little off the straight line, ending on the point
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {number} bend - Pixels off the straight line at the middle (signed)
 * @returns {Array<{x: number, y: number}>}
 */
export function pointerPath(from, to, bend) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const frames = Math.max(8, Math.min(45, Math.round(distance / 12)));
  const [nx, ny] = distance > 0 ? [-dy / distance, dx / distance] : [0, 0];
  const path = [];
  for (let frame = 1; frame <= frames; frame++) {
    const t = easeInOut(frame / frames);
    const off = Math.sin(Math.PI * t) * bend;
    path.push({ x: from.x + dx * t + nx * off, y: from.y + dy * t + ny * off });
  }
  return path;
}

/**
 * @param {Object} page - Playwright page
 * @param {Object} [options]
 * @param {Function} [options.sleep]
 * @param {Function} [options.random]
 * @returns {{moveTo: Function, scroll: Function, click: Function, position: Function}}
 */
export function createHumanInput(page, { sleep = defaultSleep, random = Math.random } = {}) {
  let at = { x: 0, y: 0 };

  /** The pointer glided to a point */
  async function moveTo(x, y) {
    const distance = Math.hypot(x - at.x, y - at.y);
    if (distance < 1) {
      return;
    }
    const bend = (random() - 0.5) * Math.min(80, distance * 0.2);
    for (const point of pointerPath(at, { x, y }, bend)) {
      await page.mouse.move(point.x, point.y);
      await sleep(FRAME_MS);
    }
    at = { x, y };
  }

  /**
   * The wheel turned where the pointer is, a little at a time
   * @param {number} deltaY - Pixels, down when positive
   */
  async function scroll(deltaY) {
    const frames = Math.max(8, Math.round((300 + Math.abs(deltaY) * 0.8) / FRAME_MS));
    for (const step of wheelSteps(deltaY, frames)) {
      await page.mouse.wheel(0, step);
      await sleep(FRAME_MS);
    }
  }

  /**
   * A click near the middle of an element on screen
   * @param {Object} locator - Playwright locator
   * @returns {Promise<boolean>} False when it is not on screen
   */
  async function click(locator) {
    const box = await locator.boundingBox().catch(() => null);
    if (!box) {
      return false;
    }
    await moveTo(box.x + box.width * (0.3 + random() * 0.4), box.y + box.height * (0.35 + random() * 0.3));
    await sleep(150 + random() * 250);
    await page.mouse.down();
    await sleep(60 + random() * 60);
    await page.mouse.up();
    return true;
  }

  return { moveTo, scroll, click, position: () => at };
}
