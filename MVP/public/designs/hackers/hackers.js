// Purdue Hackers design: nav highlight + the idle pixel field (dithered, drawn at grid resolution, scaled up pixelated).
const page = document.body.dataset.page;
document.querySelectorAll('.top nav a[data-k]').forEach(a => a.classList.toggle('on', a.dataset.k === page));

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const ACC = [[125, 59, 255], [255, 47, 214], [31, 168, 255], [255, 238, 0]];
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

document.querySelectorAll('canvas.pixfield').forEach(cv => {
  const ctx = cv.getContext('2d');
  let cols = 0, rows = 0, img;
  const fit = () => {
    const r = cv.getBoundingClientRect();
    const cell = Math.max(8, r.width / 150);
    cols = Math.max(20, Math.round(r.width / cell)); rows = Math.max(12, Math.round(r.height / cell));
    cv.width = cols; cv.height = rows; img = ctx.createImageData(cols, rows);
  };
  fit(); addEventListener('resize', fit);
  let last = 0;
  const frame = t => {
    requestAnimationFrame(frame);
    if (t - last < 66) return; last = t;
    if (!cv.offsetParent && getComputedStyle(cv).display === 'none') return;
    const T = t / 1000, d = img.data;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const u = x / cols, v = y / rows;
      // a rising dithered tide from the bottom plus slow interference waves on the right
      const tide = Math.pow(v, 3.4) * 1.05 + .12 * Math.sin(u * 9 + T * .7) + .08 * Math.sin(u * 23 - T * 1.3);
      const waves = (Math.sin(x * .17 + T * .5) + Math.sin(y * .23 - T * .35) + Math.sin((x - y) * .09 + T * .8)) / 6 + .5;
      const right = Math.max(0, (u - .52) * 2.1);
      let val = Math.max(tide, waves * right * .9 - .12);
      // keep a calm pocket behind the headline copy
      const pocket = Math.max(0, 1 - Math.hypot((u - .22) / .4, (v - .5) / .5));
      val *= 1 - Math.min(1, pocket * 1.8);
      // calm the middle third so headline + up-next breathe
      const mid = Math.max(0, 1 - Math.abs(u - .5) / .2) * (v < .85 ? 1 : .3);
      val *= 1 - .6 * mid;
      const h = hash(x, y);
      if (h > .996) val += .5 + .5 * Math.sin(T * 3 + h * 99); // twinkles
      const on = val > BAYER[(y & 3) * 4 + (x & 3)];
      const i = (y * cols + x) * 4;
      if (on) {
        const acc = hash(x + Math.floor(T * .5), y) > .985;
        const c = acc ? ACC[Math.floor(hash(y, x) * 4)] : [244, 240, 230];
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      } else { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
  };
  requestAnimationFrame(frame);
});

// Watch page: Fullscreen button + F key put the whole .stage on the display; Esc exits (browser default).
// In fullscreen the controls and cursor hide until the mouse moves.
if (document.body.dataset.page === 'view') {
  const stage = document.querySelector('.stage');
  const fsBtn = document.getElementById('fsBtn');
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage?.requestFullscreen?.().catch(() => {});
  };
  fsBtn?.addEventListener('click', toggleFs);
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFs(); }
  });
  document.addEventListener('fullscreenchange', () => {
    if (fsBtn) fsBtn.innerHTML = document.fullscreenElement ? 'Exit fullscreen <kbd>Esc</kbd>' : 'Fullscreen <kbd>F</kbd>';
    dispatchEvent(new Event('resize'));
  });
  let calm;
  addEventListener('pointermove', () => {
    document.body.dataset.pointer = 'on';
    clearTimeout(calm);
    calm = setTimeout(() => { delete document.body.dataset.pointer; }, 2500);
  });
}
