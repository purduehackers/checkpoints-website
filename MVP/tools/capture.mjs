// Mirror a site's same-origin assets and screenshot it.
// usage: node capture.mjs <url> <outDir> [--mirror] [--shots-only-name=prefix]
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

const [url, outDir, ...flags] = process.argv.slice(2);
const mirror = flags.includes('--mirror');
const prefix = (flags.find((f) => f.startsWith('--name=')) || '--name=ref').slice(7);
const origin = new URL(url).origin;
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
];

for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: !!s.isMobile, deviceScaleFactor: s.deviceScaleFactor || 1 });
  const page = await ctx.newPage();
  if (mirror && s.name === 'desktop') {
    page.on('response', async (res) => {
      try {
        const u = new URL(res.url());
        if (u.origin !== origin || res.status() !== 200) return;
        let p = decodeURIComponent(u.pathname);
        if (p.endsWith('/')) p += 'index.html';
        // Vercel's image optimizer serves many images from one path; key them by query.
        if (p === '/_vercel/image') p += '/' + Buffer.from(u.search).toString('base64url');
        const file = path.join(outDir, 'mirror', p);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, await res.body());
      } catch {}
    });
  }
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, 'screenshots', `${prefix}-${s.name}.png`) });
  // Full page plus a few scroll frames for long pages.
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  if (h > s.height * 1.2) {
    await page.screenshot({ path: path.join(outDir, 'screenshots', `${prefix}-${s.name}-full.png`), fullPage: true }).catch(() => {});
  }
  if (s.name === 'desktop') {
    for (let i = 1; i <= 2; i++) { await page.waitForTimeout(900); await page.screenshot({ path: path.join(outDir, 'screenshots', `${prefix}-${s.name}-t${i}.png`) }); }
  }
  await ctx.close();
}
await browser.close();
console.log('done', url);
