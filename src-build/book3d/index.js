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
import { foldOf, constrain, cornerPath } from './curl.mjs';
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
      // a turning sheet is drawn as two flat pieces cut along the crease (in the page's own coordinates,
      // n·p = c): keep the side where d <= 0 (w > 0: the part still lying down) or d > 0 (w < 0: the flap)
      clip: { value: new Vector4(0, 0, 0, 0) },
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
      uniform sampler2D map; uniform float useMap, flipU, stripes, stripeGap; uniform vec3 color; uniform vec4 shadow, uvRect, clip; uniform float shadowW; uniform float backSide;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        if (clip.w != 0.0) {
          float d = vUv.x * ${W.toFixed(1)} * clip.x + (vUv.y - 0.5) * ${H.toFixed(1)} * clip.y - clip.z;
          if (clip.w > 0.0 ? d > 0.0 : d <= 0.0) discard;
        }
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

/* A turning sheet, as in StPageFlip: a flat fold. It is two flat pieces of the same page, cut exactly along
   the crease in the fragment shader (so the crease is a clean straight line): the part still lying where it
   was, and the flap, the page reflected across the crease, lying face down over it. Each is one quad. */
function quadGeometry() {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}
/* place a piece: f from foldOf (page coordinates, page on x 0…W); flap: reflected across the crease;
   mirror: the left page turned back (reflected about the spine, which also turns the paper over); z: its
   height; view {cx, cz, zref}: drawn where it would appear lying at height zref, so a raised flap never
   swells past the page's outline, and lands exactly where the page it becomes lies. */
