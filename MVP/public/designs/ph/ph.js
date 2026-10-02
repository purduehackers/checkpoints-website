// ph design: nav highlight, pixel buttons, and the Conway glider + dither band from purduehackers.com (our own code).
const page = document.body.dataset.page;
document.querySelectorAll('.top nav a[data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === page));

// Pixel buttons: a grid of squares that flips to black in a random order on hover.
document.querySelectorAll('.pxbtn').forEach((b) => {
  const lbl = document.createElement('span'); lbl.className = 'lbl';
  while (b.firstChild) lbl.append(b.firstChild);
  const px = document.createElement('span'); px.className = 'px'; px.setAttribute('aria-hidden', 'true');
  const cols = 10, n = cols * 6;
  const order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
  px.innerHTML = order.map((i) => `<i style="--i:${i}"></i>`).join('');
  b.style.setProperty('--cols', cols);
  b.append(px, lbl);
});

// Glider band: Conway's Life on a 10px grid. The bottom rows are a pinned dither that gliders crash into.
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
document.querySelectorAll('.life').forEach((wrap) => {
  const cv = document.createElement('canvas'); wrap.append(cv);
  const ctx = cv.getContext('2d');
  const CELL = 10, DITHER = Number(wrap.dataset.dither || 30), ROWS = Number(wrap.dataset.rows || 52);
  let cols = 0, grid, next;
  const pinned = (x, y) => {
    const d = y - (ROWS - DITHER);
    if (d < 0) return 0;
    return hash(x, y) < Math.pow((d + 1) / DITHER, 1.7) ? 1 : 0;
  };
  const fit = () => {
    cols = Math.ceil(wrap.clientWidth / CELL);
    cv.width = cols; cv.height = ROWS;
    cv.style.width = `${cols * CELL}px`; cv.style.height = `${ROWS * CELL}px`;
    grid = new Uint8Array(cols * ROWS); next = new Uint8Array(cols * ROWS);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < cols; x++) grid[y * cols + x] = pinned(x, y);
    if (ctx) draw(); // resizing a canvas clears it
  };
  const spawn = () => {
    const ox = Math.floor(Math.random() * Math.max(1, cols - 6)), oy = Math.floor(Math.random() * 6);
    const flip = Math.random() < 0.5;
    for (const [gx, gy] of GLIDER) { const x = flip ? ox + 2 - gx : ox + gx; grid[(oy + gy) * cols + x] = 1; }
  };
  const step = () => {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < cols; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < ROWS) n += grid[yy * cols + xx];
      }
      const i = y * cols + x, alive = grid[i];
      next[i] = y >= ROWS - DITHER + 8 ? pinned(x, y) : (alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0));
    }
    [grid, next] = [next, grid];
  };
  function draw() {
    ctx.clearRect(0, 0, cols, ROWS);
    ctx.fillStyle = getComputedStyle(wrap).color;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < cols; x++) if (grid[y * cols + x]) ctx.fillRect(x, y, 1, 1);
  }
  fit(); addEventListener('resize', fit);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0;
  for (let i = 0; i < 4; i++) spawn();
  draw();
  if (!still) setInterval(() => { if (document.hidden) return; if (++t % 14 === 0) spawn(); step(); draw(); }, 100);
});

// Watch page: F or the button for fullscreen; controls and cursor hide until the mouse moves.
if (page === 'view') {
  const stage = document.querySelector('.stage'), fsBtn = document.getElementById('fsBtn');
  const toggle = () => (document.fullscreenElement ? document.exitFullscreen?.() : stage?.requestFullscreen?.().catch(() => {}));
  fsBtn?.addEventListener('click', toggle);
  addEventListener('keydown', (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); toggle(); } });
  let calm;
  addEventListener('pointermove', () => { document.body.dataset.pointer = 'on'; clearTimeout(calm); calm = setTimeout(() => delete document.body.dataset.pointer, 2500); });
}
