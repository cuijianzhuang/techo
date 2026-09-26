/* A journal page (a live DOM node, 530×740) → a canvas, for use as a WebGL texture.

   The page goes into an SVG <foreignObject> together with the book's own stylesheet, so it renders with the very
   same CSS as the live page, not a re-creation of it. What an SVG image can't reach from the document gets
   inlined first:
   - fonts: only the Google Fonts slices whose unicode-range covers characters on this page (the Chinese
     handwriting fonts come in ~100–200 slices of ~40KB; a page needs a handful). Each slice is fetched once.
   - <use href="#mug">: the shared symbol's drawing is copied in.
   - <img src="/img/…">: fetched and turned into a data URL.
   3D pages are captured with their complete content so the live and moving versions match. */

export const PAGE_W = 530, PAGE_H = 740;

const cache = { css: null, faces: null, blobs: new Map() };

const blobToDataURL = (b) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});
async function dataURL(url) {
  if (!cache.blobs.has(url)) {
    cache.blobs.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error('fetch ' + url + ' ' + r.status);
      return r.blob();
    }).then(blobToDataURL));
  }
  return cache.blobs.get(url);
}

async function bookCSS() {
  if (!cache.css) {
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => /\/assets\/techo\.css/.test(l.href));
    cache.css = fetch(link ? link.href : '/assets/techo.css').then((r) => r.text());
  }
  return cache.css;
}

/* Google Fonts CSS → [{css: '@font-face{…}', family, url, ranges: [[lo,hi],…]}] */
async function fontFaces() {
  if (!cache.faces) {
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => /fonts\.googleapis\.com/.test(l.href));
    cache.faces = !link ? Promise.resolve([]) : fetch(link.href).then((r) => r.text()).then((text) => {
      const out = [];
      for (const m of text.matchAll(/@font-face\s*{([^}]*)}/g)) {
        const body = m[1];
        const fam = /font-family:\s*'([^']+)'/.exec(body), src = /url\((https:[^)]+)\)/.exec(body);
        if (!fam || !src) continue;
        const ur = /unicode-range:\s*([^;]+);/.exec(body);
        const ranges = !ur ? [[0, 0x10ffff]] : ur[1].split(',').map((s) => {
          s = s.trim().replace(/^U\+/i, '');
          if (s.includes('?')) return [parseInt(s.replace(/\?/g, '0'), 16), parseInt(s.replace(/\?/g, 'F'), 16)];
          const [a, b] = s.split('-');
          return [parseInt(a, 16), parseInt(b || a, 16)];
        });
        out.push({ body, family: fam[1], url: src[1], ranges });
      }
      return out;
    }).catch(() => []);
  }
  return cache.faces;
}

/* the font families this page actually sets text in, and the characters it uses */
function pageText(node) {
  const families = new Set(), chars = new Set();
  const walk = (el) => {
    const cs = getComputedStyle(el);
    const first = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) families.add(first);
    for (const c of el.children) walk(c);
  };
  walk(node);
  for (const ch of node.textContent) chars.add(ch.codePointAt(0));
  return { families, chars: [...chars] };
}

async function fontCSSFor(node) {
  const [faces, { families, chars }] = [await fontFaces(), pageText(node)];
  const wanted = faces.filter((f) => families.has(f.family) && chars.some((c) => f.ranges.some(([lo, hi]) => c >= lo && c <= hi)));
  const parts = await Promise.all(wanted.map(async (f) => {
    try { return '@font-face{' + f.body.replace(f.url, await dataURL(f.url)) + '}'; } catch { return ''; }
  }));
  return parts.join('\n');
}

/* <use href="#id"> can't reach the document's symbols from inside an SVG image: copy the drawing in */
function expandUses(root) {
  for (const use of [...root.querySelectorAll('use')]) {
    const id = (use.getAttribute('href') || use.getAttribute('xlink:href') || '').replace(/^#/, '');
    const sym = id && document.getElementById(id);
    if (!sym) continue;
    const svg = use.ownerSVGElement;
    if (svg && !svg.getAttribute('viewBox') && sym.getAttribute('viewBox')) svg.setAttribute('viewBox', sym.getAttribute('viewBox'));
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const c of sym.childNodes) g.appendChild(c.cloneNode(true));
    use.replaceWith(g);
  }
}

async function inlineImages(root) {
  await Promise.all([...root.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    img.setAttribute('src', await dataURL(new URL(src, location.href).href));
  }));
}

const loadImage = (src) => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => rej(new Error('page image failed to load'));
  im.src = src;
});

/* Render `node` into a canvas `scale` times its 530×740 size. */
export async function rasterize(node, scale = 2) {
  const [css, fonts] = await Promise.all([bookCSS(), fontCSSFor(node)]);
  const clone = node.cloneNode(true);
  clone.style.transform = 'none';
  clone.style.position = 'relative';
  clone.style.left = clone.style.top = '0';
  expandUses(clone);
  await inlineImages(clone);
  const html = new XMLSerializer().serializeToString(clone);
  const style = new XMLSerializer().serializeToString(Object.assign(document.createElement('style'), { textContent: fonts + '\n' + css }));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W * scale}" height="${PAGE_H * scale}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">` +
    `<foreignObject x="0" y="0" width="${PAGE_W}" height="${PAGE_H}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden">${style}${html}</div>` +
    `</foreignObject></svg>`;
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  // Safari lays out an SVG image's web fonts a moment after it reports loaded: give it a beat
  await new Promise((r) => setTimeout(r, 30));
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * scale;
  canvas.height = PAGE_H * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
