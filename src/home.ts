import { Hono } from "hono";
import { type HonoEnv } from "./env";
import { cached } from "./cache";
import { readerEntries } from "./locks";
import { SETTING_DEFAULTS, loadSettings, publicSettings } from "./settings";
import { escHtml } from "./text";

export const pub = new Hono<HonoEnv>();

/* The book's page: title and description from the settings, and the data inlined so book.js needn't fetch it.
   Kept at the edge for a reader without keys (cache.ts): the same page until something a reader can see is written. */
pub.get("/", (c) => cached(c, "home", "", async () => {
  // (no tokens here: a reader's opened pages come later from /api/entries, their tab holds the keys)
  // The static page is asked for without the reader's If-None-Match: it would answer 304 to a copy that only has the
  // page's own ETag, and the pages inlined below (which change whenever one is written) would never get through.
  const plain = new Headers(c.req.raw.headers);
  for (const h of ["if-none-match", "if-modified-since", "range"]) plain.delete(h);
  const [page, settings, reader] = await Promise.all([c.env.ASSETS.fetch(new Request(c.req.url, { headers: plain })), loadSettings(c.env), readerEntries(c.env, [])]);
  if (!page.ok) return page;   // (sent as it is, not kept)
  // "<" escaped so nothing in a journal page can close the script tag
  const data = JSON.stringify({ entries: reader.entries, lock: reader.lock, settings: publicSettings(settings) }).replace(/</g, "\\u003c");
  const title = settings.siteTitle || SETTING_DEFAULTS.siteTitle;
  // shared as it is: the journal's name, its line, the default picture (a page is shared as /p/<id>)
  const o = new URL(c.req.url).origin, m = (k: string, v: string) => `<meta property="${k}" content="${escHtml(v)}">`;
  const og = m("og:type", "website") + m("og:title", title) + m("og:description", settings.siteDesc) +
    m("og:image", o + "/og.png") + m("og:image:width", "1200") + m("og:image:height", "630") + '<meta name="twitter:card" content="summary_large_image">';
  // the page is our own (src-build/index.tpl.html): its <title>, description and boot.js are found by plain text,
  // which the Workers runtime and Node (the VPS server) both have
  const html = (await page.text())
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escHtml(settings.siteDesc)}">` + og)
    .replace(/<script src="\/assets\/boot\.js/, (s) => `<script>window.TECHO_DATA=${data}</script>` + s);
  // no-cache: a browser keeps it and asks first; unchanged (no page written, nothing set), it gets a 304
  const h = new Headers(page.headers);
  h.set("Cache-Control", "no-cache");
  h.set("Content-Type", "text/html; charset=utf-8");
  h.delete("content-length");
  return { body: html, headers: h, status: page.status };
}));
