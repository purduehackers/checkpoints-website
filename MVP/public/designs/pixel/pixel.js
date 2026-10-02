// Checkpoints / Pixel: decorative effects only (core.js owns all logic).
// Vanilla ports of the Aloft pixel landing recipes: HairlineGrid (+ cursor cell trail), DitherField (WebGL2 Bayer
// field with click ripples), MarkerHighlight, ClickBursts, DitherVeil, plus a dithered-flower shader for the stage.
const page = document.body.dataset.page;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;

// ---------------------------------------------------------------- nav
document.querySelectorAll('.nav a[data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === page));

// ---------------------------------------------------------------- marker highlight
{
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = '<filter id="px-marker" x="-5%" y="-30%" width="110%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.18" numOctaves="2" seed="3" result="warp"/><feDisplacementMap in="SourceGraphic" in2="warp" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>';
  document.body.prepend(svg);
  let mi = 0;
  document.querySelectorAll('.mk').forEach((mk) => {
    const words = mk.textContent.split(/(\s+)/);
    mk.textContent = '';
    for (const w of words) {
      if (/^\s+$/.test(w) || !w) { mk.append(w); continue; }
      const s = document.createElement('span');
      s.className = 'mk__w'; s.textContent = w; s.style.setProperty('--mi', mi++);
      mk.append(s);
    }
  });
}

// ---------------------------------------------------------------- hairline grid
document.querySelectorAll('[data-grid]').forEach((host) => {
  const cell = Number(host.dataset.grid) || 40;
  const color = host.dataset.gridColor || '#0b0b0b';
  const op = Number(host.dataset.gridOpacity || 0.1);
  const major = 4, size = cell * major, t = Math.min(6, cell / 4);
  const id = 'pg' + Math.random().toString(36).slice(2, 8);
  let lines = '';
  for (let i = 0; i < major; i++) lines += `M${i * cell + 0.5} 0V${size}M0 ${i * cell + 0.5}H${size}`;
  const layer = document.createElement('div');
  layer.className = 'pgrid' + (host.dataset.gridFade ? ` pgrid--fade-${host.dataset.gridFade}` : '');
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<svg shape-rendering="crispEdges"><defs><pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">
    <path d="${lines}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="1"/>
    <path d="M0.5 0V${size}M0 0.5H${size}" fill="none" stroke="${color}" stroke-opacity="${Math.min(1, op * 2.2)}" stroke-width="1"/>
    ${host.hasAttribute('data-grid-ticks') ? `<path d="M0 0.5H${t + 0.5}M0.5 0V${t + 0.5}M${size - t} 0.5H${size}M0.5 ${size - t}V${size}" fill="none" stroke="${color}" stroke-opacity="${Math.min(1, op * 5)}" stroke-width="1.5"/>` : ''}
    </pattern></defs><rect width="100%" height="100%" fill="url(#${id})"/></svg>`;
  host.prepend(layer);
  if (!host.hasAttribute('data-grid-trail') || reduced || !finePointer) return;
  const cells = Array.from({ length: 7 }, () => {
    const el = document.createElement('span');
    el.className = 'pgrid__cell'; el.style.width = el.style.height = cell + 'px';
    layer.appendChild(el); return el;
  });
  let head = 0, last = '';
  host.addEventListener('pointermove', (e) => {
    const r = layer.getBoundingClientRect();
    const cx = Math.floor((e.clientX - r.left) / cell), cy = Math.floor((e.clientY - r.top) / cell);
    const key = cx + ':' + cy; if (key === last) return; last = key;
    const el = cells[head++ % cells.length];
    el.style.transform = `translate(${cx * cell}px, ${cy * cell}px)`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }, { passive: true });
});

// ---------------------------------------------------------------- WebGL helpers
const BAYER8 = `
float bayer8(ivec2 p) {
  p = p & 7; int xy = p.x ^ p.y; int v = 0;
  for (int k = 0; k < 3; k++) { int s = 2 * (2 - k); v |= (((xy >> k) & 1) << (s + 1)) | (((p.y >> k) & 1) << s); }
  return (float(v) + 0.5) / 64.0;
}`;
const NOISE = `
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash31(i), hash31(i + vec3(1, 0, 0)), u.x); float b = mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), u.x);
  float c = mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), u.x); float d = mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(17.1, 9.2, 3.7); a *= 0.5; } return s / 0.9375; }`;
const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
function program(gl, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; };
  const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}
const gl2 = (c) => { try { return c.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' }); } catch { return null; } };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
const MAXR = 8;

// ---------------------------------------------------------------- dither field (the dissolving waterline band)
const FIELD_FS = `#version 300 es
precision highp float; precision highp int;
uniform vec2 uGrid; uniform float uTime, uScale, uDensity, uGrain; uniform vec2 uRamp; uniform vec3 uColor; uniform vec3 uPointer;
uniform vec4 uRipples[${MAXR}];
out vec4 o;
${BAYER8}
${NOISE}
void main() {
  vec2 dp = floor(gl_FragCoord.xy);
  vec2 cell = floor(dp / uGrain) * uGrain;
  vec2 uv = cell / uGrid.y;
  float v = fbm(vec3(uv * 2.4 / uScale, uTime * 0.05));
  v = (v - 0.5) * 1.6 + uDensity;
  float y = dp.y / max(uGrid.y - 1.0, 1.0);
  if (uRamp.x > 0.5) v += uRamp.y * (0.55 - y) * 1.6;
  if (uPointer.z > 0.001) { vec2 d = (dp - uPointer.xy) / uGrid.y; v += uPointer.z * 0.38 * exp(-dot(d, d) / 0.012); }
  for (int i = 0; i < ${MAXR}; i++) {
    vec4 r = uRipples[i]; if (r.w <= 0.0) continue;
    float t = uTime - r.z; if (t < 0.0 || t > 3.0) continue;
    float dist = length((dp - r.xy) / uGrid.y);
    float ring = exp(-pow((dist - t * 0.55) / 0.045, 2.0));
    v = max(v, ring * exp(-t * 1.1) * exp(-dist * 1.5) * 1.15);
  }
  float on = step(bayer8(ivec2(dp)), v);
  o = vec4(uColor * on, on);
}`;

function ditherField(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'dfield'; canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const gl = gl2(canvas); const prog = gl && program(gl, FIELD_FS);
  if (!prog) return;
  const d = host.dataset;
  const px = Number(d.px || 6), grain = Number(d.grain || 2), speed = Number(d.speed || 1);
  const U = (n) => gl.getUniformLocation(prog, n);
  const L = { grid: U('uGrid'), time: U('uTime'), scale: U('uScale'), density: U('uDensity'), grain: U('uGrain'), ramp: U('uRamp'), color: U('uColor'), pointer: U('uPointer'), ripples: U('uRipples') };
  gl.useProgram(prog);
  gl.uniform3fv(L.color, rgb(d.color || '#0b0b0b'));
  gl.uniform1f(L.scale, Number(d.scale || 0.8));
  gl.uniform1f(L.density, Number(d.density || 0.1));
  gl.uniform1f(L.grain, grain);
  gl.uniform2f(L.ramp, 1, Number(d.strength || 0.95));
  const vao = gl.createVertexArray();
  const rip = new Float32Array(MAXR * 4); let ri = 0;
  let cols = 1, rows = 1, time = 0, last = 0;
  const ptr = { x: 0, y: 0, s: 0, t: 0 };
  const draw = () => {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog); gl.uniform2f(L.grid, cols, rows); gl.uniform1f(L.time, time);
    gl.uniform3f(L.pointer, ptr.x, ptr.y, ptr.s); gl.uniform4fv(L.ripples, rip);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const resize = () => {
    cols = Math.max(1, Math.ceil(host.clientWidth / px)); rows = Math.max(1, Math.ceil(host.clientHeight / px));
    canvas.width = cols; canvas.height = rows; canvas.style.width = cols * px + 'px'; canvas.style.height = rows * px + 'px';
    draw();
  };
  new ResizeObserver(resize).observe(host); resize();
  const toDots = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / px, y: rows - (e.clientY - r.top) / px }; };
  const events = host.closest('[data-ripple]') || host;
  const ripple = (x, y) => { rip.set([x, y, time, 1], ri * 4); ri = (ri + 1) % MAXR; };
  host._ripple = (fx, fy) => ripple(fx * cols, rows - fy * rows);
  if (!reduced) {
    events.addEventListener('pointerdown', (e) => { if (e.target.closest('input, textarea, select, button, a, video')) return; const p = toDots(e); ripple(p.x, p.y); });
    if (finePointer) {
      events.addEventListener('pointermove', (e) => { const p = toDots(e); ptr.x = p.x; ptr.y = p.y; ptr.t = p.y >= 0 && p.y <= rows ? 1 : 0; }, { passive: true });
      events.addEventListener('pointerleave', () => { ptr.t = 0; });
    }
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (now - last < 32) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0.033; last = now;
      if (!visible(canvas)) return;
      time += dt * speed; ptr.s += (ptr.t - ptr.s) * (1 - Math.exp(-6 * dt));
      draw();
    };
    requestAnimationFrame(loop);
  }
}
document.querySelectorAll('[data-dither]').forEach(ditherField);

// ---------------------------------------------------------------- dithered flower (stage idle scene)
const FLOWER_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uImg; uniform vec2 uGrid; uniform vec2 uSize; uniform float uTime; uniform vec3 uInk, uPaper;
uniform float uColor; uniform vec4 uRipples[${MAXR}];
out vec4 o;
${BAYER8}
${NOISE}
void main() {
  vec2 dp = floor(gl_FragCoord.xy);
  vec2 uv = (dp + 0.5) / uGrid;
  float asp = uGrid.x / uGrid.y;
  vec2 q = vec2(uv.x * asp, uv.y);
  float t = uTime;
  // slow liquid drift
  vec2 off = (vec2(fbm(vec3(q * 1.2, t * 0.05)), fbm(vec3(q * 1.2 + 7.3, t * 0.05))) - 0.5) * 0.022;
  off.x += sin(uv.y * 9.0 + t * 0.9) * 0.0025;
  // stepped scanline glitches, a few rows at a time
  float slice = floor(dp.y / 4.0);
  float tick = floor(t * 1.6);
  float band = step(0.9, hash31(vec3(floor(dp.y / 22.0), tick, 5.0)));
  float g = band * step(0.55, hash31(vec3(slice, tick, 1.0)));
  off.x += g * (hash31(vec3(slice, tick, 2.0)) - 0.5) * 0.06;
  // ripple rings
  float ringSum = 0.0;
  for (int i = 0; i < ${MAXR}; i++) {
    vec4 r = uRipples[i]; if (r.w <= 0.0) continue;
    float age = t - r.z; if (age < 0.0 || age > 4.0) continue;
    vec2 d = (dp - r.xy) / uGrid.y; float dist = length(d);
    float ring = exp(-pow((dist - age * 0.3) / 0.04, 2.0)) * exp(-age * 0.85);
    off += (dist > 0.001 ? d / dist : vec2(0.0)) * ring * 0.022;
    ringSum += ring;
  }
  vec2 iuv = uv + off; iuv.y = 1.0 - iuv.y;
  float ia = uSize.x / uSize.y; vec2 s = vec2(1.0);
  if (asp > ia) s.y = ia / asp; else s.x = asp / ia;
  iuv = (iuv - 0.5) * s + 0.5;
  vec3 c = texture(uImg, clamp(iuv, 0.001, 0.999)).rgb;
  float lum = pow(dot(c, vec3(0.299, 0.587, 0.114)), 0.62);
  lum = clamp((lum - 0.5) * 1.35 + 0.5, 0.0, 1.0);
  float thr = bayer8(ivec2(dp));
  vec3 mono = lum > thr ? uPaper : uInk;
  // colour blooms: the photo shows through in ordered-dithered colour where the noise peaks, and along ripples
  float bloom = fbm(vec3(q * 1.25 + 11.0, t * 0.055));
  float rv = clamp((bloom - 0.5) * 5.0 + ringSum * 2.4, 0.0, 1.0) * uColor;
  float reveal = step(thr, rv);
  vec3 cc = clamp(pow(c, vec3(0.72)) * 1.08, 0.0, 1.0);
  vec3 col = floor(cc * 3.0 + thr) / 3.0;
  o = vec4(mix(mono, col, reveal), 1.0);
}`;

