/* The photos (and share cards, uploaded fonts) on a VPS: an R2 look-alike over a folder. A key is a path under it
   (p/2026/10/09/<uuid>.jpg); the type comes from the name's extension, which every key the Worker writes has. */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};
const typeOf = (key) => TYPES[key.slice(key.lastIndexOf('.') + 1).toLowerCase()] || 'application/octet-stream';

export function fsBucket(root) {
  root = resolve(root);
  // a key never leaves the folder, and never names one of the temporary files
  const pathOf = (key) => {
    const p = resolve(root, key);
    if (typeof key !== 'string' || !key || key.includes('\0') || !p.startsWith(root + sep) || /(^|\/)\./.test(key)) throw new Error('bad key: ' + key);
    return p;
  };
  const meta = (key, s) => {
    const etag = `${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}`;
    const contentType = typeOf(key);
    return {
      key, size: s.size, uploaded: s.mtime, etag, httpEtag: `"${etag}"`,
      httpMetadata: { contentType }, customMetadata: {},
      writeHttpMetadata: (h) => h.set('content-type', contentType),
    };
  };
  const statOf = async (key) => { try { const s = await stat(pathOf(key)); return s.isFile() ? s : null; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const bytes = async (data) => {
    if (data == null) return new Uint8Array();
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(await new Response(data).arrayBuffer());   // a stream or a Blob
  };

  return {
    async put(key, data) {
      const p = pathOf(key), buf = await bytes(data);
      await mkdir(dirname(p), { recursive: true });
      // written whole, then moved in: a reader never gets half a photo
      const tmp = join(dirname(p), `.${randomUUID()}.part`);
      await writeFile(tmp, buf);
      await rename(tmp, p);
      return meta(key, await stat(p));
    },
    async head(key) { const s = await statOf(key); return s && meta(key, s); },
    async get(key) {
      const s = await statOf(key);
      if (!s) return null;
      const p = pathOf(key);
      return {
        ...meta(key, s),
        get body() { return Readable.toWeb(createReadStream(p)); },
        arrayBuffer: async () => { const b = await readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
        text: async () => readFile(p, 'utf8'),
      };
    },
    async delete(keys) {
      for (const key of [].concat(keys)) await rm(pathOf(key), { force: true });
    },
    /** prefix, delimiter ("/": the folders under the prefix as delimitedPrefixes), limit and cursor (where the
        last page stopped), in key order, as R2 lists */
    async list({ prefix = '', delimiter = '', limit = 1000, cursor = '' } = {}) {
      const keys = [];
      const walk = async (dir, rel) => {
        let names;
        try { names = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
        for (const d of names) {
          if (d.name.startsWith('.')) continue;
          const k = rel + d.name;
          if (d.isDirectory()) { if (prefix.startsWith(k + '/') || (k + '/').startsWith(prefix)) await walk(join(dir, d.name), k + '/'); }
          else if (d.isFile() && k.startsWith(prefix)) keys.push(k);
        }
      };
      await walk(root, '');
      keys.sort();
      const objects = [], prefixes = new Set();
      let truncated = false, last = '';
      for (const key of keys) {
        if (cursor && key <= cursor) continue;
        const rest = key.slice(prefix.length), i = delimiter ? rest.indexOf(delimiter) : -1;
        if (i >= 0) { prefixes.add(prefix + rest.slice(0, i + 1)); continue; }
        if (objects.length >= limit) { truncated = true; break; }
        objects.push(meta(key, await stat(pathOf(key))));
        last = key;
      }
      return { objects, delimitedPrefixes: [...prefixes].sort(), truncated, ...(truncated ? { cursor: last } : {}) };
    },
  };
}
