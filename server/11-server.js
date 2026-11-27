'use strict';
// Zero-dependency HTTP server for the voice billing app.
// Security defaults: binds to 127.0.0.1, request size cap, strict headers, server-side price calculation
// (prices always come from the shop catalog, never from the client or a model).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeStore } = require('./store');
const { validateCatalog, priceBill, toCsv, toTallyXml } = require('./billing');

const ROOT = path.join(__dirname, '..');
// Only these app files are ever served; source, tests and data stay unreachable.
const SERVE = { 'index.html': 1, 'style.css': 1, 'app.js': 1, 'parser.js': 1, 'seed.js': 1, 'billing-core.js': 1, 'summary-core.js': 1, 'mode.js': 1 };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_BODY = 256 * 1024;
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'microphone=(self)'
};

function createServer(dataDir, opts = {}) {
  const store = makeStore(dataDir);
  const token = opts.token || process.env.APP_TOKEN || ''; // optional shared secret for LAN use
  const send = (res, code, body, type = 'application/json', extra = {}) => {
    res.writeHead(code, Object.assign({ 'Content-Type': type }, HEADERS, extra));
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('bad json'), { code: 400 })); } });
  });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p.startsWith('/api/')) {
        if (token && req.headers['x-app-token'] !== token && url.searchParams.get('token') !== token) return send(res, 401, { error: 'token required' });
        // CSRF / cross-origin protection for state-changing calls: browsers always send Origin (or Sec-Fetch-Site) on these.
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const origin = req.headers.origin; const sfs = req.headers['sec-fetch-site'];
          if (sfs && sfs !== 'same-origin' && sfs !== 'none') return send(res, 403, { error: 'cross-site request blocked' });
          if (origin && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host) return send(res, 403, { error: 'cross-origin request blocked' });
          if (!origin && !sfs && !token) return send(res, 403, { error: 'origin required' });
        }
        if (req.method !== 'GET' && (req.headers['content-type'] || '').split(';')[0] !== 'application/json' && p !== '/api/ping') {
          return send(res, 415, { error: 'json only' });
        }
        if (p === '/api/catalog' && req.method === 'GET') return send(res, 200, store.getCatalog());
        if (p === '/api/catalog' && req.method === 'PUT') {
          const r = validateCatalog((await readBody(req)).catalog);
          if (r.error) return send(res, 400, { error: r.error });
          store.setCatalog(r.catalog); return send(res, 200, r.catalog);
        }
        if (p === '/api/bills' && req.method === 'POST') {
          const body = await readBody(req);
          const r = priceBill(body.lines, store.getCatalog());
          if (r.error) return send(res, 400, { error: r.error });
          const extra = { ts: new Date().toISOString() };
          if (typeof body.note === 'string') extra.note = body.note.slice(0, 200);
          return send(res, 201, store.addBill(Object.assign(extra, r.bill)));
        }
        if (p === '/api/bills' && req.method === 'GET') return send(res, 200, store.getBills());
        if (p === '/api/bills.csv' && req.method === 'GET') return send(res, 200, toCsv(store.getBills()), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="bills.csv"' });
        let m;
        if ((m = /^\/api\/bills\/(\d+)\/tally\.xml$/.exec(p)) && req.method === 'GET') {
          const b = store.getBills().find((x) => x.no === Number(m[1]));
          if (!b) return send(res, 404, { error: 'not found' });
          return send(res, 200, toTallyXml(b), 'application/xml; charset=utf-8', { 'Content-Disposition': 'attachment; filename="bill-' + b.no + '-tally-UNTESTED.xml"' });
        }
        return send(res, 404, { error: 'not found' });
      }
      // static: a fixed whitelist of app files from the repo root.
      if (req.method !== 'GET') return send(res, 405, { error: 'method' });
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
      if (!SERVE[rel]) return send(res, 404, 'not found', 'text/plain');
      // server mode always stores on the server, whatever the static hosting copy says
      if (rel === 'mode.js') return send(res, 200, 'window.VB_LOCAL_MODE = false;\n', MIME['.js']);
      fs.readFile(path.join(ROOT, rel), (err, data) => {
        if (err) return send(res, 404, 'not found', 'text/plain');
        send(res, 200, data, MIME[path.extname(rel)] || 'application/octet-stream');
      });
    } catch (e) {
      send(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { error: e.code === 413 || e.code === 400 ? e.message : 'server error' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  // BIND_ALL=1 is for containers (Docker): the container's port mapping controls exposure,
  // so binding 0.0.0.0 without an APP_TOKEN is safe there. Outside a container the old guard stands.
  const bindAll = process.env.BIND_ALL === '1';
  const host = process.env.HOST || (bindAll ? '0.0.0.0' : '127.0.0.1');
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.APP_TOKEN && !bindAll) {
    console.error('Refusing to listen on a network address without APP_TOKEN set. Example: HOST=0.0.0.0 APP_TOKEN=choose-a-secret npm start');
    process.exit(1);
  }
  createServer(dir).listen(port, host, () => console.log('Voice billing running at http://' + host + ':' + port));
}
module.exports = { createServer };
