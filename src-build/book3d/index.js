/* The journal as a three.js book: boards with real thickness, page blocks whose depth follows your place in
   the book, and paper that bends as it turns. At rest the two open pages are the live web pages, laid over the
   3D pages with the same camera (CSS3DRenderer), so text stays crisp, selectable and clickable and the draw-in
   still plays; while a sheet turns, WebGL shows rasterised copies of the pages (raster.js).

   Layout (world units = page px): spine at x=0, the book lies in the XY plane, +z points up off the desk
   towards the viewer. A "sheet" is a pair of pages, front = right-hand page (even index), back = left-hand
   page (odd index). Sheet 0 is the front board (cover / inside cover), the last sheet the back board.
   `cur` = sheets turned to the left: 0 shut on the cover, S shut on the back. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BoxGeometry, PlaneGeometry, BufferGeometry,
  BufferAttribute, ShaderMaterial, CanvasTexture, Vector2, Vector3, Raycaster, Plane, FrontSide, BackSide,
  LinearMipmapLinearFilter, LinearFilter, NoColorSpace, LinearSRGBColorSpace, Color,
} from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { rasterize, PAGE_W as W, PAGE_H as H } from './raster.js';

const OH = 6;          // boards overhang the pages
const BT = 7;          // board thickness
const SHEET = 2.4;     // one paper sheet in the page block
const MIN_BLOCK = 28;  // the page block never looks thinner than this
const FOV = 18, DEG = Math.PI / 180;
/* The camera: shut, the book is shown at a three-quarter angle, like a photo of it on the desk, so its
   thickness shows (the back cover from the other side, its fore-edge being on the left). Open, it turns to
   nearly face-on, so the live pages read straight. Head-on, no book has any visible thickness. */
const VIEW = { front: { pitch: 22 * DEG, yaw: 20 * DEG }, open: { pitch: 8 * DEG, yaw: 0 }, back: { pitch: 22 * DEG, yaw: -20 * DEG } };
const CLOTH = new Color('#2b454b'), CLOTH_EDGE = new Color('#314d53'), PAPER = new Color('#f6f1e2');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- one shader for paper, boards and blocks: flat towards the viewer is exactly the texture
   (so a rasterised page matches the live page it replaces), tilting away darkens it. ---------- */
