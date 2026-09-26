/* The journal as a three.js book: boards with real thickness, page blocks whose depth follows your place in
   the book, and paper that bends as it turns. At rest the two open pages are the live web pages, laid over the
   3D pages with the same camera (CSS3DRenderer), so text stays crisp, selectable and clickable and the draw-in
   while a sheet turns, WebGL shows complete rasterised copies of the pages (raster.js).

   Layout (world units = page px): spine at x=0, the book lies in the XY plane, +z points up off the desk
   towards the viewer. A "sheet" is a pair of pages, front = right-hand page (even index), back = left-hand
   page (odd index). Sheet 0 is the front board (cover / inside cover), the last sheet the back board.
   `cur` = sheets turned to the left: 0 shut on the cover, S shut on the back. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BoxGeometry, PlaneGeometry, BufferGeometry,
  BufferAttribute, ShaderMaterial, Vector4, CanvasTexture, Vector2, Vector3, Raycaster, Plane, FrontSide, BackSide,
  LinearMipmapLinearFilter, LinearFilter, NoColorSpace, LinearSRGBColorSpace, Color,
} from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { rasterize, PAGE_W as W, PAGE_H as H } from './raster.js';
import { boardHeight, spreadCenter } from './motion.mjs';
import { foldOf, constrain, cornerPath, foldPoint } from './curl.mjs';
import { unlock, soundOn, setSound, paperTurn, boardTurn, fallBack } from './sound.js';

const OH = 6;          // boards overhang the pages
const BT = 7;          // board thickness
const SHEET = 2.4;     // one paper sheet in the page block
const MIN_BLOCK = 28;  // the page block never looks thinner than this
const FOV = 18, DEG = Math.PI / 180;
/* The camera faces the book square on and never swings: the book lies straight, like the page-flip book.
   (Only the slide that centres a shut book moves it.) */
const VIEW = { front: { pitch: 0, yaw: 0 }, open: { pitch: 0, yaw: 0 }, back: { pitch: 0, yaw: 0 } };
// The shader outputs raw display colors, just like the DOM textures. Convert
// Three's linear Color values back to display space for untextured edges too.
const CLOTH = new Color('#2b454b').convertLinearToSRGB();
const CLOTH_EDGE = new Color('#314d53').convertLinearToSRGB();
const PAPER = new Color('#f6f1e2').convertLinearToSRGB();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// paper: a quick lift, an unhurried float, a soft landing (gentler than the boards' cubic)
const easePaper = (t) => (1 - Math.cos(Math.PI * t)) / 2 * 0.7 + ease(t) * 0.3;
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- one shader for paper, boards and blocks: flat towards the viewer is exactly the texture
   (so a rasterised page matches the live page it replaces), tilting away darkens it. ---------- */
