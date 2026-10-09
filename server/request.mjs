/** The request as the Worker would see it on Cloudflare: the address the reader used (https, the domain, no port of
    ours) and their IP where Cloudflare puts it (cf-connecting-ip; one a reader sends is never kept). Behind a proxy
    (`trustProxy`) both come from its X-Forwarded-* headers, else from the connection itself. */
export function asWorkerRequest(req, { trustProxy, remoteAddress = '' }) {
  const url = new URL(req.url), h = new Headers(req.headers);
  const first = (v) => (v || '').split(',')[0].trim();
  let ip = remoteAddress;
  if (trustProxy) {
    const proto = first(h.get('x-forwarded-proto')), host = first(h.get('x-forwarded-host'));
    if (proto === 'https' || proto === 'http') url.protocol = proto + ':';
    if (host && /^[\w.-]+(:\d+)?$|^\[[0-9a-f:.]+\](:\d+)?$/i.test(host)) {
      url.host = host;
      if (!/:\d+$/.test(host)) url.port = '';   // (setting host alone keeps the old port)
    } else if (proto) url.port = '';
    // the last address is the one the proxy itself saw (what came before it, the reader could have written)
    const xff = (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) ip = xff.at(-1);
  }
  h.delete('cf-connecting-ip');
  if (ip) h.set('cf-connecting-ip', ip.replace(/^::ffff:/, ''));
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body;
  return new Request(url, { method: req.method, headers: h, body, duplex: 'half', redirect: 'manual', signal: req.signal });
}
