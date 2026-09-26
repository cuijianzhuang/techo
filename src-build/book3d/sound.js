/* Page sounds, synthesised with WebAudio (no files to load): a paper rustle as a sheet turns and a soft flap
   as it lands; a heavier swing and a low thump for the boards. Silent until the reader first touches the
   page (browsers only allow audio after a gesture). Muted state is remembered in localStorage. */
const KEY = 'techo-sound';
let ctx = null, noise = null, master = null;
let on = true;
try { on = localStorage.getItem(KEY) !== 'off'; } catch {}

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  // two seconds of soft (pinkish) noise, reused by every sound
  const len = ctx.sampleRate * 2; noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
    d[i] = (b0 + b1 + b2 + w * 0.05) * 0.9;
  }
  return ctx;
}
/* call from a user gesture: creates / resumes the audio context */
export function unlock() { if (!on) return; const c = audio(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
export const soundOn = () => on;
export function setSound(v) { on = v; try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch {} if (v) unlock(); }

function burst(t0, dur, { f0, f1, q = 0.9, peak, at = 0.2, type = 'bandpass' }) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + dur * at);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0, Math.random() * 1.2, dur + 0.05);
}
function ready() { return on && ctx && ctx.state === 'running'; }

/* a paper sheet turning for `ms` (soft: finishing a drag, the rustle already happened under the hand) */
export function paperTurn(ms, soft = false) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01, d = ms / 1000;
  if (!soft) burst(t, d * 0.55, { f0: 1400, f1: 3800, q: 0.7, peak: 0.16, at: 0.35 });   // lifting off
  burst(t + d * 0.3, d * 0.55, { f0: 3200, f1: 1100, q: 0.6, peak: soft ? 0.1 : 0.13, at: 0.3 });  // air through it
  burst(t + d * 0.86, 0.14, { f0: 900, f1: 500, q: 0.8, peak: 0.22, at: 0.12, type: 'lowpass' });  // lands
}
/* a board swinging over and landing */
export function boardTurn(ms) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01, d = ms / 1000;
  burst(t, d * 0.8, { f0: 500, f1: 1400, q: 0.6, peak: 0.07, at: 0.5 });
  const land = t + d * 0.93;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(120, land); o.frequency.exponentialRampToValueAtTime(48, land + 0.16);
  g.gain.setValueAtTime(0.0001, land); g.gain.exponentialRampToValueAtTime(0.5, land + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, land + 0.22);
  o.connect(g); g.connect(master); o.start(land); o.stop(land + 0.25);
  burst(land, 0.09, { f0: 700, f1: 300, q: 0.7, peak: 0.3, at: 0.08, type: 'lowpass' });
}
/* a dragged sheet let go and falling back */
export function fallBack(ms) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01, d = ms / 1000;
  burst(t + d * 0.75, 0.12, { f0: 800, f1: 450, q: 0.8, peak: 0.12, at: 0.15, type: 'lowpass' });
}
