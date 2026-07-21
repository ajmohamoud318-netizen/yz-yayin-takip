// Tiny production server for the built Vite SPA.
//
// Dokploy's Nixpacks builder gets us to "client/dist exists". From here we need
// a single Node process that:
//   1. Serves static files from client/dist.
//   2. Falls back to index.html for client-side routes (history mode).
//   3. Emits the right cache headers — long-lived for hashed assets, no-cache
//      for index.html so deploys roll out without a manual hard refresh.
//
// We don't pull in express/serve/etc. to keep the runtime lean. Node's built-in
// http module is enough.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const DIST = path.join(__dirname, 'client', 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Reverse-proxy target for /api/* requests. In Dokploy the backend service is
// reachable on the internal network by its service slug (default: `backend`).
// Override with API_UPSTREAM=<scheme>://<host>:<port> if your slug differs.
const API_UPSTREAM = process.env.API_UPSTREAM || 'http://backend:4000';
const API_PROXY_PREFIX = '/api/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json',
  '.txt':  'text/plain; charset=utf-8',
};

function setCacheHeaders(res, filePath) {
  if (filePath.endsWith('index.html')) {
    // index.html must NOT be cached so deploys go live immediately.
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return;
  }
  // Everything under /assets/* has a content-hashed filename and is safe to
  // cache aggressively. Same for fonts and other static buckets.
  if (filePath.includes(`${path.sep}assets${path.sep}`) ||
      filePath.includes(`${path.sep}fonts${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    // Default to short cache for everything else (icons, favicons, etc.).
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  }
}

function safeJoin(root, requested) {
  // Prevent path traversal — collapse ".." and absolute paths.
  const resolved = path.normalize(path.join(root, requested));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const stat = promisify(fs.stat);

async function tryFile(candidate) {
  try {
    const st = await stat(candidate);
    if (st.isFile()) return candidate;
  } catch { /* fall through */ }
  return null;
}

async function resolveTarget(urlPath) {
  // Strip query/hash, normalise, decode percent-encoded chars.
  const cleaned = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = safeJoin(DIST, cleaned);
  if (!candidate) return null;

  // File system hit — serve it as-is.
  if (await tryFile(candidate)) return candidate;

  // Directory hit (e.g. `/animations/`) → serve the dir's index if any.
  const dirIndex = path.join(candidate, 'index.html');
  if (await tryFile(dirIndex)) return dirIndex;

  // SPA fallback only for extension-less paths. If the request looks like
  // a static asset (has an extension) and the file isn't there, that's a
  // real 404 — don't mask it with index.html.
  const looksLikeAsset = /\.[a-z0-9]{2,8}$/i.test(cleaned);
  if (looksLikeAsset) return null;

  // SPA route — any unknown, extension-less path gets index.html.
  const fallback = path.join(DIST, 'index.html');
  if (await tryFile(fallback)) return fallback;
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // Reverse-proxy /api/* → Fastify backend. Same-origin from the browser's
  // perspective, so the existing *.mucitkarinca.com wildcard cert covers
  // it without provisioning a separate edge cert for `api.yt.mucitkarinca.com`.
  if (url === '/api' || url.startsWith(API_PROXY_PREFIX) || url.startsWith('/api?')) {
    const upstream = new URL(API_UPSTREAM);
    const opts = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: url,
      headers: {
        ...req.headers,
        host: `${upstream.hostname}${upstream.port ? `:${upstream.port}` : ''}`,
      },
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_gateway', message: err.message }));
    });
    req.pipe(proxyReq);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD' });
    return res.end();
  }

  const target = await resolveTarget(url);

  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }

  const ext = path.extname(target).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  setCacheHeaders(res, target);

  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': fs.statSync(target).size });
    return res.end();
  }

  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[yz-yayin-takip] serving ${DIST} on http://${HOST}:${PORT}`);
});
