// Shared client logic for every design. Pages differ only in markup/CSS; ids are the contract.
const $ = (s) => document.querySelector(s);
const PAGE = document.body.dataset.page;
const ROLE = PAGE === 'join' ? 'participant' : PAGE;
const ME = sessionStorage.getItem('cp-id') || crypto.randomUUID();
sessionStorage.setItem('cp-id', ME);
// STUN first; the public Open Relay TURN is a fallback for networks that block laptop-to-laptop links.
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
] };
const host = (body) => post('/api/admin', body);
let S = { queue: [], current: null, limitSec: 300 };
let clockSkew = 0;

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const signal = (to, data) => post('/api/signal', { to, from: ME, data });
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
const show = (sel, on) => { const el = $(sel); if (el) el.hidden = !on; };

// ---------- live connection ----------
const handlers = { state: [], signal: [], stop: [], 'your-turn': [] };
const on = (ev, fn) => handlers[ev].push(fn);
function connect() {
  const fire = (ev, d) => { if (ev === 'state') { S = d; clockSkew = Date.now() - d.now; } (handlers[ev] || []).forEach((f) => f(d)); };
  const loop = async () => {
    try {
      const r = await (await fetch(`/api/poll?id=${ME}&role=${ROLE}`, { cache: 'no-store' })).json();
      for (const e of r.events) fire(e.event, e.data);
      fire('state', r.state);
    } catch {}
    setTimeout(loop, 700);
  };
  loop();
}

// ---------- stopwatch (all pages) ----------
setInterval(() => {
  const el = $('#stopwatch'); if (!el) return;
  const c = S.current;
  if (!c?.startedAt) { el.textContent = '00:00'; el.dataset.state = c ? 'waiting' : 'idle'; return; }
  const ms = Date.now() - clockSkew - c.startedAt;
  el.textContent = fmt(ms);
  el.dataset.state = ms / 1000 > S.limitSec ? 'over' : ms / 1000 > S.limitSec * 0.8 ? 'warn' : 'ok';
}, 250);

// ---------- watching the presenter (admin + viewer) ----------
let watchPc = null, watching = null;
function watch(videoSel) {
  const video = $(videoSel);
  on('state', (s) => {
    const sharer = s.current?.startedAt ? s.current.id : null;
    document.body.dataset.live = sharer ? 'yes' : 'no';
    if (sharer === watching) return;
    watchPc?.close(); watchPc = null; watching = sharer; video.srcObject = null;
    if (sharer) signal(sharer, { type: 'want' });
  });
  on('signal', async ({ from, data }) => {
    if (from !== watching) return;
    if (data.type === 'offer') {
      watchPc?.close();
      watchPc = new RTCPeerConnection(ICE);
      watchPc.ontrack = (e) => { video.srcObject = e.streams[0]; video.play().catch(() => {}); };
      watchPc.onicecandidate = (e) => e.candidate && signal(from, { type: 'ice', c: e.candidate });
      await watchPc.setRemoteDescription(data.sdp);
      await watchPc.setLocalDescription(await watchPc.createAnswer());
      signal(from, { type: 'answer', sdp: watchPc.localDescription });
    } else if (data.type === 'ice' && watchPc) watchPc.addIceCandidate(data.c).catch(() => {});
  });
  const btn = $('#soundBtn');
  if (btn) btn.onclick = () => { video.muted = !video.muted; video.play().catch(() => {}); btn.textContent = video.muted ? 'Turn sound on' : 'Mute'; };
}

function renderNow() {
  const c = S.current;
  set('#nowName', c ? c.name : 'Nobody on stage');
  set('#nowNote', c ? (c.note || '') : 'Join the queue to show what you built tonight.');
  set('#nowStatus', !c ? 'idle' : c.startedAt ? 'live' : 'getting ready');
}
function renderUpNext(sel, withControls) {
  const ul = $(sel); if (!ul) return;
  ul.innerHTML = S.queue.length ? S.queue.map((q, i) => `
    <li><span class="pos">${i + 1}</span><span class="who"><b>${esc(q.name)}${q.armed ? ' <em class="armed">screen ready</em>' : ''}</b><small>${esc(q.note)}</small></span>
    ${withControls ? `<span class="ctl"><button data-a="up" data-id="${q.id}" title="Move up">&uarr;</button><button data-a="remove" data-id="${q.id}" title="Remove">&times;</button></span>` : ''}</li>`).join('')
    : `<li class="empty">Queue is empty</li>`;
  set('#count', String(S.queue.length));
}

