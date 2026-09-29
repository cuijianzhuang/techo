/* Versions on the addresses of scripts and stylesheets (src-build/stamp.py). public/_headers keeps /assets/* and
   /vendor/* for a year, so one reference without its version would be a page stuck on an old file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const pub = fileURLToPath(new URL('../public', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(pub).filter((p) => /\.(html|js|css)$/.test(p));
const known = new Set(walk(pub).map((p) => p.slice(pub.length)).filter((a) => /^\/(assets|vendor)\/[\w.-]+\.(js|css)$/.test(a)));
const REF = /(?<=["'`(=])(\/(?:assets|vendor)\/[\w.-]+\.(?:js|css))(\?v=[0-9a-f]{10})?/g;

test('every reference to a script or stylesheet of the site has its version', () => {
  const bare = [];
  for (const p of files) {
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(REF)) if (known.has(m[1]) && !m[2] && p.slice(pub.length) !== m[1]) bare.push(`${p.slice(pub.length)}: ${m[1]}`);
  }
  assert.deepEqual(bare, []);
});

test('the versions are the ones stamp.py gives now (run `python3 src-build/stamp.py` after changing a file in public/)', () => {
  execFileSync('python3', [fileURLToPath(new URL('../src-build/stamp.py', import.meta.url)), '--check'], { stdio: 'pipe' });
});

test('the book page still names boot.js in the way the Worker looks for it', () => {
  // src/index.ts puts the book's data in front of the script that starts with /assets/boot.js
  assert.match(readFileSync(join(pub, 'index.html'), 'utf8'), /<script src="\/assets\/boot\.js\?v=[0-9a-f]{10}"><\/script>/);
  assert.match(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'), /script\[src\^="\/assets\/boot\.js"\]/);
});

test('/assets and /vendor are kept for a year, immutable', () => {
  const h = readFileSync(join(pub, '_headers'), 'utf8');
  for (const dir of ['assets', 'vendor']) assert.match(h, new RegExp(`^/${dir}/\\*\\n  Cache-Control: public, max-age=31536000, immutable$`, 'm'));
});
