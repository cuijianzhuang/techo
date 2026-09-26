/* A page turned by its corner, like a real one: the corner is pulled across and the paper folds along a
   straight crease, rolling over a small cylinder there, so the part past the crease lies face down on the
   rest. Everything here is in the page's own coordinates: the page lies on x 0…W (spine at x=0), y -H/2…H/2,
   face up; the corner being pulled starts at C0 = (W, ±H/2). A turn from the left is the same thing mirrored.

   The crease is where a flat fold would put it (halfway between where the corner was and where it is now,
   square to that line), moved back by half the roll so the corner still lands right under the hand. */

/* the fold for corner C0 pulled to C: crease line n·p = c (n points at the corner side), roll radius R */
export function foldOf(C0, C, R, H) {
  const dx = C0.x - C.x, dy = C0.y - C.y, len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;
  const nx = dx / len, ny = dy / len;
  const c = ((C0.x + C.x) / 2) * nx + ((C0.y + C.y) / 2) * ny;
  // the spine (x=0, y=±H/2) must stay on the flat side, roll included, or the page would tear out
  const spine = Math.abs(ny) * H / 2, room = c - spine;
  R = Math.max(0, Math.min(R, (2 * room) / Math.PI));
  return { nx, ny, c: c - (Math.PI * R) / 2, R };
}

/* where the pulled corner may go. A hand turning a page moves its corner across, lifting it a little off its
   own edge; pulled straight down (or up) the page would fold along a steep line and the flap would cover the
   whole page like a page torn out and twisted. So: the corner rises off its edge towards the middle of the
   page, by at most 45% of the height and — past a small dog-ear — at no more than 40° from the edge. Then
   no further from the spine than the page is wide (along its own edge), and no further from the other end
   of the spine than the diagonal (the page stays bound in). */
export function constrain(C, C0, W, H) {
  const sy = C0.y, oy = -C0.y;                    // spine end on the corner's edge, and the other one
  let x = C.x, y = C.y;
  const inward = C0.y < 0 ? 1 : -1, across = Math.max(0, C0.x - x);
  const rise = Math.min(Math.max((y - C0.y) * inward, 0), 0.45 * H, 70 + Math.tan((40 * Math.PI) / 180) * across);
  y = C0.y + inward * rise;
  let dx = x, dy = y - sy, l = Math.hypot(dx, dy);
  if (l > W) { x = (dx / l) * W; y = sy + (dy / l) * W; }
  const diag = Math.hypot(W, H);
  dx = x; dy = y - oy; l = Math.hypot(dx, dy);
  if (l > diag) { x = (dx / l) * diag; y = oy + (dy / l) * diag; }
  return { x, y };
}

/* the corner's way across on a click turn: t 0…1, bottom corner over the top of an arc to the far side */
export function cornerPath(t, W, H, lift) {
  return { x: W * Math.cos(Math.PI * t), y: -H / 2 + lift * Math.sin(Math.PI * t) };
}

/* a point of the page (px, py) folded: [x, y, z, normal x, y, z] */
export function foldPoint(px, py, f) {
  if (!f) return [px, py, 0, 0, 0, 1];
  const d = px * f.nx + py * f.ny - f.c;
  if (d <= 0) return [px, py, 0, 0, 0, 1];
  const { nx, ny, R } = f;
  if (R > 0 && d < Math.PI * R) {                 // on the roll
    const a = d / R, s = d - R * Math.sin(a);
    return [px - nx * s, py - ny * s, R * (1 - Math.cos(a)), -nx * Math.sin(a), -ny * Math.sin(a), Math.cos(a)];
  }
  const s = 2 * d - Math.PI * R;                   // past it: lying face down on the page
  return [px - nx * s, py - ny * s, 2 * R, 0, 0, -1];
}