// ---------- pages ----------
const pages = {
  admin() {
    watch('#stageVideo');
    on('state', () => { renderNow(); renderUpNext('#queueList', true); if ($('#limitInput') !== document.activeElement) $('#limitInput').value = Math.round(S.limitSec / 60); });
    $('#queueList').onclick = (e) => { const b = e.target.closest('button'); if (b) host({ action: b.dataset.a, id: b.dataset.id }); };
    $('#nextBtn').onclick = () => host({ action: 'next' });
    $('#stopBtn').onclick = () => host({ action: 'stop' });
    $('#limitInput').onchange = (e) => host({ action: 'limit', seconds: Number(e.target.value) * 60 });
  },
  view() {
    watch('#stageVideo');
    on('state', () => { renderNow(); renderUpNext('#upNext', false); });
  },
  async recordings() {
    const list = await (await fetch('/api/recordings')).json();
    $('#recList').innerHTML = list.length ? list.map((r) => `
      <article class="rec"><video src="/recordings/files/${encodeURIComponent(r.file)}" controls preload="metadata"></video>
      <div><h3>${esc(r.name)}</h3><p>${esc(r.note) || '<i>No note</i>'}</p><small>${new Date(r.at).toLocaleString()} &middot; ${fmt(r.duration * 1000)}</small></div></article>`).join('')
      : `<p class="empty">No recordings yet. They appear here after each demo.</p>`;
  },
  join() {
    const micTest = audioTest();
    // screen = the picked screen/window (can be picked while still in line); stream = screen + mixed mic, built on go-live.
    let screen = null, stream = null, rec = null, chunks = [], started = 0, lastPos = -1;
    const peers = new Map();
    const inQueue = () => S.queue.findIndex((q) => q.id === ME);
    const render = () => {
      const pos = inQueue(), mine = S.current?.id === ME;
      document.body.dataset.stage = mine ? (S.current.startedAt ? 'sharing' : 'turn') : pos >= 0 ? 'queued' : 'form';
      set('#position', pos >= 0 ? `#${pos + 1}` : '');
      set('#ahead', pos > 0 ? `${pos} ${pos === 1 ? 'person' : 'people'} ahead of you` : pos === 0 ? "You're next. Get your screen ready." : '');
      if (pos === 0 && lastPos !== 0) alertMe("You're up next", 'Get your screen ready.', 1);
      lastPos = pos;
      renderNow(); renderUpNext('#upNext', false);
    };
    on('state', render);
    $('#joinForm').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      localStorage.setItem('cp-name', f.get('name'));
      if (window.Notification?.permission === 'default') Notification.requestPermission().catch(() => {});
      post('/api/join', { id: ME, name: f.get('name'), note: f.get('note') });
    };
    const saved = localStorage.getItem('cp-name'); if (saved) $('#joinForm [name=name]').value = saved;
    $('#leaveBtn').onclick = () => { stopShare(false); post('/api/leave', { id: ME }); };

    const showPreview = () => ['#queuePreview', '#selfPreview'].forEach((s) => { const v = $(s); if (v) v.srcObject = screen ? new MediaStream(screen.getVideoTracks()) : null; });
    const arm = (yes) => { document.body.dataset.armed = yes ? 'yes' : 'no'; post('/api/armed', { id: ME, armed: yes }); };
    async function pickScreen() {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      screen?.getTracks().forEach((t) => t.stop());
      screen = s;
      screen.getVideoTracks()[0].onended = () => {
        if (stream) return stopShare(true);
        screen = null; showPreview(); arm(false); set('#shareError', 'Screen share stopped. Pick it again when you are ready.');
      };
      showPreview(); arm(true); set('#shareError', '');
    }
    async function preShare() {
      try { await pickScreen(); } catch (err) { set('#shareError', 'Screen share was cancelled or blocked: ' + err.message); }
    }
    async function startShare() {
      try {
        if (!screen) await pickScreen();
        micTest.stop(); // release the scanned mics before grabbing the chosen one
        const micId = $('#micSelect')?.value;
        const mic = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true }).catch(() => null);
        // Mix mic + tab audio into one track so viewers and the recording hear both.
        const ac = new AudioContext(), dest = ac.createMediaStreamDestination();
        for (const s of [mic, screen]) if (s?.getAudioTracks().length) ac.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
        stream = new MediaStream([...screen.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        stream._parts = [screen, mic, ac];
        showPreview();
        chunks = []; started = Date.now();
        // ~1.1 Mbps keeps a 10-minute demo under the tunnel's ~100 MB upload cap; screen content compresses well.
        rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm', videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 96_000 });
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = upload;
        rec.start(1000);
        await post('/api/start', { id: ME });
      } catch (err) { set('#shareError', 'Screen share was cancelled or blocked: ' + err.message); }
    }
    function stopShare(self) {
      if (!stream && !screen) return;
      if (stream) {
        rec?.state !== 'inactive' && rec?.stop();
        for (const p of stream._parts) p?.getTracks ? p.getTracks().forEach((t) => t.stop()) : p?.close?.();
        stream = null; peers.forEach((pc) => pc.close()); peers.clear();
      }
      screen?.getTracks().forEach((t) => t.stop()); screen = null;
      showPreview(); arm(false);
      if (self) post('/api/leave', { id: ME });
    }
    async function upload() {
      const f = new FormData($('#joinForm'));
      const q = new URLSearchParams({ name: f.get('name') || 'anon', note: f.get('note') || '', duration: String(Math.round((Date.now() - started) / 1000)) });
      set('#shareError', 'Saving your recording...');
      await fetch('/api/recordings?' + q, { method: 'POST', body: new Blob(chunks, { type: 'video/webm' }) });
      set('#shareError', 'Recording saved. Thanks for sharing!');
    }
    $('#shareBtn').onclick = startShare;
    $('#preShareBtn')?.addEventListener('click', preShare);
    $('#changeShareBtn')?.addEventListener('click', preShare);
    $('#stopShareBtn').onclick = () => stopShare(true);
    on('stop', () => stopShare(false));
    on('your-turn', () => { alertMe("It's your turn!", 'Walk up and press Go live.', 3); document.title = "It's your turn! | Checkpoints"; });

    // Each watcher asks for the stream; one peer connection per watcher.
    on('signal', async ({ from, data }) => {
      if (data.type === 'want' && stream) {
        peers.get(from)?.close();
        const pc = new RTCPeerConnection(ICE); peers.set(from, pc);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        pc.onicecandidate = (e) => e.candidate && signal(from, { type: 'ice', c: e.candidate });
        await pc.setLocalDescription(await pc.createOffer());
        signal(from, { type: 'offer', sdp: pc.localDescription });
      } else if (data.type === 'answer') peers.get(from)?.setRemoteDescription(data.sdp);
      else if (data.type === 'ice') peers.get(from)?.addIceCandidate(data.c).catch(() => {});
    });
  },
};

