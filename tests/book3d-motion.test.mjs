import test from 'node:test';
import assert from 'node:assert/strict';
import { boardHeight, spreadCenter } from '../src-build/book3d/motion.mjs';

test('both boards meet the paper block at all four resting positions', () => {
  assert.equal(boardHeight('front', 0, 7, 28), 35);
  assert.equal(boardHeight('front', Math.PI, 7, 28), 7);
  assert.equal(boardHeight('back', 0, 7, 28), 0);
  assert.equal(boardHeight('back', Math.PI, 7, 28), 42);
});
test('opening and closing retrace the same continuous height without endpoint jumps', () => {
  for (const kind of ['front', 'back']) {
    const forward = Array.from({length: 101}, (_, i) => boardHeight(kind, i * Math.PI / 100, 7, 28));
    const reverse = Array.from({length: 101}, (_, i) => boardHeight(kind, (100 - i) * Math.PI / 100, 7, 28));
    assert.deepEqual(forward, reverse.reverse());
    for (let i = 1; i < forward.length; i++) assert.ok(Math.abs(forward[i] - forward[i - 1]) < 1);
  }
});
test('front, open spread and back are centered on their visible bounds, including narrow screens', () => {
  assert.equal(spreadCenter(0, 8, 530), 265);
  assert.equal(spreadCenter(3, 8, 530), 0);
  assert.equal(spreadCenter(8, 8, 530), -265);
});
