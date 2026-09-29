/* Shared by the tests: the Worker's TypeScript modules, run as they are, and functions that live inside the
   browser scripts (which have no module system), taken out of their source by markers. */
import { buildSync } from 'esbuild';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// (the Workers runtime has crypto.subtle.timingSafeEqual, Node keeps it in node:crypto)
if (!crypto.subtle.timingSafeEqual) crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a.buffer ?? a), Buffer.from(b.buffer ?? b));

const root = (p) => fileURLToPath(new URL('../' + p, import.meta.url));

/** a src/*.ts module, bundled with esbuild and imported */
export async function loadTs(path) {
  const out = buildSync({ entryPoints: [root(path)], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}

/** the text of a browser script from `from` up to (not including) `to`; either marker missing is a failure, so
    a reshuffled script breaks the test loudly instead of quietly testing nothing */
export function slice(path, from, to) {
  const src = readFileSync(root(path), 'utf8');
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`${path}: can't find ${a < 0 ? JSON.stringify(from) : JSON.stringify(to)}`);
  return src.slice(a, b);
}

/** run fetch as `route(url, init)` answers it, for the duration of `fn` */
export async function withFetch(route, fn) {
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, init = {}) => { seen.push({ url: String(url), init }); return route(String(url), init); };
  try { return await fn(seen); } finally { globalThis.fetch = real; }
}

export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
export const redirect = (to) => new Response(null, { status: 302, headers: { location: to } });

/** the Worker's app (src/index.ts, the default export's routes), bundled with everything it imports; `app` is
    exported from a copy of the entry, so the source doesn't have to export it */
export async function loadApp() {
  const dir = mkdtempSync(join(tmpdir(), 'techo-src-'));
  cpSync(root('src'), dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), readFileSync(join(dir, 'index.ts'), 'utf8') + '\nexport const __app = app;\n');
  const out = buildSync({ entryPoints: [join(dir, 'index.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', nodePaths: [root('node_modules')] });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  return mod.__app;
}

/** a D1 look-alike over real SQLite (node:sqlite) with the schema in schema.sql, holding `entries` and `locks`: the
    Worker's SQL is run, not imitated. `log`, when given, gets {sql, rows} for every statement run. */
export async function sqliteD1({ entries = [], locks = [], log = null } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(root('schema.sql'), 'utf8'));
  const cols = ['id', 'date', 'title', 'latin', 'stamp', 'aside', 'body', 'note', 'mood', 'quote', 'quote_src', 'photo_key', 'photo_cap', 'stickers', 'status', 'place', 'geo', 'weather', 'created_at', 'updated_at'];
  const put = db.prepare(`INSERT INTO entries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  for (const e of entries) put.run(...cols.map((c) => e[c] ?? ''));
  for (const l of locks) db.prepare('INSERT INTO locks (scope, hash, updated_at) VALUES (?, ?, 0)').run(l.scope, l.hash);
  const note = (sql, rows) => { if (log) log.push({ sql, rows }); };
  const make = (sql, args) => {
    const st = db.prepare(sql);
    const s = {
      bind: (...a) => make(sql, a),   // (a new statement each time, as D1's)
      all: async () => { const results = st.all(...args).map((r) => ({ ...r })); note(sql, results.length); return { results }; },
      first: async () => { const r = st.get(...args); note(sql, r ? 1 : 0); return r ? { ...r } : null; },
      run: async () => { st.run(...args); note(sql, 0); return {}; },
    };
    return s;
  };
  return { prepare: (sql) => make(sql, []), batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; } };
}

/** the Workers runtime has HTMLRewriter, Node doesn't: this one only puts what the boot.js handler adds in front of
    that script (enough for the home page's data and ETag) */
export function installHtmlRewriter() {
  globalThis.HTMLRewriter = class {
    constructor() { this.handlers = []; }
    on(selector, h) { this.handlers.push([selector, h]); return this; }
    transform(res) {
      const handlers = this.handlers;
      return new Response(new ReadableStream({ async start(ctrl) {
        let text = await res.text();
        for (const [selector, h] of handlers) {
          const el = { setInnerContent() {}, setAttribute() {}, after() {}, before: (html) => { text = text.replace(/<script src="\/assets\/boot\.js[^>]*>/, (m) => html + m); } };
          if (!selector.includes('boot.js') || h.element) h.element(el);
        }
        ctrl.enqueue(new TextEncoder().encode(text)); ctrl.close();
      } }), { status: res.status, headers: res.headers });
    }
  };
}

/** an in-memory Cache API (Node has none), installed as `caches`; `keys()` lists what is kept */
export function installCaches() {
  const kept = new Map();
  globalThis.caches = { default: {
    async match(req) { const r = kept.get(new Request(req).url); return r ? new Response(r.buf, { headers: r.headers }) : undefined; },
    async put(req, res) { kept.set(new Request(req).url, { buf: await res.arrayBuffer(), headers: [...res.headers] }); },
  } };
  return { keys: () => [...kept.keys()], size: () => kept.size };
}