function material({ map = null, color = PAPER, flipU = false, stripes = false, side = FrontSide } = {}) {
  return new ShaderMaterial({
    side,
    uniforms: {
      map: { value: map }, useMap: { value: map ? 1 : 0 }, color: { value: color.clone() },
      flipU: { value: flipU ? 1 : 0 }, stripes: { value: stripes ? 1 : 0 }, stripeGap: { value: SHEET },
      shadow: { value: new Vector3(0, 0, 0) }, // x0, x1 (world x of the shade's fade), strength
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
      uniform sampler2D map; uniform float useMap, flipU, stripes, stripeGap; uniform vec3 color, shadow;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){
        vec2 uv = vUv; if (flipU > 0.5) uv.x = 1.0 - uv.x;
        vec3 base = useMap > 0.5 ? texture2D(map, uv).rgb : color;
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        // light from over the reader's shoulder: a face turned half away is only a little darker, never a grey slab
        vec3 L = normalize(vec3(-0.25, 0.3, 1.0));
        float shade = min(0.7 + 0.3 * max(dot(n, L), 0.0) / L.z, 1.05);
        if (stripes > 0.5 && abs(n.z) < 0.5) base *= mix(0.84, 1.0, smoothstep(0.0, 0.45, fract(vW.z / stripeGap)));
        if (shadow.z > 0.0) shade *= 1.0 - shadow.z * (1.0 - clamp((vW.x - shadow.x) / (shadow.y - shadow.x), 0.0, 1.0));
        gl_FragColor = vec4(base * shade, 1.0);
      }`,
  });
}

/* a sheet of paper as a strip from the spine (s=0) to the fore-edge (s=W), bent each frame */
const SEG = 40;
function sheetGeometry() {
  const g = new BufferGeometry();
  const pos = new Float32Array((SEG + 1) * 2 * 3), nor = new Float32Array(pos.length), uv = new Float32Array((SEG + 1) * 2 * 2);
  const idx = [];
  for (let i = 0; i <= SEG; i++) {
    uv.set([i / SEG, 0, i / SEG, 1], i * 4);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
/* phi: 0 lying on the right … PI lying on the left. curl: how far the fore-edge trails the spine end. The
   shape depends only on phi, never on the direction: turning back is exactly turning forward played in
   reverse, so both look the same (on a phone too). z0: height of the spine end. */
function bendSheet(g, phi, curl, z0) {
  const pos = g.attributes.position.array, nor = g.attributes.normal.array, ds = W / SEG;
  let x = 0, z = z0;
  for (let i = 0; i <= SEG; i++) {
    const s = i / SEG;
    const th = clamp(phi - curl * Math.sin(phi) * s * s, 0, Math.PI);
    if (i > 0) {
      const sp = (i - 0.5) / SEG, thm = clamp(phi - curl * Math.sin(phi) * sp * sp, 0, Math.PI);
      x += Math.cos(thm) * ds; z += Math.sin(thm) * ds;
    }
    const nx = -Math.sin(th), nz = Math.cos(th);
    pos.set([x, -H / 2, z, x, H / 2, z], i * 6);
    nor.set([nx, 0, nz, nx, 0, nz], i * 6);
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.computeBoundingSphere();
  return { edgeX: x };
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

  /* ---------- the book's content (shared with the page-flip book) ---------- */
  const { pages } = await T.loadBook(src);
  const N = pages.length, S = N / 2, P = Math.max(0, S - 2);
  const meas = T.measure();
  pages.forEach((p) => meas.appendChild(p.node));
  pages.forEach((p) => { if (p.node.classList.contains('day') || p.node.classList.contains('jp')) T.prepDraw(p.node); });
  src.remove();

  /* ---------- page textures: rasterised on demand, re-done once a page has written itself ---------- */
  const scale = () => clamp(fit.px * Math.min(window.devicePixelRatio || 1, 2), 1, 2);
  const tex = new Map(); // i -> {state, promise, texture}
  const drawState = (i) => pages[i].node.dataset.draw || 'none';
  function texture(i) {
    const cur = tex.get(i);
    if (cur && cur.state === drawState(i)) return cur.promise;
    const state = drawState(i);
    const promise = rasterize(pages[i].node, scale()).then((canvas) => {
      const t = new CanvasTexture(canvas);
      t.colorSpace = NoColorSpace;
      t.anisotropy = gl.capabilities.getMaxAnisotropy();
      t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
      const old = tex.get(i);
      if (old && old.texture && old.texture !== t) old.texture.dispose();
      tex.set(i, { state, promise, texture: t });
      return t;
    });
    tex.set(i, { state, promise, texture: cur && cur.texture });
    return promise;
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
    const top = material({ color: CLOTH }), bottom = material({ color: CLOTH });
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
    topL.visible = state.topL != null && dl > 0.01; topL.position.z = BT + dl + 0.05; setMap(topL.material, state.topL);
    topR.visible = state.topR != null && dr > 0.01; topR.position.z = BT + dr + 0.05; setMap(topR.material, state.topR);
    placeBoard(front, state.frontPhi, state.frontZ);
    placeBoard(back, state.backPhi, state.backZ);
    setMap(front.top, 0); setMap(front.bottom, 1); setMap(back.top, N - 2); setMap(back.bottom, N - 1);
    // the desk shadow spans whatever lies on the desk: the left half once anything has turned, the right
    // half until everything has
    const lo = state.frontPhi > 0.01 || state.nl > 0.01 || state.backPhi > 0.01 ? -(W + OH) : 0;
    const hi = state.nr > 0.01 || state.backPhi < Math.PI - 0.01 || state.frontPhi < Math.PI - 0.01 ? W + OH : 0;
    deskShadow.scale.set((hi - lo) * 1.12, (H + 2 * OH) * 1.18, 1);
    deskShadow.position.set((hi + lo) / 2, -8, -0.5);
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
  const targetX = (c) => (fit.portrait ? W / 2 : c <= 0 ? W / 2 : c >= S ? -W / 2 : 0);
  const viewOf = (c) => (c <= 0 ? VIEW.front : c >= S ? VIEW.back : VIEW.open);
  function frame() {
    const r = stage.getBoundingClientRect();
    fit.portrait = r.width < 640;
    const spanW = fit.portrait ? W + 2 * OH + 20 : 2 * (W + OH) + 30, spanH = H + 2 * OH + 40;
    const w = Math.round(r.width), h = Math.round(Math.min(window.innerHeight - 140, r.width * spanH / spanW));
    fit.px = Math.min(w / spanW, h / spanH);
    fit.w = w; fit.h = Math.max(200, h);
    host.style.height = fit.h + 'px';
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gl.setSize(fit.w, fit.h); css.setSize(fit.w, fit.h);
    camera.aspect = fit.w / fit.h;
    camera.updateProjectionMatrix();
    aim(fit.tx, fit.pitch, fit.yaw);
  }
  function aim(tx, pitch, yaw) {
    fit.tx = tx; fit.pitch = pitch; fit.yaw = yaw;
    const D = (fit.h / fit.px / 2) / Math.tan(FOV * Math.PI / 360);
    const t = new Vector3(tx, 0, 0);
    camera.position.set(tx + D * Math.sin(yaw) * Math.cos(pitch), -D * Math.sin(pitch), D * Math.cos(pitch) * Math.cos(yaw));
    camera.lookAt(t);
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
    const put = (s, i, x, z, isBoard) => {
      if (i == null) { s.obj.visible = false; if (s.page >= 0) meas.appendChild(pages[s.page].node); s.page = -1; return; }
      if (s.page !== i) { if (s.page >= 0) meas.appendChild(pages[s.page].node); s.el.appendChild(pages[i].node); s.page = i; }
      s.obj.visible = true;
      s.obj.position.set(x, 0, z + 0.2);
      s.obj.scale.set(isBoard ? (W + OH + 1) / W : 1, isBoard ? (H + 2 * OH) / H : 1, 1);
      T.playDraw(pages[i].node);
    };
    const st = restState(c), dl = blockDepth(st.nl), dr = blockDepth(st.nr);
    // left: the inside cover (board, c=1), a paper page, or the back cover lying shut on top
    if (c === 1) put(slotL, 1, -(W + OH - 1) / 2, BT, true);
    else if (c >= 2 && c <= S - 1) put(slotL, 2 * c - 1, -W / 2, BT + dl, false);
    else if (c === S) put(slotL, N - 1, -(W + OH - 1) / 2, 2 * BT + dl, true);
    else put(slotL, null);
    // right: the cover shut on top, a paper page, or the inside back cover
    if (c === 0) put(slotR, 0, (W + OH - 1) / 2, 2 * BT + dr, true);
    else if (c >= 1 && c <= S - 2) put(slotR, 2 * c, W / 2, BT + dr, false);
    else if (c === S - 1) put(slotR, N - 2, (W + OH - 1) / 2, BT, true);
    else put(slotR, null);
    host.classList.add('at-rest');
    invalidate();
    // once the draw-in has written the pages, refresh their textures for the next turn
    setTimeout(() => { [slotL.page, slotR.page].filter((i) => i >= 0).forEach((i) => texture(i).then(invalidate)); }, 3200);
  }
  function hideDom() { host.classList.remove('at-rest'); slotL.obj.visible = slotR.obj.visible = false; invalidate(); }

  /* ---------- turning ---------- */
  let busy = false;
  const FLIP_MS = 900, BOARD_MS = 1000;
  async function ready(list) { await Promise.all(list.filter((i) => i != null && i >= 0 && i < N).map((i) => texture(i).catch(() => null))); }

  // turn one sheet from `from` to `to` (to = from±1 normally; further for a jump, where the pages in between
  // just move with it). Boards turn rigid; paper bends.
  async function turn(to, fromPhi = null, soft = false) {
    const from = cur, fwd = to > from;
    const k = fwd ? from : to;                         // the sheet that moves (by its resting place)
    const isFront = fwd ? from === 0 : to === 0, isBack = fwd ? to === S : from === S;
    const faceF = fwd ? 2 * from : 2 * to, faceB = fwd ? 2 * to - 1 : 2 * from - 1;   // what the moving sheet shows
    await ready([faceF, faceB, 2 * to - 1, 2 * to, 2 * from - 1, 2 * from, 0, 1, N - 2, N - 1]);
    hideDom();
    const a = restState(from), b = restState(to);
    const tx0 = fit.tx, tx1 = targetX(to), v0 = { pitch: fit.pitch, yaw: fit.yaw }, v1 = viewOf(to);
    const phi0 = fromPhi != null ? fromPhi : fwd ? 0 : Math.PI, phi1 = fwd ? Math.PI : 0;
    const dur = (isFront || isBack ? BOARD_MS : FLIP_MS) * Math.max(0.3, Math.abs(phi1 - phi0) / Math.PI);
    const board = isFront ? front : isBack ? back : null;
    if (!board) { setMap(sheetFront.material, faceF); setMap(sheetBack.material, faceB); }
    sheetFront.visible = sheetBack.visible = !board;
    await animate(dur, (e) => {
      const phi = lerp(phi0, phi1, e), q = fwd ? phi / Math.PI : 1 - phi / Math.PI;   // q: how far the sheet has gone
      // The side a sheet leaves thins at once (the sheet is off it); the side it lands on thickens only as it
      // lands. A block growing under a sheet still in the air would show its bare top where a page belongs.
      const st = {
        nl: fwd ? (q < 1 ? a.nl : b.nl) : b.nl, nr: fwd ? b.nr : (q < 1 ? a.nr : b.nr),
        frontPhi: a.frontPhi, frontZ: a.frontZ, backPhi: a.backPhi, backZ: a.backZ,
        // under the moving sheet the destination pages are already there; the side it lands on keeps its page until covered
        topL: fwd ? a.topL : b.topL, topR: fwd ? b.topR : a.topR,
      };
      if (board) {
        const z0 = lerp(board === front ? a.frontZ : a.backZ, board === front ? b.frontZ : b.backZ, (1 - Math.cos(phi)) / 2);
        if (board === front) { st.frontPhi = phi; st.frontZ = z0; } else { st.backPhi = phi; st.backZ = z0; }
      }
      layout(st);
      if (!board) {
        const zR = BT + blockDepth(st.nr), zL = BT + blockDepth(st.nl);
        const { edgeX } = bendSheet(sheetGeo, phi, soft ? 0.5 : 0.85, lerp(zR, zL, (1 - Math.cos(phi)) / 2) + 0.3);
        // the sheet's shadow on the page it uncovers
        const m = fwd ? topR.material : topL.material, o = fwd ? topL.material : topR.material;
        o.uniforms.shadow.value.set(0, 0, 0);
        const lift = Math.sin(phi) * 0.35;
        if (fwd) m.uniforms.shadow.value.set(Math.max(edgeX, 0) - 40, Math.max(edgeX, 0) + 120, lift);
        else m.uniforms.shadow.value.set(Math.min(edgeX, 0) + 40, Math.min(edgeX, 0) - 120, lift);
      }
      aim(lerp(tx0, tx1, e), lerp(v0.pitch, v1.pitch, e), lerp(v0.yaw, v1.yaw, e));
    }, fromPhi != null ? easeOut : ease);
    cur = to;
    sheetFront.visible = sheetBack.visible = false;
    topL.material.uniforms.shadow.value.set(0, 0, 0); topR.material.uniforms.shadow.value.set(0, 0, 0);
    layout(restState(cur));
    showDom(cur); chrome(); warm(2 * cur);
  }

  const queue = []; let running = false, lastTurnEnd = 0;
  async function run() {
    if (running) return; running = true;
    while (queue.length) { const job = queue.shift(); busy = true; try { await job(); } catch (e) { console.error(e); } busy = false; }
    running = false; lastTurnEnd = performance.now();
  }
  const enqueue = (job) => { queue.push(job); run(); };
  // go to `t` sheets turned: the boards turn on their own, the paper in between turns as one sheet
  function goTo(t) {
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
  const next = () => { if (!queue.length && !busy) goTo(cur + 1); };
  const prev = () => { if (!queue.length && !busy) goTo(cur - 1); };

  /* ---------- pointer: click a side to turn, or drag a page by its edge ---------- */
  const ray = new Raycaster(), ndc = new Vector2(), plane = new Plane(new Vector3(0, 0, 1), 0), hit = new Vector3();
  function worldX(ev) {
    const r = gl.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, hit) ? hit.x : 0;
  }
  let drag = null;
  host.addEventListener('pointerdown', (ev) => {
    if (busy || ev.button > 0) return;
    if (ev.target.closest && ev.target.closest('a,button,input,textarea,select,label,[contenteditable]')) return;
    const x = worldX(ev);
    const fwd = x > 0;
    if ((fwd && cur >= S) || (!fwd && cur <= 0)) return;
    // a page is dragged by its outer edge; pressing further in leaves the text free to select
    const edge = Math.abs(x) / W > 0.78 || !ev.target.closest('.book3d-slot');
    drag = { x0: ev.clientX, fwd, edge, moved: false, id: ev.pointerId };
  });
  host.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 8) return;
    if (!drag.edge) { drag = null; return; }          // selecting text, not turning
    const to = drag.fwd ? cur + 1 : cur - 1;
    if (!drag.moved) {
      drag.moved = true; host.setPointerCapture(ev.pointerId);
      // paper follows the pointer; a board just turns
      const board = (drag.fwd && (cur === 0 || cur === S - 1)) || (!drag.fwd && (cur === 1 || cur === S));
      if (board) { drag = null; goTo(to); return; }
      const d = drag; d.to = to;
      ready([2 * cur, 2 * cur - 1, 2 * to, 2 * to - 1]).then(() => {
        if (drag !== d) return;                       // let go already: endDrag turned it
        hideDom();
        setMap(sheetFront.material, d.fwd ? 2 * cur : 2 * to);
        setMap(sheetBack.material, d.fwd ? 2 * to - 1 : 2 * cur - 1);
        d.ready = true;
      });
    }
    if (!drag.ready) return;
    const x = clamp(worldX(ev) / W, -1, 1);
    drag.phi = Math.acos(x);
    const a = restState(cur), b = restState(drag.to);
    const nl = drag.fwd ? a.nl : b.nl, nr = drag.fwd ? b.nr : a.nr;   // as in turn(): the leaving side thins at once
    layout({ nl, nr, frontPhi: a.frontPhi, frontZ: a.frontZ, backPhi: a.backPhi, backZ: a.backZ,
      topL: drag.fwd ? a.topL : b.topL, topR: drag.fwd ? b.topR : a.topR });
    const zR = BT + blockDepth(nr), zL = BT + blockDepth(nl);
    sheetFront.visible = sheetBack.visible = true;
    bendSheet(sheetGeo, drag.phi, 0.6, lerp(zR, zL, (1 - Math.cos(drag.phi)) / 2) + 0.3);
    invalidate();
  });
  const endDrag = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.moved) {
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;               // a click that ends a text selection doesn't turn
      d.fwd ? next() : prev(); return;
    }
    if (!d.ready) { goTo(d.to); return; }
    const done = d.fwd ? d.phi > Math.PI / 2 : d.phi < Math.PI / 2;
    // past halfway it goes over; otherwise it falls back where it came from
    enqueue(() => (done ? turn(d.to, d.phi, true) : turnBack(d, cur)));
  };
  async function turnBack(d, from) {
    const a = restState(from), phi0 = d.phi, phi1 = d.fwd ? 0 : Math.PI;
    await animate(Math.max(220, 600 * Math.abs(phi1 - phi0) / Math.PI), (e) => {
      const phi = lerp(phi0, phi1, e);
      const zR = BT + blockDepth(a.nr), zL = BT + blockDepth(a.nl);
      bendSheet(sheetGeo, phi, 0.5, lerp(zR, zL, (1 - Math.cos(phi)) / 2) + 0.3);
    }, easeOut);
    sheetFront.visible = sheetBack.visible = false;
    layout(restState(cur)); showDom(cur);
  }
  host.addEventListener('pointerup', endDrag);
  // wheel / trackpad: add up the scroll, one page per notch-worth, and ignore the tail of a trackpad's
  // momentum while a page is turning and for a moment after
  let wheelSum = 0, wheelQuiet = 0;
  host.addEventListener('wheel', (ev) => {
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
    b.onclick = () => goTo(sheetOf(c.page)); dots.appendChild(b);
  });
  function chrome() {
    dragnote.hidden = cur !== 0 || fit.portrait;
    restart.hidden = cur < S;
    [...dots.children].forEach((b) => {
      const on = sheetOf(+b.dataset.page) === cur;
      b.setAttribute('aria-current', on ? 'true' : 'false');
      if (on && dots.scrollWidth > dots.clientWidth) dots.scrollLeft = b.offsetLeft - dots.clientWidth / 2 + b.offsetWidth / 2;
    });
    $('prev').disabled = cur === 0; $('next').disabled = cur >= S;
  }
  $('prev').onclick = prev; $('next').onclick = next;
  restart.onclick = () => goTo(0);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  });

  /* ---------- go ---------- */
  document.body.classList.add('is-3d');
  stage.appendChild(host);
  frame();
  await ready([0, 1, N - 2, N - 1, 2]);   // the covers first: that's what you see on arrival
  layout(restState(0));
  aim(targetX(0), VIEW.front.pitch, VIEW.front.yaw);
  showDom(0); chrome();
  const loading = $('loading'); if (loading) loading.remove();
  nav.hidden = false;
  requestAnimationFrame(tick);
  new ResizeObserver(() => { frame(); invalidate(); }).observe(stage);
  warm(0);
  window.__book3d = { goTo, get cur() { return cur; }, S, invalidate };   // for debugging
}