function placePiece(g, f, flap, mirror, z, view) {
  const pos = g.attributes.position.array, nor = g.attributes.normal.array;
  const s = (view.cz - z) / (view.cz - view.zref);
  let k = 0;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    let px = u * W, py = (v - 0.5) * H;
    if (flap && f) { const d = px * f.nx + py * f.ny - f.c; px -= 2 * d * f.nx; py -= 2 * d * f.ny; }
    const X = mirror ? -px : px;
    pos[k * 3] = view.cx + (X - view.cx) * s; pos[k * 3 + 1] = py * s; pos[k * 3 + 2] = z;
    const nz = (flap ? -1 : 1) * (mirror ? -1 : 1);
    nor[k * 3] = 0; nor[k * 3 + 1] = 0; nor[k * 3 + 2] = nz;
    k++;
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
  const baseGeo = quadGeometry(), flapGeo = quadGeometry();
  const sheetFront = new Mesh(baseGeo, material({ side: FrontSide }));
  const sheetBack = new Mesh(baseGeo, material({ side: BackSide, flipU: true }));
  const flapFront = new Mesh(flapGeo, material({ side: FrontSide }));
  const flapBack = new Mesh(flapGeo, material({ side: BackSide, flipU: true }));
  const sheets = [sheetFront, sheetBack, flapFront, flapBack];
  const showSheet = (v) => { for (const m of sheets) m.visible = v; };
  // the sheet's two pages: front (its right-hand page) and back (its left-hand page), on both pieces
  const sheetPages = (front, back) => { setMap(sheetFront.material, front); setMap(flapFront.material, front); setMap(sheetBack.material, back); setMap(flapBack.material, back); };
  showSheet(false); book.add(...sheets);

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
  // CREASE: the fold's radius. Kept tiny, as in StPageFlip: a flat fold, its crease drawn by shadows; a
// bigger roll showed as a tube standing up out of the page.
const LIFT = 0.25 * H, CREASE = 2.5;
  const progOf = (C) => clamp((W - C.x) / (2 * W), 0, 1);
  function paperFrame(from, to, C0, C) {
    const fwd = to > from, q = progOf(C);
    const st = paperState(from, to, Math.PI * (fwd ? q : 1 - q));
    layout(st);
    const zR = BT + blockDepth(st.nr) + 0.12, zL = BT + blockDepth(st.nl) + 0.12;
    const src = fwd ? zR : zL, dst = fwd ? zL : zR;
    const flap = lerp(lerp(src, Math.max(zR, zL), smooth(q / 0.15)), dst, smooth((q - 0.85) / 0.15));
    const f = foldOf(C0, C, 0, H);
    const view = { cx: camera.position.x, cz: camera.position.z, zref: src };
    placePiece(baseGeo, f, false, !fwd, src, view);
    // the flap rides just above the part it folds over, and is drawn as lying on the page it's coming to
    placePiece(flapGeo, f, true, !fwd, Math.max(flap, src + CREASE), { ...view, zref: lerp(src, dst, smooth((q - 0.5) / 0.5)) });
    for (const m of [sheetFront, sheetBack]) m.material.uniforms.clip.value.set(f ? f.nx : 0, f ? f.ny : 0, f ? f.c : 0, f ? 1 : 0);
    for (const m of [flapFront, flapBack]) { m.material.uniforms.clip.value.set(f ? f.nx : 0, f ? f.ny : 0, f ? f.c : 0, -1); m.visible = !!f; }
    // shadows as in StPageFlip: an outer one on the page being uncovered, spreading as the sheet lifts
    // further, and an inner one on the folded-over flap along its crease (the unfolded part under the
    // flap gets it too, unseen)
    const m = fwd ? topR.material : topL.material, o = fwd ? topL.material : topR.material;
    o.uniforms.shadow.value.set(0, 0, 0, 0);
    const lift = Math.sin(Math.PI * q), wnx = fwd ? (f ? f.nx : 0) : -(f ? f.nx : 0);
    for (const mat of [m, ...sheets.map((x) => x.material)]) mat.uniforms.shadow.value.set(0, 0, 0, 0);
    if (f) {
      m.uniforms.shadow.value.set(wnx, f.ny, f.c, 0.12 + 0.33 * lift);
      m.uniforms.shadowW.value = 30 + 150 * lift;
      for (const mat of sheets.map((x) => x.material)) {
        mat.uniforms.shadow.value.set(-wnx, -f.ny, -f.c, 0.1 + 0.26 * lift);
        mat.uniforms.shadowW.value = 18 + 60 * lift;
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
    if (from === 0) T.dragNote(dragnote, false);          // the note drifts away as the cover lifts
    const phi0 = held ? held.phi : fwd ? 0 : Math.PI, phi1 = fwd ? Math.PI : 0;
    // paper: the corner's start and where it is now (a click pulls the bottom corner over an arc)
    const C0 = held && held.C0 ? held.C0 : { x: W, y: -H / 2 }, Cs = held && held.C ? held.C : null;
    const Ce = { x: -W, y: C0.y };
    const left = board ? Math.abs(phi1 - phi0) / Math.PI : Cs ? 1 - progOf(Cs) : 1;
    const dur = (board ? BOARD_MS : FLIP_MS) * Math.max(0.3, left);
    if (board) boardTurn(dur); else paperTurn(dur, !!held);
    if (!board) sheetPages(faceF, faceB);
    showSheet(!board);
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
    showSheet(false);
    topL.material.uniforms.shadow.value.set(0, 0, 0, 0); topR.material.uniforms.shadow.value.set(0, 0, 0, 0);
    layout(restState(cur));
    showDom(cur); chrome(); warm(2 * cur);
  }

  const queue = []; let running = false, lastTurnEnd = 0;
  async function run() {
    if (running) return; running = true;
    while (queue.length) { const job = queue.shift(); busy = true; try { await job(); } catch (e) {
      console.error('techo: page turn failed', e);
      showSheet(false);
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
      drag.moved = true; host.setPointerCapture(ev.pointerId); T.dragNote(dragnote, false);
      const d = drag; d.to = to; busy = true;
      d.board = (d.fwd ? cur === 0 : cur === 1) ? 'front' : (d.fwd ? to === S : cur === S) ? 'back' : null;
      ready([2 * cur, 2 * cur - 1, 2 * to, 2 * to - 1]).then(() => {
        if (drag !== d) return;                       // let go already: endDrag turned it
        hideDom();
        sheetPages(d.fwd ? 2 * cur : 2 * to, d.fwd ? 2 * to - 1 : 2 * cur - 1);
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
    showSheet(!d.board);
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
    showSheet(false);
    layout(restState(cur)); showDom(cur);
  }
  host.addEventListener('pointerup', endDrag);
  // wheel / trackpad over the book turns pages (down or right: on; up or left: back): add up the scroll,
  // one page per notch-worth, and ignore the tail of a trackpad's momentum while a page is turning and for
  // a moment after
  let wheelSum = 0, wheelQuiet = 0;
  host.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey) return;                              // pinch-zoom stays the browser's
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
  // open the book at page i: turn there, then (on a phone) look at that page
  function openPage(i) { goTo(sheetOf(i)); if (fit.portrait) pan(i % 2 ? 'L' : 'R'); }
  chips.forEach((c) => {
    const b = T.el('button', null, c.label); b.type = 'button'; b.dataset.page = c.page;
    b.onclick = () => openPage(c.page);
    dots.appendChild(b);
  });

  /* ---------- any day: a calendar in the nav, and a link (#2026-09-27) for every diary page ---------- */
  const dated = pages.map((p, i) => ({ i, date: p.date })).filter((d) => d.date);
  // the page for a day: that day's, or the first one written after it (or the last there is)
  const pageFor = (day) => (dated.find((d) => d.date >= day) || dated[dated.length - 1] || {}).i;
  function openDay(day) { const i = pageFor(day); if (i != null) openPage(i); }
  if (dated.length) {
    const cal = T.el('button', 'arrow daypick'); cal.type = 'button';
    cal.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    cal.setAttribute('aria-label', '跳到某一天'); cal.title = '跳到某一天';
    cal.setAttribute('aria-haspopup', 'dialog'); cal.setAttribute('aria-expanded', 'false');
    /* a little paper calendar, like the one in a page's corner: the days with a diary page are marked and
       can be picked, the day open now is circled red; ‹ › go through the months that have pages */
    const pop = T.el('div', 'daypop'); pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '跳到某一天');
    const have = new Set(dated.map((d) => d.date));
    const months = [...new Set(dated.map((d) => d.date.slice(0, 7)))];
    let shown = months[months.length - 1];
    const pad = (n) => String(n).padStart(2, '0');
    function paintCal() {
      const [y, mo] = shown.split('-').map(Number), mi = months.indexOf(shown);
      pop.textContent = '';
      const head = T.el('div', 'dp-head');
      const pv = T.el('button', 'dp-nav', '‹'), nx = T.el('button', 'dp-nav', '›');
      pv.type = nx.type = 'button'; pv.setAttribute('aria-label', '上个月'); nx.setAttribute('aria-label', '下个月');
      pv.disabled = mi <= 0; nx.disabled = mi >= months.length - 1;
      pv.onclick = () => { shown = months[mi - 1]; paintCal(); };
      nx.onclick = () => { shown = months[mi + 1]; paintCal(); };
      const title = T.el('div', 'dp-title');
      title.append(T.el('b', null, String(mo)), T.el('span', null, '月'), T.el('i', null, y + ' · ' + ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'][mo - 1]));
      head.append(pv, title, nx);
      const grid = T.el('div', 'dp-grid');
      '一二三四五六日'.split('').forEach((c) => grid.appendChild(T.el('span', 'dp-wd', c)));
      const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), off = (first + 6) % 7, n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      for (let i = 0; i < off; i++) grid.appendChild(T.el('span'));
      const iv = pageInView(), now = iv >= 0 && pages[iv] && pages[iv].date;
      for (let d = 1; d <= n; d++) {
        const day = y + '-' + pad(mo) + '-' + pad(d);
        if (!have.has(day)) { grid.appendChild(T.el('span', 'dp-off', String(d))); continue; }
        const b = T.el('button', 'dp-day' + (day === now ? ' dp-now' : ''), String(d)); b.type = 'button';
        b.setAttribute('aria-label', mo + '月' + d + '日');
        if (day === now) b.setAttribute('aria-current', 'date');
        b.onclick = () => { close(); openDay(day); };
        grid.appendChild(b);
      }
      pop.append(head, grid, T.el('div', 'dp-foot', '点有小圆点的日子翻过去'));
    }
    const onDoc = (e) => { if (!box.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); cal.focus(); } };
    function open() {
      const iv = pageInView(), now = iv >= 0 && pages[iv] && pages[iv].date;
      shown = now ? now.slice(0, 7) : months[months.length - 1];
      paintCal(); pop.hidden = false; cal.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey);
      const f = pop.querySelector('.dp-now') || pop.querySelector('.dp-day'); if (f) f.focus({ preventScroll: true });
    }
    function close() {
      pop.hidden = true; cal.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey);
    }
    cal.onclick = () => (pop.hidden ? open() : close());
    const box = T.el('span', 'calbox'); box.append(cal, pop);
    nav.insertBefore(box, $('next').nextSibling);
  }
  // the page in view, for the link: on a phone the one looked at, otherwise the spread's dated page
  function pageInView() {
    if (cur <= 0 || cur >= S) return -1;
    if (fit.portrait) return side === 'L' ? 2 * cur - 1 : 2 * cur;
    return pages[2 * cur - 1] && pages[2 * cur - 1].date ? 2 * cur - 1 : 2 * cur;
  }
  function syncLink() {
    const i = pageInView(), day = i >= 0 && pages[i] && pages[i].date;
    const want = day ? '#' + day : '';
    if (location.hash !== want) history.replaceState(null, '', location.pathname + location.search + want);
  }
  const hashDay = () => (/^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash) || [])[1];
  // #contact: the 写信给我 page (linked from the 404 page)
  const contactPage = pages.findIndex((p) => p.node.querySelector && p.node.querySelector('#mail'));
  const openHash = () => { const d = hashDay(); if (d) openDay(d); else if (location.hash === '#contact' && contactPage >= 0) openPage(contactPage); };
  const arrivalHash = location.hash;                     // read before the cover's own (empty) link replaces it
  window.addEventListener('hashchange', openHash);
  function chrome() {
    T.dragNote(dragnote, cur === 0 && !fit.portrait);
    restart.hidden = cur < S;
    [...dots.children].forEach((b) => {
      const pg = +b.dataset.page;
      const on = sheetOf(pg) === cur && (!fit.portrait || cur <= 0 || cur >= S || (pg % 2 ? 'L' : 'R') === side);
      b.setAttribute('aria-current', on ? 'true' : 'false');
      if (on && dots.scrollWidth > dots.clientWidth) dots.scrollLeft = b.offsetLeft - dots.clientWidth / 2 + b.offsetWidth / 2;
    });
    $('prev').disabled = cur === 0; $('next').disabled = cur >= S;
    syncLink();
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
  if (arrivalHash) { history.replaceState(null, '', location.pathname + location.search + arrivalHash); openHash(); }   // arrived by a link: open the book there
  window.__book3d = { goTo, get cur() { return cur; }, S, invalidate, scene, camera, gl, slots: [slotL, slotR], parts: { front, back, blockL, blockR, topL, topR, sheetFront } };   // for debugging
}
