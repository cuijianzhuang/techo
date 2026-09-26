// The board pose is a function of its angle, independent of travel direction.
export function boardHeight(kind, phi, thickness, paperDepth) {
  const t = (1 - Math.cos(phi)) / 2;
  return kind === 'front'
    ? thickness + paperDepth * (1 - t)
    : (2 * thickness + paperDepth) * t;
}

export function spreadCenter(c, sheets, width) {
  return c <= 0 ? width / 2 : c >= sheets ? -width / 2 : 0;
}