// ---------- alerts: beep + browser notification + page flash ----------
function alertMe(title, body, beeps) {
  try {
    const ac = new AudioContext();
    for (let i = 0; i < beeps; i++) {
      const t = ac.currentTime + i * 0.22, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = i % 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.2);
    }
  } catch {}
  try { if (document.hidden && window.Notification?.permission === 'granted') new Notification(title, { body }); } catch {}
  document.body.classList.remove('flash'); void document.body.offsetWidth; document.body.classList.add('flash');
}

// ---------- mic check: listens to every input at once, so the one that hears you lights up ----------
// Click a mic to use it. With #micAuto checked (or absent), a silent chosen mic is swapped for one that clearly hears you.
function audioTest() {
  const sel = $('#micSelect'), btn = $('#testBtn'), fill = $('#meterFill'), list = $('#micList'), auto = $('#micAuto');
  if (!sel || !btn) return { stop() {} };
  const mics = new Map(); // deviceId -> { label, stream, an, buf, level, heardAt, loudSince, el }
  let ac = null, raf = 0, live = false, gen = 0, noteUntil = 0;
  const idle = btn.textContent;
  async function inputs() {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId));
    const keep = sel.value || localStorage.getItem('cp-mic');
    sel.innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || `Microphone ${i + 1}`)}</option>`).join('') || '<option value="">Default microphone</option>';
    if (keep && devs.some((d) => d.deviceId === keep)) sel.value = keep;
    return devs;
  }
  function choose(id, note) {
    sel.value = id; localStorage.setItem('cp-mic', id);
    for (const [k, m] of mics) m.el?.classList.toggle('on', k === id);
    if (note) { set('#meterLabel', note); noteUntil = performance.now() + 2500; }
  }
  function stop() {
    gen++; live = false; cancelAnimationFrame(raf);
    for (const m of mics.values()) m.stream.getTracks().forEach((t) => t.stop());
    mics.clear(); ac?.close().catch(() => {}); ac = null;
    if (fill) fill.style.width = '0%';
    if (list) list.innerHTML = '';
    btn.textContent = idle; set('#meterLabel', 'Not testing');
  }
  async function start() {
    stop(); live = true; const my = gen;
    btn.textContent = 'Stop mic check'; set('#meterLabel', 'Listening to every mic...');
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); // unlocks device labels
      const devs = await inputs();
      ac = new AudioContext();
      await Promise.all(devs.map(async (d, i) => {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: d.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).catch(() => null);
        if (!s) return;
        if (my !== gen) return s.getTracks().forEach((t) => t.stop());
        const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(s).connect(an);
        mics.set(d.deviceId, { label: d.label || `Microphone ${i + 1}`, stream: s, an, buf: new Uint8Array(512), level: 0, heardAt: 0, loudSince: 0, order: i });
      }));
      if (my !== gen) return;
      if (!mics.size) throw new Error('no mic');
      if (list) {
        for (const [id, m] of [...mics].sort((a, b) => a[1].order - b[1].order)) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'mic';
          b.innerHTML = `<span class="name">${esc(m.label)}</span><span class="lvl"><i></i></span>`;
          b.onclick = () => choose(id, `Using ${m.label}`);
          m.el = b; list.append(b);
        }
      }
      choose(mics.has(sel.value) ? sel.value : mics.keys().next().value);
      tick();
    } catch { stop(); set('#meterLabel', 'Mic blocked: allow microphone access in your browser'); }
  }
  function tick() {
    const now = performance.now();
    for (const m of mics.values()) {
      m.an.getByteTimeDomainData(m.buf);
      let peak = 0; for (const v of m.buf) peak = Math.max(peak, Math.abs(v - 128));
      const pct = Math.min(100, (peak / 128) * 160);
      m.level = Math.max(pct, m.level * 0.85);
      if (pct > 12) { m.heardAt = now; m.loudSince ||= now; } else if (now - m.heardAt > 300) m.loudSince = 0;
      if (m.el) { m.el.style.setProperty('--lvl', `${m.level.toFixed(0)}%`); m.el.classList.toggle('hot', now - m.heardAt < 600); }
    }
    const cur = mics.get(sel.value);
    if (fill) fill.style.width = `${cur ? cur.level : 0}%`;
    if (auto?.checked !== false && mics.size > 1 && !(cur && now - cur.heardAt < 1200)) {
      const best = [...mics].filter(([, m]) => m.loudSince && now - m.loudSince > 350).sort((a, b) => b[1].level - a[1].level)[0];
      if (best) choose(best[0], `Switched to ${best[1].label}: it heard you`);
    }
    if (now > noteUntil) set('#meterLabel', cur && now - cur.heardAt < 800 ? 'We hear you!' : 'Say something...');
    raf = requestAnimationFrame(tick);
  }
  btn.onclick = () => (live ? stop() : start());
  sel.onchange = () => choose(sel.value, 'Mic changed');
  navigator.mediaDevices?.addEventListener?.('devicechange', () => (live ? start() : inputs()));
  inputs();
  return { stop };
}

// Any [data-join-url] shows the full join link for wherever this is served (the tunnel URL changes).
document.querySelectorAll('[data-join-url]').forEach((el) => { el.textContent = location.host + el.dataset.joinUrl; });
pages[PAGE]?.();
if (PAGE !== 'recordings') connect();
