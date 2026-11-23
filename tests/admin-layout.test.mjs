/* The admin's main area is a 620px form column plus a preview column. Settings have no preview
   (drawPreview returns early for them), so unless the settings form is marked and laid out wide,
   the right half of a wide screen stays empty. These read the sources, as theme.test.mjs does. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../public/assets/admin.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/assets/admin.css', import.meta.url), 'utf8');

test('the settings form is marked, and the mark frees it from the preview column', () => {
  assert.match(js, /f\.classList\.add\('setform'\)/);
  assert.match(css, /\.main:has\(>\.setform\)\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.setform\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('the wide cards span both columns, and narrow screens go back to one', () => {
  for (const id of ['theme', 'cover', 'paper', 'font', 'music', 'ai', 'photos'])
    assert.match(css, new RegExp(`#set-${id}[^}]*grid-column:1/-1|#set-${id},`), id);
  assert.match(css, /@media \(max-width:1240px\)\{\s*\.admin \.setform\{grid-template-columns:minmax\(0,1fr\)\}/);
});
