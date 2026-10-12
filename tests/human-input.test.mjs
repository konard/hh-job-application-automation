/**
 * Tests for mouse and wheel input that stays smooth on a screen recording
 */
import { describe, test, assert } from 'test-anywhere';
import { createHumanInput, easeInOut, pointerPath, wheelSteps } from '../src/helpers/human-input.mjs';

describe('human input', () => {
  test('easing starts and ends slowly', () => {
    assert.equal(easeInOut(0), 0);
    assert.equal(easeInOut(1), 1);
    assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-9);
    assert.ok(easeInOut(0.1) < 0.1);
  });

  test('wheel steps add up to the scroll, small at the start and the end', () => {
    for (const delta of [400, -650, 37]) {
      const steps = wheelSteps(delta, 30);
      assert.equal(steps.reduce((sum, step) => sum + step, 0), delta);
      assert.ok(steps.every((step) => Math.sign(step) === Math.sign(delta)));
    }
    const steps = wheelSteps(600, 40);
    const largest = Math.max(...steps);
    assert.ok(steps[0] < largest && steps.at(-1) < largest);
  });

  test('the pointer path ends on the target and bends off the line', () => {
    const path = pointerPath({ x: 0, y: 0 }, { x: 300, y: 0 }, 20);
    assert.ok(Math.abs(path.at(-1).x - 300) < 1e-9);
    assert.ok(Math.abs(path.at(-1).y) < 1e-9);
    assert.ok(Math.max(...path.map((point) => Math.abs(point.y))) > 10);
  });

  test('a click glides to the element and presses there; a scroll adds up', async () => {
    const events = [];
    const page = { mouse: {
      move: async (x, y) => events.push(['move', x, y]),
      down: async () => events.push(['down']),
      up: async () => events.push(['up']),
      wheel: async (dx, dy) => events.push(['wheel', dy]),
    } };
    const input = createHumanInput(page, { sleep: async () => {}, random: () => 0.5 });
    assert.equal(await input.click({ boundingBox: async () => ({ x: 100, y: 200, width: 100, height: 40 }) }), true);
    const moves = events.filter(([kind]) => kind === 'move');
    assert.ok(moves.length > 5);
    assert.deepEqual(moves.at(-1).slice(1), [150, 220]);
    assert.deepEqual(events.slice(-2), [['down'], ['up']]);
    assert.equal(await input.click({ boundingBox: async () => null }), false);
    await input.scroll(300);
    assert.equal(events.filter(([kind]) => kind === 'wheel').reduce((sum, [, dy]) => sum + dy, 0), 300);
  });
});
