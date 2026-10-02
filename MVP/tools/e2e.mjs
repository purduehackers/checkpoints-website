// End-to-end check of the default design on localhost:4747 (start the server first) with fake screen + mic, plus screenshots.
import fs from 'node:fs';
import { chromium } from 'playwright';

const B = 'http://localhost:4747';
const OUT = 'screenshots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = () => browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone', 'camera', 'notifications'] });
const errors = [];
const watchErrors = (p, name) => { p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`)); };

const admin = await (await ctx()).newPage(); watchErrors(admin, 'admin');
const view = await (await ctx()).newPage(); watchErrors(view, 'view');
const ada = await (await ctx()).newPage(); watchErrors(ada, 'ada');
const bob = await (await ctx()).newPage(); watchErrors(bob, 'bob');
await admin.goto(B + '/admin'); await view.goto(B + '/view');
await ada.goto(B + '/'); await bob.goto(B + '/');
await ada.waitForTimeout(800);
await ada.screenshot({ path: `${OUT}/join-form.png` });

await ada.fill('[name=name]', 'Ada'); await ada.fill('[name=note]', 'Plant-watering robot');
await ada.click('#joinForm button[type=submit]');
await bob.fill('[name=name]', 'Bob'); await bob.fill('[name=note]', 'Pixel synth');
await bob.click('#joinForm button[type=submit]');
await ada.waitForFunction(() => document.body.dataset.stage === 'queued', null, { timeout: 5000 });
await ada.click('#preShareBtn');
await ada.waitForFunction(() => document.body.dataset.armed === 'yes', null, { timeout: 5000 });
await ada.click('#testBtn');
await ada.waitForTimeout(1500);
console.log('mic rows:', await ada.locator('#micList .mic').count(), '| label:', await ada.textContent('#meterLabel'));
await ada.screenshot({ path: `${OUT}/join-queued-armed.png`, fullPage: true });
await admin.waitForTimeout(1200);
await admin.screenshot({ path: `${OUT}/admin-queue.png` });
await view.screenshot({ path: `${OUT}/view-idle.png` });

await admin.click('#nextBtn');
await ada.waitForFunction(() => document.body.dataset.stage === 'turn', null, { timeout: 5000 });
await ada.screenshot({ path: `${OUT}/join-turn.png` });
await ada.click('#shareBtn');
await ada.waitForFunction(() => document.body.dataset.stage === 'sharing', null, { timeout: 8000 });
await view.waitForFunction(() => { const v = document.querySelector('#stageVideo'); return v.srcObject && v.videoWidth > 0; }, null, { timeout: 15000 })
  .then(() => console.log('view: receiving video'), () => console.log('view: NO VIDEO'));
await admin.waitForFunction(() => document.querySelector('#stageVideo').videoWidth > 0, null, { timeout: 15000 })
  .then(() => console.log('admin: receiving video'), () => console.log('admin: NO VIDEO'));
await ada.waitForTimeout(2500);
await view.screenshot({ path: `${OUT}/view-live.png` });
await admin.screenshot({ path: `${OUT}/admin-live.png` });
await ada.screenshot({ path: `${OUT}/join-sharing.png` });
console.log('admin stopwatch:', await admin.textContent('#stopwatch'));

await admin.click('#stopBtn');
await ada.waitForTimeout(3000);
const recs = await (await admin.request.get(B + '/api/recordings')).json();
console.log('newest recording:', recs[0]?.name, recs[0]?.duration + 's');
const rp = await (await ctx()).newPage(); watchErrors(rp, 'recordings');
await rp.goto(B + '/recordings'); await rp.waitForTimeout(1000);
await rp.screenshot({ path: `${OUT}/recordings.png` });
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
const mp = await m.newPage(); await mp.goto(B + '/'); await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/join-mobile.png` });
console.log('horizontal overflow on mobile:', await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await bob.click('#leaveBtn');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
