// A tiny static server for game/ (Node 22, standard library only), so the
// entry can be played locally without a build step: `node serve.ts` serves
// game/ on http://localhost:8080. It sends the MIME types a browser game
// needs, refuses any path outside game/, and otherwise does nothing clever.
//
// Round 2: the server now behaves like a real static host — ETags and
// Last-Modified with conditional GET (304), gzip for text assets, HEAD
// support, immutable caching for the vendored three.js (its bytes never
// change), no-store for the game files you are actively editing, and the
// basic security headers. Everything is still standard library only.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createGzip } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const flagValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 || i + 1 >= args.length ? fallback : args[i + 1];
};
const requestedPort = Number(flagValue('--port', '8080'));
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 8080;
const host = flagValue('--host', '127.0.0.1');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

// Text types worth gzipping; images and wasm are already compressed.
const GZIP_TYPES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'SAMEORIGIN',
};

function log(method, pathname, status, ms) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t} ${method} ${pathname} -> ${status} (${ms}ms)`);
}

createServer((request, response) => {
  const started = Date.now();
  const done = (status) => log(request.method ?? 'GET', request.url ?? '/', status, Date.now() - started);
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, SECURITY_HEADERS).end('bad request');
    done(400);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD' }).end('method not allowed');
    done(405);
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403, SECURITY_HEADERS).end('forbidden');
    done(403);
    return;
  }
  let stats;
  try {
    stats = statSync(file);
    if (!stats.isFile()) throw new Error('not a file');
  } catch {
    response.writeHead(404, SECURITY_HEADERS).end('not found');
    done(404);
    return;
  }

  const ext = extname(file).toLowerCase();
  const isVendor = file.startsWith(root + sep + 'vendor' + sep);
  // The ETag is size + mtime: cheap, and it changes exactly when the file
  // does. Vendor files are immutable (their bytes never change), so a
  // browser may cache them for a year without revalidating.
  const etag = `"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
  const lastModified = stats.mtime.toUTCString();
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': String(stats.size),
    etag,
    'last-modified': lastModified,
    'cache-control': isVendor
      ? 'public, max-age=31536000, immutable'
      : 'no-cache', // game files change while you edit; revalidate every load
  };

  // Conditional GET: a matching ETag or an unmodified mtime is a 304 with
  // no body, so repeat loads of the 600 KiB three.js bundle cost nothing.
  const ifNoneMatch = request.headers['if-none-match'];
  const ifModifiedSince = request.headers['if-modified-since'];
  if (ifNoneMatch === etag || (ifModifiedSince && new Date(ifModifiedSince) >= stats.mtime)) {
    delete headers['content-length'];
    response.writeHead(304, headers).end();
    done(304);
    return;
  }

  const acceptGzip = (request.headers['accept-encoding'] ?? '').includes('gzip');
  const useGzip = acceptGzip && GZIP_TYPES.has(ext) && request.method === 'GET';
  if (useGzip) {
    delete headers['content-length'];
    headers['content-encoding'] = 'gzip';
    headers.vary = 'Accept-Encoding';
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    done(200);
    return;
  }
  const stream = createReadStream(file);
  if (useGzip) stream.pipe(createGzip()).pipe(response);
  else stream.pipe(response);
  stream.on('error', () => {
    if (!response.writableEnded) response.writeHead(500, SECURITY_HEADERS).end('read error');
    done(500);
  });
  response.on('finish', () => done(200));
}).listen(port, host, () => {
  console.log(`game/ is on http://${host}:${port}`);
});
