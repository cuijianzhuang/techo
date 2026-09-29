import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slice } from './helpers.mjs';

// how many sizes a diary page's words are tried at (render.js: biggestFit), and which one is chosen
const biggestFit = new Function(slice('public/assets/render.js', 'function biggestFit', 'function entryPages') + '; return biggestFit;')();
const linear = (fits, lo, hi) => { for (let f = hi; f >= lo; f--) if (fits(f)) return f; return null; };

test('the biggest size that fits is the one a look at every size from the top finds', () => {
  for (let limit = 10; limit <= 24; limit++) {           // limit: the biggest size that fits (10 and 24: none, all)
    const fits = (f) => f <= limit;
    assert.equal(biggestFit(fits, 16, 19), linear(fits, 16, 19), `limit ${limit}`);
  }
});

test('a page that will run on is known after two looks, one that fits at the top after one', () => {
  let looks = 0;
  const count = (limit) => (f) => { looks++; return f <= limit; };
  looks = 0; assert.equal(biggestFit(count(15), 16, 19), null); assert.equal(looks, 2);
  looks = 0; assert.equal(biggestFit(count(19), 16, 19), 19); assert.equal(looks, 1);
  for (const limit of [16, 17, 18]) { looks = 0; assert.equal(biggestFit(count(limit), 16, 19), limit); assert.ok(looks <= 4, `limit ${limit}: ${looks}`); }
});

test('whatever the sizes do, the one chosen is a size that was seen to fit', () => {
  // (line breaks make the height uneven from size to size: a size that fits at 17 but not at 16 is possible)
  for (let mask = 0; mask < 16; mask++) {
    const fits = (f) => (mask >> (f - 16)) & 1;
    const got = biggestFit(fits, 16, 19);
    assert.ok(got === null || fits(got), `mask ${mask}`);
  }
});