function flower(box) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  box.prepend(canvas);
  const gl = gl2(canvas); const prog = gl && program(gl, FLOWER_FS);
  if (!prog) { box.dataset.fallback = ''; canvas.remove(); return; }
  const px = Number(box.dataset.px || 3);
  const U = (n) => gl.getUniformLocation(prog, n);
  const L = { grid: U('uGrid'), size: U('uSize'), time: U('uTime'), ink: U('uInk'), paper: U('uPaper'), color: U('uColor'), ripples: U('uRipples') };
  const src = new Image(); src.src = box.dataset.src;
  const tex = gl.createTexture();
  const vao = gl.createVertexArray();
  const rip = new Float32Array(MAXR * 4); let ri = 0;
  let cols = 1, rows = 1, time = 3, last = 0, ready = false, nextAuto = 1.5;
  gl.useProgram(prog);
  gl.uniform3fv(L.ink, rgb('#0b0b0b')); gl.uniform3fv(L.paper, rgb('#fffbf1'));
  gl.uniform1f(L.color, box.dataset.color === 'off' ? 0 : 1);
  const draw = () => {
    if (!ready) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog); gl.uniform2f(L.grid, cols, rows); gl.uniform1f(L.time, time); gl.uniform4fv(L.ripples, rip);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const upload = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(prog); gl.uniform2f(L.size, src.naturalWidth, src.naturalHeight);
    ready = true; draw();
  };
  src.decode().then(upload).catch(() => { box.dataset.fallback = ''; });
  const resize = () => {
    cols = Math.max(1, Math.ceil(box.clientWidth / px)); rows = Math.max(1, Math.ceil(box.clientHeight / px));
    canvas.width = cols; canvas.height = rows;
    canvas.style.width = cols * px + 'px'; canvas.style.height = rows * px + 'px'; canvas.style.inset = 'auto'; canvas.style.left = canvas.style.top = '0';
    draw();
  };
  new ResizeObserver(resize).observe(box); resize();
  const ripple = (x, y) => { rip.set([x, y, time, 1], ri * 4); ri = (ri + 1) % MAXR; };
  (box.closest('[data-ripple]') || box).addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, select')) return;
    const r = canvas.getBoundingClientRect();
    ripple((e.clientX - r.left) / px, rows - (e.clientY - r.top) / px);
  });
  if (reduced) return;
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (now - last < 41) return; // ~24fps: the stepped cadence is part of the look
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0.04; last = now;
    if (!visible(canvas)) return;
    time += dt;
    if (time > nextAuto) { ripple(cols * (0.15 + Math.random() * 0.7), rows * (0.15 + Math.random() * 0.7)); nextAuto = time + 3.5 + Math.random() * 3; }
    draw();
  };
  requestAnimationFrame(loop);
}
document.querySelectorAll('.flower[data-src]').forEach(flower);

