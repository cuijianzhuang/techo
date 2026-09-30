/* The looks a book can wear: what the server accepts (settings.ts) is what the browser can draw (render.js, and the
   CSS that the page's classes select). A style added on one side and not the other would save and then show nothing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slice } from './helpers.mjs';

const server = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const list = (name) => JSON.parse(new RegExp(`(?:const |, )${name} = (\\[[^\\]]*\\])`).exec(server)[1]);
const keys = (from, to) => [...slice('public/assets/render.js', from, to).matchAll(/(\w+):'/g)].map((m) => m[1]);
const css = readFileSync(new URL('../public/assets/techo.css', import.meta.url), 'utf8');
const paperCss = readFileSync(new URL('../public/assets/paper.css', import.meta.url), 'utf8');

test('cover styles: the server and the browser know the same, and each has its CSS', () => {
  const ids = list('COVER_STYLES');
  assert.deepEqual(ids, keys('const COVERS={', '};'));
  for (const id of ids.filter((k) => k !== 'slate')) assert.match(css, new RegExp(`\\.page\\.cv-${id}\\{`), id);
});

test('paper patterns: the same on both sides, each drawn (the grid is the plain paper)', () => {
  const ids = list('PAPER_STYLES');
  assert.deepEqual(ids, keys('const PAPERS={', '};'));
  for (const id of ids.filter((k) => k !== 'grid')) assert.match(css, new RegExp(`\\.page\\.pp-${id}\\{`), id);
  const timeline = readFileSync(new URL('../public/timeline/index.html', import.meta.url), 'utf8');
  for (const id of ids.filter((k) => k !== 'grid')) assert.match(timeline, new RegExp(`\\.pp-${id} \\.tl-card`), 'timeline ' + id);
});

test('paper colours: the same on both sides, each with its colours by day and by night', () => {
  const ids = list('PAPER_TONES');
  assert.deepEqual(ids, keys('const TONES={', '};'));
  for (const id of ids.filter((k) => k !== 'cream')) {
    assert.match(paperCss, new RegExp(`^\\.pt-${id}\\{`, 'm'), id);
    assert.match(paperCss, new RegExp(`\\[data-theme="dark"\\] :is\\(\\.page\\.pt-${id}:`), 'night ' + id);
  }
});

test('each cover style has its endpapers at night too', () => {
  for (const id of list('COVER_STYLES').filter((k) => k !== 'slate')) assert.match(paperCss, new RegExp(`\\.page\\.inside\\.cv-${id === 'leather' ? 'leather' : id}\\{`), id);
});
