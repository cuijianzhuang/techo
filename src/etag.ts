/* "Has it changed?": what is sent gets an ETag made of it, and a reader who already has exactly that is
   answered 304 with nothing to download. Cache-Control: no-cache lets a browser keep the copy but makes it ask
   first; the pages that need it say `private` too (the answer depends on who asks, by Vary). */
export async function etagOf(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-1", buf));
  return '"' + [...sum.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("") + '"';
}

/** does the reader's If-None-Match name this ETag (weak or strong, one of several)? */
export const hasCopy = (req: Request, etag: string) =>
  (req.headers.get("if-none-match") || "").split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

/** the body with its ETag, or a 304 when the reader has it already */
export async function revalidated(req: Request, body: string | ArrayBuffer, headers: Headers, status = 200): Promise<Response> {
  const etag = await etagOf(body);
  headers.set("ETag", etag);
  headers.delete("content-length");
  if (status === 200 && hasCopy(req, etag)) {
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status, headers });
}