// ---------------------------------------------------------------- click bursts (page-wide paper toy)
if (!reduced && page !== 'view') {
  const C = ['#5b3cff', '#ff5a36', '#0b0b0b', '#ffe600']; let n = 0;
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, textarea, select, video, [data-no-burst]')) return;
    const host = document.createElement('span');
    host.className = 'cburst'; host.setAttribute('aria-hidden', 'true');
    host.style.transform = `translate(${Math.round(e.clientX / 4) * 4}px, ${Math.round(e.clientY / 4) * 4}px)`;
    host.style.setProperty('--cb', C[n++ % C.length]);
    host.appendChild(document.createElement('b'));
    const count = finePointer ? 8 : 6;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (n % 2) * 0.4, r = 44 + (i % 3) * 14, p = document.createElement('i');
      p.style.setProperty('--dx', Math.round((Math.cos(a) * r) / 8) * 8 + 'px');
      p.style.setProperty('--dy', Math.round((Math.sin(a) * r) / 8) * 8 + 'px');
      host.appendChild(p);
    }
    document.body.appendChild(host);
    setTimeout(() => host.remove(), 600);
  }, { passive: true });
}

// ---------------------------------------------------------------- mic meter: size the colour ramp to the track
document.querySelectorAll('.meter').forEach((m) => {
  const t = m.querySelector('.meter__track');
  new ResizeObserver(() => m.style.setProperty('--tw', t.clientWidth + 'px')).observe(t);
});

