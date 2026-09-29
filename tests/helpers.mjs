/* Shared by the tests: the Worker's TypeScript modules, run as they are, and functions that live inside the
   browser scripts (which have no module system), taken out of their source by markers. */
import { buildSync } from 'esbuild';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
