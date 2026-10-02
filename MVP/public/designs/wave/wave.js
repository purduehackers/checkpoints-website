// Idle art for Checkpoints / wave: stippled oscilloscope ridges drifting like a slow sea.
const cols = [[95, 212, 196], [180, 140, 255], [239, 143, 176]];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function colorAt(t) { return t < .5 ? mix(cols[0], cols[1], t * 2) : mix(cols[1], cols[2], (t - .5) * 2); }

document.querySelectorAll('canvas.waves').forEach((cv) => {
  const ctx = cv.getContext('2d');
  const dense = cv.dataset.dense === '1';
  let w = 0, h = 0;
  const fit = () => { const r = cv.getBoundingClientRect(); w = cv.width = Math.max(1, Math.round(r.width)); h = cv.height = Math.max(1, Math.round(r.height)); };
  fit(); new ResizeObserver(fit).observe(cv);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    const lines = dense ? 34 : 22;
    const top = h * (dense ? .16 : .3), span = h * (dense ? .74 : .66);
    const step = Math.max(3, w / (dense ? 420 : 300));
    for (let i = 0; i < lines; i++) {
      const f = i / (lines - 1);
      const base = top + f * span;
      const amp = h * (.018 + .05 * Math.sin(f * Math.PI)) ;
      const [r, g, b] = colorAt((f + .15 * Math.sin(t * .07)) % 1);
      const alpha = (dense ? .3 : .16) + .55 * Math.sin(f * Math.PI) ** 2;
      for (let x = -10; x < w + 10; x += step) {
        const u = x / w;
        const env = Math.exp(-((u - .5 - .22 * Math.sin(t * .05 + f * 2)) ** 2) / .09);
        const y = base
          + amp * env * (Math.sin(u * 9 + t * .6 + f * 5) + .55 * Math.sin(u * 23 - t * .9 + f * 11))
          + amp * .35 * Math.sin(u * 3.1 + t * .25 + f * 2.2);
        const jitter = (Math.random() - .5) * 2.2;
        const a = alpha * (.45 + .55 * env) * (.6 + Math.random() * .4);
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
        ctx.fillRect(x + jitter, y + jitter, dense ? 2.2 : 1.6, dense ? 2.2 : 1.6);
        if (Math.random() < .06 * env) { ctx.fillRect(x + (Math.random() - .5) * 14, y + (Math.random() - .5) * 14, 1.2, 1.2); }
      }
    }
    if (!still) requestAnimationFrame(frame);
  }
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