// ---------------------------------------------------------------- dither photo: tap to reveal colour
document.querySelectorAll('.dimg').forEach((d) => d.addEventListener('click', () => d.toggleAttribute('data-on')));

// ---------------------------------------------------------------- recordings: prints develop through a Bayer veil
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
function veil(rec) {
  const video = rec.querySelector('video'); if (!video || rec.querySelector('.veil')) return;
  const c = document.createElement('canvas'); c.className = 'veil'; rec.appendChild(c);
  const ctx = c.getContext('2d'); const cell = 8;
  const size = () => { const w = video.clientWidth, h = video.clientHeight; c.style.height = h + 'px'; c.width = Math.ceil(w / cell); c.height = Math.ceil(h / cell); };
  const paint = (p) => {
    ctx.clearRect(0, 0, c.width, c.height); ctx.fillStyle = '#0b0b0b';
    for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
      const sweep = ((i + j) / (c.width + c.height)) * 0.35;
      if (B4[(j % 4) * 4 + (i % 4)] * 0.65 + sweep >= p) ctx.fillRect(i, j, 1, 1);
    }
  };
  size(); paint(0);
  if (reduced) { c.remove(); return; }
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return; io.disconnect();
    let k = 0; const steps = 16;
    const tick = () => { k++; paint(k / steps); if (k < steps) setTimeout(tick, 55); else c.remove(); };
    setTimeout(tick, 120 + Math.random() * 240);
  }, { threshold: 0.25 });
  io.observe(rec);
}
const recList = document.getElementById('recList');
if (recList) new MutationObserver(() => recList.querySelectorAll('.rec').forEach(veil)).observe(recList, { childList: true });

// ---------------------------------------------------------------- stage: fullscreen (button + F), pointer calm
const stage = document.querySelector('.stage');
if (stage && page === 'view') {
  const btns = document.querySelectorAll('.fs-btn');
  const toggle = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else stage.requestFullscreen?.().catch(() => {}); };
  btns.forEach((b) => b.addEventListener('click', toggle));
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggle(); }
  });
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    btns.forEach((b) => { b.querySelector('.fs-lbl').textContent = on ? 'Exit fullscreen' : 'Fullscreen'; b.querySelector('kbd').textContent = on ? 'Esc' : 'F'; });
  });
  let calm;
  const wake = () => { document.body.dataset.pointer = 'on'; clearTimeout(calm); calm = setTimeout(() => delete document.body.dataset.pointer, 2600); };
  addEventListener('pointermove', wake, { passive: true }); wake();
}
