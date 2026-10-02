// Checkpoints MVP: one Node server, no dependencies.
// State lives in memory (queue + current presenter); recordings are saved to ./recordings.
// Screen video goes browser-to-browser over WebRTC; this server only relays signalling (SSE + POST).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const REC = path.join(ROOT, 'recordings');
const REC_INDEX = path.join(REC, 'recordings.json');
const PORT = Number(process.env.PORT || 4747);
const THEMES = ['boilermaker', 'terminal', 'zine', 'orbit'];
fs.mkdirSync(REC, { recursive: true });

const clients = new Map();            // id -> { role, lastSeen, box: [events waiting for the next poll] }
let queue = [];                       // [{ id, name, note, joinedAt }]
let current = null;                   // { id, name, note, calledAt, startedAt }
let limitSec = 300;
const recordings = () => { try { return JSON.parse(fs.readFileSync(REC_INDEX, 'utf8')); } catch { return []; } };

const send = (id, event, data) => { const c = clients.get(id); if (c) c.box.push({ event, data }); };
const state = () => ({ queue, current, limitSec, now: Date.now(), viewers: [...clients.values()].filter(c => c.role !== 'participant').length, recordingCount: recordings().length });
const broadcast = () => {}; // every poll returns fresh state
// Live updates are short polling (the Cloudflare tunnel buffers streams). Drop clients that stop polling;
// background tabs can be throttled to one timer a minute, so waiting presenters get a long grace period.
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of clients) if (now - c.lastSeen > (c.role === 'participant' ? 150000 : 20000)) {
    clients.delete(id); queue = queue.filter(q => q.id !== id); if (current?.id === id) current = null;
  }
  // Entries whose browser never polled at all (API-only joins) also expire.
  queue = queue.filter(q => clients.has(q.id) || now - q.joinedAt < 150000);
  if (current && !clients.has(current.id) && now - current.calledAt > 150000) current = null;
}, 5000);

function endCurrent(reason) {
  if (!current) return;
  send(current.id, 'stop', { reason });
  current = null;
}
function callNext() {
  endCurrent('next');
  current = queue.length ? { ...queue.shift(), calledAt: Date.now(), startedAt: null } : null;
  if (current) send(current.id, 'your-turn', {});
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

function page(res, file, theme) {
  const html = fs.readFileSync(path.join(PUB, 'pages', file), 'utf8').replaceAll('{{THEME}}', theme);
  res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(html);
}
function serveFile(res, file) {
  if (!file.startsWith(PUB) && !file.startsWith(REC)) return json(res, 403, { error: 'no' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (p === '/api/poll') {
    const id = url.searchParams.get('id'), role = url.searchParams.get('role') || 'viewer';
    if (!id) return json(res, 400, { error: 'id required' });
    const c = clients.get(id) || { role, box: [] }; c.lastSeen = Date.now(); c.role = role; clients.set(id, c);
    const events = c.box; c.box = [];
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ state: state(), events }));
  }
  if (m === 'POST' && p === '/api/join') {
    const b = await readBody(req);
    if (!b.id || !b.name) return json(res, 400, { error: 'name required' });
    if (!queue.some(q => q.id === b.id) && current?.id !== b.id) queue.push({ id: b.id, name: String(b.name).slice(0, 60), note: String(b.note || '').slice(0, 280), joinedAt: Date.now() });
    broadcast(); return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/leave') {
    const b = await readBody(req); queue = queue.filter(q => q.id !== b.id);
    if (current?.id === b.id) current = null;
    broadcast(); return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/armed') {
    const b = await readBody(req); const q = queue.find(q => q.id === b.id);
    if (q) q.armed = !!b.armed;
    return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/start') {
    const b = await readBody(req);
    if (current?.id === b.id) { current.startedAt = Date.now(); broadcast(); }
    return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/admin') {
    const b = await readBody(req);
    if (b.action === 'next') callNext();
    if (b.action === 'stop') endCurrent('stopped by host');
    if (b.action === 'remove') queue = queue.filter(q => q.id !== b.id);
    if (b.action === 'up') { const i = queue.findIndex(q => q.id === b.id); if (i > 0) [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]]; }
    if (b.action === 'limit' && Number(b.seconds) > 0) limitSec = Number(b.seconds);
    broadcast(); return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/signal') {
    const b = await readBody(req); send(b.to, 'signal', { from: b.from, data: b.data }); return json(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/recordings') {
    const name = (url.searchParams.get('name') || 'anon').slice(0, 60);
    const note = (url.searchParams.get('note') || '').slice(0, 280);
    const duration = Number(url.searchParams.get('duration') || 0);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `${stamp}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}.webm`;
    const out = fs.createWriteStream(path.join(REC, file));
    req.pipe(out);
    out.on('finish', () => {
      const list = recordings(); list.unshift({ file, name, note, duration, at: new Date().toISOString() });
      fs.writeFileSync(REC_INDEX, JSON.stringify(list, null, 2)); broadcast(); json(res, 200, { ok: true, file });
    });
    return;
  }
  if (p === '/api/recordings') return json(res, 200, recordings());
  if (p.startsWith('/recordings/files/')) return serveFile(res, path.join(REC, path.basename(p)));

  // Pages. /d/<theme>/{join|admin|view|recordings}; /recordings is the public archive.
  // The Purdue Hackers design is the default site: / (join), /view, /admin, /recordings. /designs lists every design.
  if (p === '/designs') return page(res, 'hub.html', 'hub');
  const DEFAULT = 'ph';
  const short = { '/': 'join', '/join': 'join', '/view': 'view' }[p];
  if (short) { res.writeHead(200, { 'content-type': MIME['.html'] }); return res.end(fs.readFileSync(path.join(PUB, 'designs', DEFAULT, `${short}.html`), 'utf8')); }
  // Host controls are never linked from the public UI: /admin (default design) or /admin/<design>.
  const am = p.match(/^\/admin(?:\/([a-z0-9-]+))?$/);
  if (am) {
    const f = path.join(PUB, 'designs', am[1] || DEFAULT, 'admin.html');
    if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME['.html'] }); return res.end(fs.readFileSync(f, 'utf8')); }
    return page(res, 'admin.html', 'boilermaker');
  }
  if (p === '/recordings') {
    const f = path.join(PUB, 'designs', DEFAULT, 'recordings.html');
    if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME['.html'] }); return res.end(fs.readFileSync(f, 'utf8')); }
    return page(res, 'recordings.html', 'boilermaker');
  }
  const dm = p.match(/^\/d\/([a-z0-9-]+)(?:\/(join|admin|view|recordings))?$/);
  // A design with its own markup lives in public/designs/<name>/<page>.html.
  if (dm && fs.existsSync(path.join(PUB, 'designs', dm[1], `${dm[2] || 'join'}.html`))) {
    const html = fs.readFileSync(path.join(PUB, 'designs', dm[1], `${dm[2] || 'join'}.html`), 'utf8');
    res.writeHead(200, { 'content-type': MIME['.html'] }); return res.end(html);
  }
  if (dm && THEMES.includes(dm[1])) {
    const kind = dm[2] || 'join';
    return page(res, { join: 'join.html', admin: 'admin.html', view: 'view.html', recordings: 'recordings.html' }[kind], dm[1]);
  }
  return serveFile(res, path.join(PUB, path.normalize(p)));
}).listen(PORT, () => console.log(`Checkpoints MVP on http://localhost:${PORT}`));
