/* public/ on a VPS: what Cloudflare's static assets do for the Worker (env.ASSETS.fetch). index.html for a folder
   (/timeline/), /timeline sent on to /timeline/, the headers in public/_headers, an ETag and 304, and 404.html with
   a 404 for what isn't there. */
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml',
};

/** public/_headers: "/path/*" lines, each followed by indented "Name: value" lines */
function readHeaders(dir) {
  let text = '';
  try { text = readFileSync(join(dir, '_headers'), 'utf8'); } catch { return []; }
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { rules.push({ match: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: [] }); continue; }
    const i = line.indexOf(':');
    if (i > 0 && rules.length) rules.at(-1).headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}

export function staticAssets(dir) {
  dir = resolve(dir);
  const rules = readHeaders(dir);
  const fileAt = (path) => {
    const p = resolve(dir, '.' + path);
    if (!p.startsWith(dir + sep) && p !== dir) return null;
    if (/(^|\/)[._]/.test(path)) return null;   // _headers, dotfiles
    try { const s = statSync(p); return { p, s }; } catch { return null; }
  };
  const send = async (req, path, p, s, status = 200) => {
    const h = new Headers({ 'content-type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream', 'cache-control': 'public, max-age=0, must-revalidate' });
    for (const r of rules) if (r.match.test(path)) for (const [k, v] of r.headers) h.set(k, v);
    const etag = `"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`;
    h.set('etag', etag);
    if (status === 200 && (req.headers.get('if-none-match') || '').split(/,\s*/).includes(etag)) return new Response(null, { status: 304, headers: h });
    return new Response(req.method === 'HEAD' ? null : await readFile(p), { status, headers: h });
  };
  return {
    async fetch(input) {
      const req = input instanceof Request ? input : new Request(input);
      const url = new URL(req.url);
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { path = '/'; }
      let f = fileAt(path);
      if (f && f.s.isDirectory()) {
        if (!path.endsWith('/')) return new Response(null, { status: 307, headers: { location: url.pathname + '/' + url.search } });
        f = fileAt(path + 'index.html');
      } else if (!f && !extname(path)) {
        const html = fileAt(path + '.html');
        if (html) f = html;
      }
      if (f && f.s.isFile()) return send(req, path, f.p, f.s);
      const nf = fileAt('/404.html');
      return nf ? send(req, '/404.html', nf.p, nf.s, 404) : new Response('Not found', { status: 404 });
    },
  };
}