function material({ map = null, color = PAPER, flipU = false, stripes = false, side = FrontSide, uvRect = null } = {}) {
  return new ShaderMaterial({
    side,
    uniforms: {
      map: { value: map }, useMap: { value: map ? 1 : 0 }, color: { value: color.clone() },
      flipU: { value: flipU ? 1 : 0 }, stripes: { value: stripes ? 1 : 0 }, stripeGap: { value: SHEET },
      shadow: { value: new Vector4(0, 0, 0, 0) }, // crease n·xy = c (world), strength: the shade by a fold
      shadowW: { value: 70 },                      // how far from the crease it fades
      uvRect: { value: uvRect || new Vector4(0, 0, 1, 1) },   // where the page sits on this face
      // three.js draws a BackSide material by swapping which winding counts as front, so gl_FrontFacing is
      // true on the faces it draws: turn the normal round ourselves or the back of a sheet is lit as if
      // facing away (a darker page that brightened with a flash when the sheet came to rest)
      backSide: { value: side === BackSide ? 1 : 0 },
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float useMap, flipU, stripes, stripeGap; uniform vec3 color; uniform vec4 shadow, uvRect; uniform float shadowW; uniform float backSide;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec2 uv = vUv; if (flipU > 0.5) uv.x = 1.0 - uv.x;
        uv = (uv - uvRect.xy) / uvRect.zw;
        bool onPage = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
        vec4 texel = useMap > 0.5 && onPage ? texture2D(map, uv) : vec4(color, 1.0);
        vec3 base = mix(color, texel.rgb, texel.a);
        vec3 n = normalize(vN); if (!gl_FrontFacing || backSide > 0.5) n = -n;
        // light from over the reader's shoulder: a face turned half away is only a little darker, never a grey slab
        vec3 L = normalize(vec3(-0.25, 0.3, 1.0));
        float shade = min(0.7 + 0.3 * max(dot(n, L), 0.0) / L.z, 1.05);
        if (stripes > 0.5 && abs(n.z) < 0.5) base *= mix(0.84, 1.0, smoothstep(0.0, 0.45, fract(vW.z / stripeGap)));
        if (shadow.w > 0.0) { float d = dot(shadow.xy, vW.xy) - shadow.z; if (d > 0.0) shade *= 1.0 - shadow.w * exp(-d / shadowW); }
        gl_FragColor = vec4(base * shade, 1.0);
      }`,
  });
}

/* a sheet of paper as a grid, spine (u=0) to fore-edge (u=1), folded each frame (curl.mjs) */
const GX = 44, GY = 30;
function sheetGeometry() {
  const g = new BufferGeometry(), n = (GX + 1) * (GY + 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) {
    const k = j * (GX + 1) + i;
    uv.set([i / GX, j / GY], k * 2);
    if (i < GX && j < GY) { const b = k + GX + 1; idx.push(k, k + 1, b, k + 1, b + 1, b); }
  }
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
/* Fold the sheet: `f` from foldOf (in the page's own coordinates, page on x 0…W). mirror: the page is the
   left one being turned back, so everything is reflected about the spine (and the faces swap: reflecting
   turns the paper over). height(x, z): world height of a point at world x folded up by z, so every part of
   the sheet rests on or above what it lies over. view {cx, cz, zref}: the camera (x, distance) and the height
   of the page the sheet lies on: a raised part is drawn where it would appear if it lay on that page, as in
   the page-flip book, so a curl stands up in light and shade but never swells past the page's outline.
   zref(x): the height of the page under world x. */
function foldSheet(g, f, mirror, height, view) {
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) {
    const k = j * (GX + 1) + i;
    const [x, y, z, nx, ny, nz] = foldPoint((i / GX) * W, (j / GY - 0.5) * H, f);
    const X = mirror ? -x : x, Z = height(X, z), s = (view.cz - Z) / (view.cz - view.zref(X));
    pos[k * 3] = view.cx + (X - view.cx) * s; pos[k * 3 + 1] = y * s; pos[k * 3 + 2] = Z;
    if (mirror) { nor[k * 3] = nx; nor[k * 3 + 1] = -ny; nor[k * 3 + 2] = -nz; }
    else { nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz; }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.computeBoundingSphere();
}

export async function start() {
  const T = window.Techo, $ = (id) => document.getElementById(id);
  const stage = $('stage'), src = $('static'), dragnote = $('dragnote'), restart = $('restart'), nav = $('nav'), dots = $('dots');

  /* ---------- renderers (a WebGL failure here falls back to the page-flip book in boot.js) ---------- */
  const host = document.createElement('div');
  host.className = 'book3d';
  const gl = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  gl.outputColorSpace = LinearSRGBColorSpace;   // textures in, pixels out, no conversion: pages match the DOM
  gl.setClearColor(0x000000, 0);
  const css = new CSS3DRenderer();
  css.domElement.className = 'book3d-dom';
  host.append(gl.domElement, css.domElement);
  // Take the book's final place at once, before any content has loaded: the stage doesn't change height as
  // the book arrives (no jump of everything below it), and the book fades in only once it's complete.
  // A phone (narrow stage) shows one page at a time, big enough to read; wider screens show the spread.
  const PORTRAIT = 640, SPAN_H = H + 2 * OH + 40;
  const spanW = (width) => (width < PORTRAIT ? W + 2 * OH + 30 : 2 * (W + OH) + 30);
  const bookHeight = (width) => Math.max(200, Math.round(Math.min(window.innerHeight - 140, width * SPAN_H / spanW(width))));
  host.style.height = bookHeight(stage.getBoundingClientRect().width) + 'px';
  document.body.classList.add('is-3d');
  stage.appendChild(host);

  /* ---------- the book's content (shared with the page-flip book) ---------- */
  const { pages } = await T.loadBook(src);
  const N = pages.length, S = N / 2, P = Math.max(0, S - 2);
  const meas = T.measure();
  pages.forEach((p) => meas.appendChild(p.node));
  src.remove();
  // "Written on the page": a diary page is blank until it's first opened at rest, then its words and doodles
  // are written in (Techo.playDraw), like the page-flip book.
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) pages.forEach((p) => { if (p.node.classList.contains('day') || p.node.classList.contains('jp')) T.prepDraw(p.node); });

  /* Page textures, one per page and state: an unwritten page is captured blank, a page being or already
     written as it looks complete (raster.js works on a copy, so capturing never disturbs the writing). */
  const tex = new Map();
  const drawState = (node) => (node.dataset.draw === 'pending' ? 'pending' : 'done');
  function texture(i) {
    const node = pages[i].node, state = drawState(node), cached = tex.get(i);
    if (cached && cached.state === state) return cached.promise;
    const entry = { texture: cached && cached.texture, promise: null, state };   // the old one shows until the new is ready
    entry.promise = rasterize(node, 2, state === 'done').then((canvas) => {
      if (cached && cached.texture && cached.texture !== entry.texture) cached.texture.dispose();
      const t = new CanvasTexture(canvas);
      t.colorSpace = NoColorSpace;
      t.anisotropy = gl.capabilities.getMaxAnisotropy();
      t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
      entry.texture = t;
      return t;
    }).catch((error) => { if (tex.get(i) === entry) tex.delete(i); throw error; });
    tex.set(i, entry);
    return entry.promise;
  }
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
  function warm(around) {
    const want = [];
    for (let d = 0; d <= 4; d++) for (const i of [around + d, around - 1 - d]) if (i >= 0 && i < N) want.push(i);
    (function next() { const i = want.shift(); if (i == null) return; texture(i).catch(() => {}).then(() => idle(next)); })();
  }

  /* ---------- scene ---------- */
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 1, 20000);
  const book = new Group(); scene.add(book);

  // desk shadow: a soft ellipse under whatever lies on the desk
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  { const c = shadowCanvas.getContext('2d'), g = c.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(20,16,8,.30)'); g.addColorStop(1, 'rgba(20,16,8,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); }
  const deskShadow = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: new CanvasTexture(shadowCanvas) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vUv); }',
  }));
  deskShadow.position.z = -0.5; book.add(deskShadow);

  // boards: a box on a hinge group (the group turns about the spine; the box sits above the hinge)
  function board() {
    const w = W + OH + 1, h = H + 2 * OH;
    const edge = material({ color: CLOTH_EDGE });
    // Every page is the same size and sits in the same place, board or paper: on a board the page covers
    // x 0…W from the hinge (the top face's u runs from the hinge side, the bottom face's from the fore-edge),
    // and the overhang around it is cloth, like a turn-in.
    const top = material({ color: CLOTH, uvRect: new Vector4(1 / w, OH / h, W / w, H / h) });
    const bottom = material({ color: CLOTH, uvRect: new Vector4(OH / w, OH / h, W / w, H / h) });
    const mesh = new Mesh(new BoxGeometry(w, h, BT), [edge, edge, edge, edge, top, bottom]);
    mesh.position.set(w / 2 - 1, 0, BT / 2);
    const hinge = new Group(); hinge.add(mesh); book.add(hinge);
    return { hinge, top, bottom };
  }
  const front = board(), back = board();
  // page blocks (the paper between the boards), and the top page lying on each
  const blockMat = material({ color: PAPER, stripes: true });
  const blockL = new Mesh(new BoxGeometry(1, 1, 1), blockMat), blockR = new Mesh(new BoxGeometry(1, 1, 1), blockMat);
  book.add(blockL, blockR);
  const topL = new Mesh(new PlaneGeometry(W, H), material()), topR = new Mesh(new PlaneGeometry(W, H), material());
  topL.position.x = -W / 2; topR.position.x = W / 2; book.add(topL, topR);
  // the turning sheet: one bent strip, drawn twice (front and back faces)
  const sheetGeo = sheetGeometry();
  const sheetFront = new Mesh(sheetGeo, material({ side: FrontSide }));
  const sheetBack = new Mesh(sheetGeo, material({ side: BackSide, flipU: true }));
  sheetFront.visible = sheetBack.visible = false; book.add(sheetFront, sheetBack);

  /* ---------- the live pages at rest ---------- */
  function slot() {
    const el = document.createElement('div'); el.className = 'book3d-slot';
    const obj = new CSS3DObject(el); obj.visible = false; return { el, obj, page: -1 };
  }
  const slotL = slot(), slotR = slot();
  const cssScene = new Scene(); const cssBook = new Group(); cssScene.add(cssBook); cssBook.add(slotL.obj, slotR.obj);

  /* ---------- state → geometry ---------- */
  let cur = 0;
  const paperLeft = (c) => (c <= 0 ? 0 : c >= S ? P : Math.min(c - 1, P));
  const blockDepth = (n) => (P ? Math.max(MIN_BLOCK, P * SHEET) * n / P : 0);
  const setMap = (m, i) => {
    const t = i != null && tex.get(i);
    m.uniforms.map.value = t && t.texture ? t.texture : null;
    m.uniforms.useMap.value = m.uniforms.map.value ? 1 : 0;
  };
  function placeBoard(b, phi, z0) { b.hinge.rotation.y = -phi; b.hinge.position.z = z0; }
  function layout(state) {
    // state: {nl, nr (paper sheets each side, may be fractional mid-turn), frontPhi, frontZ, backPhi, backZ, topL, topR}
    const dl = blockDepth(state.nl), dr = blockDepth(state.nr);
    blockL.visible = dl > 0.01; blockR.visible = dr > 0.01;
    blockL.scale.set(W, H, Math.max(dl, 0.01)); blockL.position.set(-W / 2, 0, BT + dl / 2);
    blockR.scale.set(W, H, Math.max(dr, 0.01)); blockR.position.set(W / 2, 0, BT + dr / 2);
    topL.visible = state.topL != null && dl > 0.01; topL.position.z = BT + dl + 0.04; setMap(topL.material, state.topL);
    topR.visible = state.topR != null && dr > 0.01; topR.position.z = BT + dr + 0.04; setMap(topR.material, state.topR);
    placeBoard(front, state.frontPhi, state.frontZ);
    placeBoard(back, state.backPhi, state.backZ);
    setMap(front.top, 0); setMap(front.bottom, 1); setMap(back.top, N - 2); setMap(back.bottom, N - 1);
    // the desk shadow spans whatever lies on the desk: the left half once anything has turned, the right
    // half until everything has
    // (grows and shrinks with the board swinging over, never jumps)
    const lo = -(W + OH) * smooth(state.frontPhi / Math.PI), hi = (W + OH) * smooth(1 - state.backPhi / Math.PI);
    deskShadow.scale.set((hi - lo) * 1.12, (H + 2 * OH) * 1.18, 1);
    deskShadow.position.set((hi + lo) / 2, -8, -0.5);
  }
  const leftPage = (c) => (c >= 1 ? 2 * c - 1 : null), rightPage = (c) => (c <= S - 1 ? 2 * c : null);
  /* The stacks while a paper sheet travels from `from` to `to` (angle phi): they hand it over smoothly. The
     side it leaves thins while it peels off (first 30% of the way), the side it lands on thickens as it
     settles (last 30%), and its spine end always rests on the stack it touches: no step in height when a
     sheet lifts or lands. A block changing depth always has a page lying on it, never its bare top. Turning,
     dragging and falling back all use this, so they can't disagree. */
  function paperState(from, to, phi) {
    const fwd = to > from, a = restState(from), b = restState(to);
    const q = fwd ? phi / Math.PI : 1 - phi / Math.PI, off = smooth(q / 0.3), on = smooth((q - 0.7) / 0.3);
    const st = {
      nl: lerp(a.nl, b.nl, fwd ? on : off), nr: lerp(a.nr, b.nr, fwd ? off : on),
      frontPhi: a.frontPhi, frontZ: a.frontZ, backPhi: a.backPhi, backZ: a.backZ,
      // under the moving sheet its destination page is already there; the side it lands on shows its own page
      // (even the inside of a board) until covered
      topL: fwd ? leftPage(from) : leftPage(to), topR: fwd ? rightPage(to) : rightPage(from),
    };
    return st;
  }
  function restState(c) {
    const nl = paperLeft(c), nr = P - nl;
    return {
      nl: c >= S ? P : nl, nr: c <= 0 ? P : c >= S ? 0 : nr,
      frontPhi: c >= 1 ? Math.PI : 0, frontZ: c >= 1 ? BT : BT + blockDepth(P),
      backPhi: c >= S ? Math.PI : 0, backZ: c >= S ? 2 * BT + blockDepth(P) : 0,
      topL: c >= 2 && c <= S - 1 ? 2 * c - 1 : c === S ? null : null,
      topR: c >= 1 && c <= S - 2 ? 2 * c : null,
    };
  }

  /* ---------- camera framing ---------- */
  const fit = { px: 1, portrait: false, tx: 0, pitch: VIEW.front.pitch, yaw: VIEW.front.yaw, w: 0, h: 0 };
  // which page of an open spread a phone is looking at: 'L' or 'R'
  let side = 'R';
  const targetX = (c, sd = side) => (!fit.portrait || c <= 0 || c >= S ? spreadCenter(c, S, W) : sd === 'L' ? -W / 2 : W / 2);
  const viewOf = (c) => (c <= 0 ? VIEW.front : c >= S ? VIEW.back : VIEW.open);
  function frame() {
    const r = stage.getBoundingClientRect();
    fit.portrait = r.width < PORTRAIT;
    const w = Math.round(r.width), h = bookHeight(r.width);
    fit.px = Math.min(w / spanW(r.width), h / SPAN_H);
    fit.w = w; fit.h = h;
    host.style.height = fit.h + 'px';
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gl.setSize(fit.w, fit.h); css.setSize(fit.w, fit.h);
    camera.aspect = fit.w / fit.h;
    camera.updateProjectionMatrix();
    if (!busy) { const v = viewOf(cur); aim(targetX(cur), v.pitch, v.yaw); }
    else aim(fit.tx, fit.pitch, fit.yaw);
  }
  function aim(tx, pitch, yaw) {
    fit.tx = tx; fit.pitch = pitch; fit.yaw = yaw;
    const D = (fit.h / fit.px / 2) / Math.tan(FOV * Math.PI / 360);
    const t = new Vector3(tx, 0, 0);
    camera.position.set(tx + D * Math.sin(yaw) * Math.cos(pitch), -D * Math.sin(pitch), D * Math.cos(pitch) * Math.cos(yaw));
    camera.lookAt(t);
    // Depth range hugging the book: with near=1 the depth buffer can't tell apart surfaces a fraction of a
    // unit apart at this distance, and a sheet lifting off or landing on its page z-fought with it (flicker).
    const near = Math.max(10, D - 1500), far = D + 1500;
    if (camera.near !== near || camera.far !== far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  /* ---------- render on demand ---------- */
  let needs = true, anims = [];
  const invalidate = () => { needs = true; };
  function tick(now) {
    if (anims.length) {
      for (const a of [...anims]) {
        const p = clamp((now - a.t0) / a.dur, 0, 1);
        a.step(a.ease(p), p);
        if (p >= 1) { anims.splice(anims.indexOf(a), 1); a.done && a.done(); }
      }
      needs = true;
    }
    if (needs) { gl.render(scene, camera); css.render(cssScene, camera); needs = false; }
    requestAnimationFrame(tick);
  }
  const animate = (dur, step, e = ease) => new Promise((done) => anims.push({ t0: performance.now(), dur, step, ease: e, done }));

  /* ---------- rest: show the live pages over the 3D ones ---------- */
  function showDom(c) {
    const put = (s, i, x, z) => {
      if (i == null) { s.obj.visible = false; if (s.page >= 0) meas.appendChild(pages[s.page].node); s.page = -1; return; }
      if (s.page !== i) { if (s.page >= 0) meas.appendChild(pages[s.page].node); s.el.appendChild(pages[i].node); s.page = i; }
      s.obj.visible = true;
      s.obj.position.set(x, 0, z + 0.2);

    };
    const st = restState(c), dl = blockDepth(st.nl), dr = blockDepth(st.nr);
    // left: the inside cover (board, c=1), a paper page, or the back cover lying shut on top
    if (c === 1) put(slotL, 1, -W / 2, BT);
    else if (c >= 2 && c <= S - 1) put(slotL, 2 * c - 1, -W / 2, BT + dl, false);
    else if (c === S) put(slotL, N - 1, -W / 2, 2 * BT + dl);
    else put(slotL, null);
    // right: the cover shut on top, a paper page, or the inside back cover
    if (c === 0) put(slotR, 0, W / 2, 2 * BT + dr);
    else if (c >= 1 && c <= S - 2) put(slotR, 2 * c, W / 2, BT + dr, false);
    else if (c === S - 1) put(slotR, N - 2, W / 2, BT);
    else put(slotR, null);
    host.classList.add('at-rest');
    // write the pages now open, and capture them written straight away, ready for the next turn
    for (const s of [slotL, slotR]) {
      const node = s.page >= 0 && pages[s.page].node, i = s.page;
      if (!node || node.dataset.draw !== 'pending') continue;
      T.playDraw(node);
      idle(() => texture(i).catch(() => {}));
    }
    invalidate();

  }
  function hideDom() { host.classList.remove('at-rest'); slotL.obj.visible = slotR.obj.visible = false; invalidate(); }

  /* ---------- turning ---------- */
  let busy = false;
  const FLIP_MS = 900, BOARD_MS = 1000;
  async function ready(list) { await Promise.all([...new Set(list.filter((i) => i != null && i >= 0 && i < N))].map((i) => texture(i))); }

  /* A paper sheet on its way from `from` to `to`, its corner (pulled from C0) now at C — both in the turning
     page's own coordinates (see curl.mjs). The stacks hand the sheet over as it goes (paperState); the part
     still lying down rests on the stack it came from, the part folded over rides above both stacks while it
     crosses and settles onto the one it lands on. The page it uncovers darkens along the crease. */
  const LIFT = 0.25 * H, ROLL = 40;
  const progOf = (C) => clamp((W - C.x) / (2 * W), 0, 1);
  function paperFrame(from, to, C0, C) {
    const fwd = to > from, q = progOf(C);
    const st = paperState(from, to, Math.PI * (fwd ? q : 1 - q));
    layout(st);
    const zR = BT + blockDepth(st.nr) + 0.12, zL = BT + blockDepth(st.nl) + 0.12;
    const src = fwd ? zR : zL, dst = fwd ? zL : zR;
    const flap = lerp(lerp(src, Math.max(zR, zL), smooth(q / 0.15)), dst, smooth((q - 0.85) / 0.15));
    // the roll is widest mid-turn and tightens as the sheet lifts off and settles, so it lands flat
    const f = foldOf(C0, C, 0.6 + ROLL * Math.sin(Math.PI * q) ** 2, H);
    const R = f ? Math.max(f.R, 0.3) : 1;
    // height of a point folded up by z: resting on its stack, then lifted onto the flap's level over the roll
    foldSheet(sheetGeo, f, !fwd, (X, z) => src + z + (flap - src) * smooth(z / (2 * R)),
      // (over the side it's landing on, the page there: so it has landed exactly where that page lies)
      { cx: camera.position.x, cz: camera.position.z, zref: (X) => lerp(src, dst, smooth((fwd ? -X : X) / 40)) });
    // shadows as in StPageFlip: an outer one on the page being uncovered, spreading as the sheet lifts
    // further, and an inner one on the folded-over flap along its crease (the unfolded part under the
    // flap gets it too, unseen)
    const m = fwd ? topR.material : topL.material, o = fwd ? topL.material : topR.material;
    o.uniforms.shadow.value.set(0, 0, 0, 0);
    const lift = Math.sin(Math.PI * q), wnx = fwd ? (f ? f.nx : 0) : -(f ? f.nx : 0);
    for (const mat of [m, sheetFront.material, sheetBack.material]) mat.uniforms.shadow.value.set(0, 0, 0, 0);
    if (f) {
      m.uniforms.shadow.value.set(wnx, f.ny, f.c, 0.12 + 0.33 * lift);
      m.uniforms.shadowW.value = 30 + 150 * lift;
      for (const mat of [sheetFront.material, sheetBack.material]) {
        mat.uniforms.shadow.value.set(-wnx, -f.ny, -f.c, 0.08 + 0.2 * lift);
        mat.uniforms.shadowW.value = 20 + 50 * lift;
      }
    }
  }

  // turn one sheet from `from` to `to` (to = from±1 normally; further for a jump, where the pages in between
  // just move with it). Boards turn rigid; paper is pulled over by its corner. `held`: a drag let go past
  // halfway, carried on from where the hand left it.
  async function turn(to, held = null) {
    const from = cur, fwd = to > from;
    const isFront = fwd ? from === 0 : to === 0, isBack = fwd ? to === S : from === S;
    const faceF = fwd ? 2 * from : 2 * to, faceB = fwd ? 2 * to - 1 : 2 * from - 1;   // what the moving sheet shows
    await ready([faceF, faceB, 2 * to - 1, 2 * to, 2 * from - 1, 2 * from, 0, 1, N - 2, N - 1]);
    hideDom();
    const a = restState(from), b = restState(to);
    side = fwd ? 'L' : 'R';
    const tx0 = fit.tx, tx1 = targetX(to), v0 = { pitch: fit.pitch, yaw: fit.yaw }, v1 = viewOf(to);
    const board = isFront ? front : isBack ? back : null;
    const phi0 = held ? held.phi : fwd ? 0 : Math.PI, phi1 = fwd ? Math.PI : 0;
    // paper: the corner's start and where it is now (a click pulls the bottom corner over an arc)
    const C0 = held && held.C0 ? held.C0 : { x: W, y: -H / 2 }, Cs = held && held.C ? held.C : null;
    const Ce = { x: -W, y: C0.y };
    const left = board ? Math.abs(phi1 - phi0) / Math.PI : Cs ? 1 - progOf(Cs) : 1;
    const dur = (board ? BOARD_MS : FLIP_MS) * Math.max(0.3, left);
    if (board) boardTurn(dur); else paperTurn(dur, !!held);
    if (!board) { setMap(sheetFront.material, faceF); setMap(sheetBack.material, faceB); }
    sheetFront.visible = sheetBack.visible = !board;
    await animate(dur, (e) => {
      if (board) {
        const phi = lerp(phi0, phi1, e);
        const st = { nl: a.nl, nr: a.nr, frontPhi: a.frontPhi, frontZ: a.frontZ, backPhi: a.backPhi, backZ: a.backZ,
          topL: fwd ? a.topL : b.topL, topR: fwd ? b.topR : a.topR };
        const z0 = boardHeight(board === front ? 'front' : 'back', phi, BT, blockDepth(P));
        if (board === front) { st.frontPhi = phi; st.frontZ = z0; } else { st.backPhi = phi; st.backZ = z0; }
        layout(st);
      }
      aim(lerp(tx0, tx1, e), lerp(v0.pitch, v1.pitch, e), lerp(v0.yaw, v1.yaw, e));
      if (!board) paperFrame(from, to, C0, Cs ? { x: lerp(Cs.x, Ce.x, e), y: lerp(Cs.y, Ce.y, e) } : cornerPath(e, W, H, LIFT));
    }, held ? easeOut : board ? ease : easePaper);
    cur = to;
    sheetFront.visible = sheetBack.visible = false;
    topL.material.uniforms.shadow.value.set(0, 0, 0, 0); topR.material.uniforms.shadow.value.set(0, 0, 0, 0);
    layout(restState(cur));
    showDom(cur); chrome(); warm(2 * cur);
  }

  const queue = []; let running = false, lastTurnEnd = 0;
  async function run() {
    if (running) return; running = true;
    while (queue.length) { const job = queue.shift(); busy = true; try { await job(); } catch (e) {
      console.error('techo: page turn failed', e);
      sheetFront.visible = sheetBack.visible = false;
      topL.material.uniforms.shadow.value.set(0, 0, 0, 0); topR.material.uniforms.shadow.value.set(0, 0, 0, 0);
      layout(restState(cur)); const v = viewOf(cur); aim(targetX(cur), v.pitch, v.yaw); showDom(cur);
    } busy = false; }
    running = false; lastTurnEnd = performance.now();
  }
  const enqueue = (job) => { queue.push(job); run(); };
  // go to `t` sheets turned: the boards turn on their own, the paper in between turns as one sheet
  function goTo(t) {
    if (drag && drag.moved) return;
    t = clamp(t, 0, S);
    enqueue(async () => {
      if (t === cur) return;
      if (t > cur) {
        if (cur === 0) await turn(1);
        if (t > cur && cur < S - 1) await turn(Math.min(t, S - 1));
        if (t === S && cur === S - 1) await turn(S);
      } else {
        if (cur === S) await turn(S - 1);
        if (t < cur && cur > 1) await turn(Math.max(t, 1));
        if (t === 0 && cur === 1) await turn(0);
      }
    });
  }
  // on a phone, move the view across the open spread to the other page
  function pan(sd) {
    enqueue(async () => {
      if (side === sd) return;
      side = sd;
      const tx0 = fit.tx, tx1 = targetX(cur);
      paperTurn(360, true);
      await animate(420, (e) => aim(lerp(tx0, tx1, e), fit.pitch, fit.yaw), ease);
      chrome();
    });
  }
  const opened = () => fit.portrait && cur >= 1 && cur <= S - 1;
  const next = () => { if (queue.length || busy) return; if (opened() && side === 'L') pan('R'); else goTo(cur + 1); };
  const prev = () => { if (queue.length || busy) return; if (opened() && side === 'R') pan('L'); else goTo(cur - 1); };

  /* ---------- pointer: click a side to turn, or drag a page by its edge ---------- */
  const ray = new Raycaster(), ndc = new Vector2(), plane = new Plane(new Vector3(0, 0, 1), 0), hit = new Vector3();
  function worldX(ev) {
    const r = gl.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, hit) ? hit.x : 0;
  }
  let drag = null;
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchend']) window.addEventListener(t, unlock, { passive: true });
  host.addEventListener('pointerdown', (ev) => {
    if (busy || drag || ev.button > 0) return;
    if (ev.target.closest && ev.target.closest('a,button,input,textarea,select,label,[contenteditable]')) return;
    const x = worldX(ev);
    if (Math.abs(x) > W + OH || Math.abs(hit.y) > H / 2 + OH) return;
    const r = host.getBoundingClientRect(), right = (ev.clientX - r.left) / r.width > 0.5;
    // on a phone the page in view is pulled by a finger anywhere on it, in the direction the finger goes;
    // elsewhere a page is dragged by its outer edge, and pressing further in leaves the text free to select
    const phone = fit.portrait, touch = ev.pointerType !== 'mouse';
    const fwd = phone ? right : x > 0;
    if (!phone && ((fwd && cur >= S) || (!fwd && cur <= 0))) return;
    const edge = (phone && touch) || Math.abs(x) / W > 0.78 || !ev.target.closest('.book3d-slot');
    drag = { x0: ev.clientX, fwd, edge, phone, moved: false, id: ev.pointerId, phi: fwd ? 0 : Math.PI, gx: x, gy: hit.y };
  });
  // start pulling: paper by the nearer corner of its outer edge, which then moves with the hand
  function grabPage(d) {
    const C0 = { x: W, y: d.gy > 0 ? H / 2 : -H / 2 };
    Object.assign(d, { C0, C: { ...C0 }, grab: { x: d.fwd ? d.gx : -d.gx, y: d.gy }, phi: d.fwd ? 0 : Math.PI });
  }
  host.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 8) return;
    if (!drag.edge) { drag = null; return; }          // selecting text, not turning
    if (!drag.moved && drag.phone) {
      // a phone: the finger's direction says which way; the page in view goes if it can, otherwise the view
      // just moves across the spread when the finger lets go
      drag.fwd = ev.clientX < drag.x0;
      const canPull = drag.fwd ? cur < S && (cur === 0 || side === 'R' || !opened()) : cur > 0 && (cur === S || side === 'L' || !opened());
      if (!canPull) { drag.moved = true; drag.swipe = true; host.setPointerCapture(ev.pointerId); return; }
    }
    if (drag.swipe) return;
    const to = drag.fwd ? cur + 1 : cur - 1;
    if (!drag.moved) {
      if (to < 0 || to > S) { drag = null; return; }
      grabPage(drag);
      drag.moved = true; host.setPointerCapture(ev.pointerId);
      const d = drag; d.to = to; busy = true;
      d.board = (d.fwd ? cur === 0 : cur === 1) ? 'front' : (d.fwd ? to === S : cur === S) ? 'back' : null;
      ready([2 * cur, 2 * cur - 1, 2 * to, 2 * to - 1]).then(() => {
        if (drag !== d) return;                       // let go already: endDrag turned it
        hideDom();
        setMap(sheetFront.material, d.fwd ? 2 * cur : 2 * to);
        setMap(sheetBack.material, d.fwd ? 2 * to - 1 : 2 * cur - 1);
        d.ready = true;
        renderDrag(d);
      }).catch((error) => {
        console.error('techo: drag textures failed', error);
        if (drag === d) { drag = null; busy = false; layout(restState(cur)); showDom(cur); }
      });
    }
    // a phone shows one page, so the finger's travel counts double: a swipe across the screen turns it
    const wx = worldX(ev), k = drag.phone ? 2 : 1, lx = drag.fwd ? wx : -wx;
    drag.C = constrain({ x: drag.C0.x + k * (lx - drag.grab.x), y: drag.C0.y + hit.y - drag.grab.y }, drag.C0, W, H);
    drag.phi = Math.acos(clamp((drag.fwd ? 1 : -1) * (drag.C0.x + k * (lx - drag.grab.x)) / W, -1, 1));
    if (drag.ready) renderDrag(drag);
  });
  function renderDrag(d, phi = d.phi, C = d.C) {
    sheetFront.visible = sheetBack.visible = !d.board;
    if (d.board) {
      const a = restState(cur), b = restState(d.to);
      const st = { nl: a.nl, nr: a.nr, frontPhi: a.frontPhi, frontZ: a.frontZ, backPhi: a.backPhi, backZ: a.backZ,
        topL: d.fwd ? a.topL : b.topL, topR: d.fwd ? b.topR : a.topR };
      st[d.board + 'Phi'] = phi;
      st[d.board + 'Z'] = boardHeight(d.board, phi, BT, blockDepth(P));
      layout(st);
    } else paperFrame(cur, d.to, d.C0, C);
    invalidate();
  }
  const endDrag = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag; drag = null; busy = false;
    if (host.hasPointerCapture(ev.pointerId)) host.releasePointerCapture(ev.pointerId);
    const cancelled = ev.type === 'pointercancel';
    if (d.swipe) { if (!cancelled) d.fwd ? next() : prev(); return; }
    if (!d.moved) {
      if (cancelled) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;               // a click that ends a text selection doesn't turn
      d.fwd ? next() : prev(); return;
    }
    const done = !cancelled && (d.board ? (d.fwd ? d.phi > Math.PI / 2 : d.phi < Math.PI / 2) : progOf(d.C) > 0.5);
    if (!d.ready) { if (done) goTo(d.to); return; }
    // past halfway it goes over; otherwise it falls back where it came from
    enqueue(() => (done ? turn(d.to, d) : turnBack(d)));
  };
  async function turnBack(d) {
    const phi0 = d.phi, phi1 = d.fwd ? 0 : Math.PI, C1 = { ...d.C };
    const ms = Math.max(220, 600 * (d.board ? Math.abs(phi1 - phi0) / Math.PI : 2 * progOf(C1) + 0.15));
    fallBack(ms);
    await animate(ms, (e) => {
      renderDrag(d, lerp(phi0, phi1, e), { x: lerp(C1.x, d.C0.x, e), y: lerp(C1.y, d.C0.y, e) });
    }, easeOut);
    sheetFront.visible = sheetBack.visible = false;
    layout(restState(cur)); showDom(cur);
  }
  host.addEventListener('pointerup', endDrag);
  // wheel / trackpad: add up the scroll, one page per notch-worth, and ignore the tail of a trackpad's
  // momentum while a page is turning and for a moment after
  let wheelSum = 0, wheelQuiet = 0;
  host.addEventListener('wheel', (ev) => {
    // Vertical scrolling belongs to the document; horizontal swipes turn pages.
    if (Math.abs(ev.deltaY) >= Math.abs(ev.deltaX)) return;
    ev.preventDefault();
    const now = performance.now();
    if (busy || queue.length || now < wheelQuiet || now < lastTurnEnd + 300) { wheelSum = 0; return; }
    const d = Math.abs(ev.deltaY) >= Math.abs(ev.deltaX) ? ev.deltaY : ev.deltaX;
    wheelSum += ev.deltaMode === 1 ? d * 16 : d;
    if (Math.abs(wheelSum) < 60) return;
    const fwd = wheelSum > 0; wheelSum = 0;
    if (fwd ? cur >= S : cur <= 0) return;
    wheelQuiet = now + 350;
    fwd ? next() : prev();
  }, { passive: false });
  host.addEventListener('pointercancel', endDrag);

  /* ---------- chrome: date chips, arrows, restart, drag hint ---------- */
  const chips = [{ label: '封面', page: 0 }];
  pages.forEach((p, i) => { if (p.label) chips.push({ label: p.label, page: i }); });
  const sheetOf = (page) => (page === 0 ? 0 : Math.ceil(page / 2));
  chips.forEach((c) => {
    const b = T.el('button', null, c.label); b.type = 'button'; b.dataset.page = c.page;
    b.onclick = () => {
      const t = sheetOf(c.page), sd = c.page % 2 ? 'L' : 'R';
      goTo(t); if (fit.portrait) pan(sd);                 // turn there, then look at that page
    };
    dots.appendChild(b);
  });
  function chrome() {
    dragnote.hidden = cur !== 0 || fit.portrait;
    restart.hidden = cur < S;
    [...dots.children].forEach((b) => {
      const pg = +b.dataset.page;
      const on = sheetOf(pg) === cur && (!fit.portrait || cur <= 0 || cur >= S || (pg % 2 ? 'L' : 'R') === side);
      b.setAttribute('aria-current', on ? 'true' : 'false');
      if (on && dots.scrollWidth > dots.clientWidth) dots.scrollLeft = b.offsetLeft - dots.clientWidth / 2 + b.offsetWidth / 2;
    });
    $('prev').disabled = cur === 0; $('next').disabled = cur >= S;
  }
  $('prev').onclick = prev; $('next').onclick = next;
  const sound = T.el('button', 'arrow sound');
  sound.type = 'button';
  const showSound = () => { const v = soundOn(); sound.textContent = '♪'; sound.setAttribute('aria-pressed', String(v)); sound.setAttribute('aria-label', v ? '关闭翻页声' : '打开翻页声'); sound.title = sound.getAttribute('aria-label'); };
  sound.onclick = () => { setSound(!soundOn()); showSound(); };
  showSound(); nav.appendChild(sound);
  restart.onclick = () => goTo(0);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  });

  /* ---------- go ---------- */
  frame();
  await ready([0, 1, N - 2, N - 1, 2]);   // the covers first: that's what you see on arrival
  layout(restState(0));
  aim(targetX(0), VIEW.front.pitch, VIEW.front.yaw);
  showDom(0); chrome();
  nav.hidden = false;
  requestAnimationFrame((now) => {
    tick(now);                                           // first complete frame drawn: now show it
    host.classList.add('ready');
    const loading = $('loading'); if (loading) loading.remove();
  });
  new ResizeObserver(() => { frame(); invalidate(); }).observe(stage);
  warm(0);
  window.__book3d = { goTo, get cur() { return cur; }, S, invalidate, scene, camera, gl, slots: [slotL, slotR], parts: { front, back, blockL, blockR, topL, topR, sheetFront } };   // for debugging
}
