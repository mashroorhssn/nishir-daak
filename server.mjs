// Nishir Daak — local server. Zero dependencies:  node server.mjs
// Serves ./public and the game API at POST /api (long-polling).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handle, memoryStore, cleanCode } from './engine/api.mjs';
import { tick } from './engine/engine.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 8080;
const LONG_POLL_MS = 25000;
const TICK_MS = 300;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

// ---- rooms + long-poll wakeups ------------------------------------------------
const waiters = new Map(); // code -> Set<() => void>
const seenV = new Map();   // code -> last version announced
const lastUse = new Map(); // code -> ms

function wake(code, state) {
  if (seenV.get(code) === state.v) return;
  seenV.set(code, state.v);
  const set = waiters.get(code);
  if (!set) return;
  waiters.delete(code);
  for (const fn of set) fn();
}
const store = memoryStore(wake);

// `res` emits "close" if the client hangs up while we hold its poll open.
function waitForChange(code, ms, res) {
  return new Promise(resolve => {
    let set = waiters.get(code);
    if (!set) waiters.set(code, set = new Set());
    const done = () => { clearTimeout(timer); set.delete(done); res.off('close', done); resolve(); };
    const timer = setTimeout(done, ms);
    set.add(done);
    res.once('close', done);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [code, state] of store.rooms) {
    try { if (tick(state, now)) wake(code, state); } catch (e) { console.error('tick failed', code, e); }
    if (now - (lastUse.get(code) || state.createdAt) > ROOM_TTL_MS) {
      store.rooms.delete(code); lastUse.delete(code); seenV.delete(code);
    }
  }
}, TICK_MS).unref();

async function api(body, res) {
  const code = cleanCode(body && body.room);
  if (code) lastUse.set(code, Date.now());
  const opts = { wait: 0 };
  if (!body || body.op !== 'poll') return handle(body, store, Date.now(), opts);
  const deadline = Date.now() + LONG_POLL_MS;
  for (;;) {
    const out = await handle(body, store, Date.now(), opts);
    const left = deadline - Date.now();
    if (!out.same || left <= 0 || res.destroyed) return out;
    await waitForChange(code, left, res);
  }
}

// ---- http ------------------------------------------------------------------------
function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
  if (rel.includes('\0')) return send(res, 400, 'Bad request');
  let file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  try {
    let st = await stat(file);
    if (st.isDirectory()) { file = path.join(file, 'index.html'); st = await stat(file); }
    const data = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (req.method === 'HEAD') return send(res, 200, '', { 'Content-Type': type, 'Content-Length': data.length });
    return send(res, 200, data, { 'Content-Type': type });
  } catch {
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'Bad JSON' }); }
      const out = await api(body, res);
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, out);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  Nishir Daak is running.\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Friends on Wi-Fi:   http://${ip}:${PORT}`);
  console.log('\n  Press Ctrl+C to stop.\n');
});
