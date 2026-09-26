import test from 'node:test';
import assert from 'node:assert/strict';
import { foldOf, constrain, cornerPath, foldPoint } from '../src-build/book3d/curl.mjs';

const W = 530, H = 740, C0 = { x: W, y: -H / 2 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the pulled corner lands where it is pulled to once it is past the roll', () => {
  for (const t of [0.1, 0.3, 0.5, 0.8, 0.95]) {
    const C = cornerPath(t, W, H, 185);
    for (const R of [0, 20, 45]) {
      const f = foldOf(C0, C, R, H);
      const [x, y] = foldPoint(C0.x, C0.y, f);
      const onRoll = Math.hypot(C0.x - C.x, C0.y - C.y) / 2 + Math.PI * f.R / 2 < Math.PI * f.R;   // corner still up on the roll
      if (!onRoll) { assert.ok(near(x, C.x, 1e-6) && near(y, C.y, 1e-6), `t=${t} R=${R}: ${x},${y} vs ${C.x},${C.y}`); }
    }
  }
});

test('the spine never moves: the page stays bound in', () => {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const f = foldOf(C0, cornerPath(t, W, H, 185), 45, H);
    for (const y of [-H / 2, -H / 4, 0, H / 4, H / 2]) {
      const [x, yy, z] = foldPoint(0, y, f);
      assert.ok(near(x, 0) && near(yy, y) && near(z, 0), `t=${t.toFixed(2)} y=${y}`);
    }
  }
});

test('the click path needs no clamping, and a clamped drag point is allowed', () => {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const C = cornerPath(t, W, H, 185), k = constrain(C, C0, W, H);
    assert.ok(near(C.x, k.x, 1e-9) && near(C.y, k.y, 1e-9));
  }
  const k = constrain({ x: 900, y: 500 }, C0, W, H);
  assert.ok(Math.hypot(k.x, k.y + H / 2) <= W + 1e-9);
});

test('folding keeps the paper its size (distances along the fold direction are kept)', () => {
  const f = foldOf(C0, cornerPath(0.4, W, H, 260), 40, H);
  let prev = null, total = 0;
  const steps = 2000;
  // walk straight across the crease along n, from the flat side into the flap
  const x0 = f.c * f.nx - 200 * f.nx, y0 = f.c * f.ny - 200 * f.ny;
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * 400, p = foldPoint(x0 + f.nx * s, y0 + f.ny * s, f);
    if (prev) total += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  assert.ok(Math.abs(total - 400) < 0.5, `length ${total}`);
});

test('a corner pulled straight down the page is held to a sensible angle', () => {
  const top = { x: W, y: H / 2 };
  const k = constrain({ x: W - 60, y: -H / 2 }, top, W, H);        // yanked from the top corner to the bottom
  assert.ok(top.y - k.y <= 70 + Math.tan(40 * Math.PI / 180) * 60 + 1e-9);
  const out = constrain({ x: 300, y: H / 2 + 200 }, top, W, H);    // pulled off past its own edge
  assert.ok(near(out.y, H / 2));
});
