// End-to-end check: drives a whole checkpoint night in a real browser and writes e2e-report/index.html
// (pass/fail per step + a screenshot of every page). Run: bun run e2e. Exit code 1 if any step failed.
// Uses a throwaway local DB and its own API on :3000, never Turso. Needs the internet (vdo.ninja streams).
import { chromium, type BrowserContext, type Page } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const OUT = 'e2e-report'
const WEB = 'http://localhost:4321'
const DB = 'e2e.db'
const TIMEOUT = 10_000
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
for (const f of [DB, `${DB}-shm`, `${DB}-wal`]) rmSync(f, { force: true })

if (await fetch('http://localhost:3000/api/health').then(() => true, () => false)) {
  console.error('Something is already on :3000 (probably `bun dev`). Stop it first: this check runs its own API on a throwaway DB.')
  process.exit(2)
}
const env = { ...process.env, TURSO_DATABASE_URL: `file:${DB}`, TURSO_AUTH_TOKEN: '', ID_ISSUER: '', REDIS_URL: '', SESSION_SECRET: 'e2e', PORT: '3000' }
// Astro allows one dev server per project: reuse a running `astro dev` (it proxies /api to :3000).
const webUp = await fetch(WEB).then(() => true, () => false)
const procs = [Bun.spawn(['bun', 'api/server.ts'], { env, stdout: 'ignore', stderr: 'ignore' }), ...(webUp ? [] : [Bun.spawn(['bunx', 'astro', 'dev'], { env, stdout: 'ignore', stderr: 'ignore' })])]
const cleanup = () => { procs.forEach((p) => p.kill()); for (const f of [DB, `${DB}-shm`, `${DB}-wal`]) rmSync(f, { force: true }) }
process.on('exit', cleanup)
for (let i = 0; !(await fetch(`${WEB}/api/info`).then((r) => r.ok, () => false)); i++) {
  if (i > 120) { console.error('Dev server did not start'); process.exit(2) }
  await Bun.sleep(500)
}

// --- Steps: each one passes or fails on its own; a failure is recorded with a screenshot and the run goes on.
type Result = { name: string; ok: boolean; error?: string; shots: string[] }
const results: Result[] = []
let current: Result | null = null
async function step(name: string, fn: () => Promise<void>, onFail?: Page) {
  current = { name, ok: true, shots: [] }
  try { await fn() } catch (e) {
    current.ok = false
    current.error = (e instanceof Error ? e.message : String(e)).split('\n')[0]
    if (onFail) await shot(onFail, `FAILED-${results.length + 1}`).catch(() => {})
  }
  results.push(current)
  console.log(`${current.ok ? 'PASS' : 'FAIL'}  ${name}${current.error ? `  (${current.error})` : ''}`)
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(700)
  const file = `${String(results.length + 1).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true })
  current?.shots.push(file)
}
const see = (page: Page, t: string | RegExp) => page.getByText(t).first().waitFor({ timeout: TIMEOUT })

// No real picker in automation: hand back a canvas stream, kept on window so a step can "stop sharing".
const fakeShare = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 })
    const g = c.getContext('2d')!
    const draw = () => { g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fbcb3b'; g.font = 'bold 64px monospace'; g.fillText('Demo screen ' + new Date().toLocaleTimeString(), 80, 380); requestAnimationFrame(draw) }
    draw()
    return ((window as any).__share = c.captureStream(30))
  }
}

const browser = await chromium.launch()
const desktop = { viewport: { width: 1440, height: 1000 } }
const wide = { viewport: { width: 1920, height: 1080 } }
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }

async function participant(opts = desktop) {
  const ctx: BrowserContext = await browser.newContext(opts)
  await ctx.addInitScript(fakeShare)
  const page = await ctx.newPage()
  page.setDefaultTimeout(TIMEOUT)
  page.setDefaultNavigationTimeout(60_000) // a cold dev server compiles on first load
  page.on('dialog', (d) => d.accept()) // confirm() on leave
  await page.goto(WEB)
  return page
}
const fill = async (page: Page, name: string, project: string) => {
  await page.getByLabel('Your Name').fill(name)
  await page.getByLabel('Project Name').fill(project)
}
const share = (page: Page) => page.getByRole('button', { name: 'Pick a screen to share' }).click()
const noShare = (page: Page) => page.getByRole('button', { name: 'I won’t need to share' }).click()
const button = (page: Page, name: string) => page.getByRole('button', { name }).last().click()

// Organizer: password sign-in (preview mode), then the page plus its API with the same cookie.
const adminCtx = await browser.newContext(desktop)
await adminCtx.request.post(`${WEB}/api/auth/password`, { data: { password: '123' } })
const admin = await adminCtx.newPage()
admin.setDefaultTimeout(TIMEOUT)
admin.setDefaultNavigationTimeout(60_000)
const adminApi = (path: string, data: object = {}) => adminCtx.request.post(`${WEB}/api/admin${path}`, { data }).then((r) => r.json())

const ada = await participant(), bo = await participant(), cy = await participant(), dee = await participant(), eve = await participant()
const host = await (await browser.newContext(wide)).newPage()
const timer = await (await browser.newContext(wide)).newPage()
for (const p of [host, timer]) { p.setDefaultTimeout(TIMEOUT); p.setDefaultNavigationTimeout(60_000) }

await step('No checkpoint running: participant sees that', async () => { await see(ada, 'No checkpoint is running.'); await shot(ada, 'no-checkpoint') }, ada)
await step('Public status endpoint says inactive', async () => { const r = await (await fetch(`${WEB}/api/info`)).json(); if (r.active !== false) throw new Error(`expected active:false, got ${JSON.stringify(r)}`) })
await step('Organizer starts a checkpoint', async () => { await adminApi('/session/start'); await admin.goto(`${WEB}/admin`); await see(admin, 'Queue'); await shot(admin, 'admin-empty') }, admin)
await step('Join form shows both choices', async () => {
  await ada.reload(); await see(ada, 'Join the Checkpoint'); await fill(ada, 'Ada Lovelace', 'Analytical Engine')
  await ada.getByRole('button', { name: 'Pick a screen to share' }).waitFor(); await ada.getByRole('button', { name: 'I won’t need to share' }).waitFor()
  await shot(ada, 'form')
}, ada)
await step('First person shares and is called right away (empty stage)', async () => { await share(ada); await see(ada, 'It’s your turn!'); await shot(ada, 'called') }, ada)
await step('Three more join by sharing; positions are right', async () => {
  for (const [p, n, proj] of [[bo, 'Bo Chen', 'Bike lights'], [cy, 'Cy Park', 'Plant monitor'], [dee, 'Dee Ruiz', 'Pixel garden']] as const) { await fill(p, n, proj); await share(p) }
  await see(bo, 'You’re next in line!'); await see(cy, 'You’re 2nd in line'); await see(dee, 'You’re 3rd in line')
  await shot(bo, 'next-in-line'); await shot(dee, 'third-in-line')
}, dee)
await step('Joining without sharing still puts you in line', async () => { await fill(eve, 'Eve Moss', 'Talk only'); await noShare(eve); await see(eve, 'You’re 4th in line'); await shot(eve, 'in-line-no-share') }, eve)
await step('Stopping your share keeps your place and says to share again', async () => {
  await cy.evaluate(() => { const t = (window as any).__share.getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')) })
  await see(cy, 'You’re 2nd in line'); await see(cy, /share again/i); await shot(cy, 'share-stopped')
}, cy)
await step('Phone: form and waiting fit the screen', async () => {
  const m = await participant(phone)
  await see(m, 'Join the Checkpoint'); await fill(m, 'Fay Ito', 'Phone demo'); await shot(m, 'phone-form')
  await noShare(m); await see(m, 'in line'); await shot(m, 'phone-in-line')
  await m.getByRole('button', { name: 'Leave queue' }).click(); await see(m, 'Join the Checkpoint')
})
await step('Admin shows the called person getting ready, queue in order', async () => {
  await admin.reload(); await see(admin, 'Getting ready'); await see(admin, 'Bo Chen'); await shot(admin, 'admin-getting-ready')
}, admin)
await step('Projector shows who is called', async () => { await host.goto(`${WEB}/host`); await see(host, 'Ada Lovelace'); await shot(host, 'projector-called') }, host)
await step('Start Presenting goes live (clock starts)', async () => { await button(ada, 'Start Presenting'); await see(ada, 'You’re live'); await see(ada, /left/); await shot(ada, 'live') }, ada)
await step('Admin shows them live with time controls', async () => { await see(admin, 'Live'); await admin.getByRole('button', { name: '+30s' }).first().waitFor(); await shot(admin, 'admin-live') }, admin)
await step('Projector shows the live stream', async () => { await host.waitForTimeout(4000); await shot(host, 'projector-live') }, host)
await step('Speaker timer counts down', async () => { await timer.goto(`${WEB}/timer`); await see(timer, /\d:\d\d/); await shot(timer, 'timer-live') }, timer)
await step('Presenter finishes: thanks screen, next person called', async () => {
  await button(ada, 'I’m done'); await see(ada, 'Thanks for presenting!'); await shot(ada, 'handoff')
  await see(bo, 'It’s your turn!'); await shot(bo, 'next-called')
}, ada)
await step('Admin can still give the previous presenter more time', async () => { await see(admin, 'Previous:'); await shot(admin, 'admin-previous') }, admin)
await step('+30s brings the previous presenter back; next goes back to first in line', async () => {
  await admin.locator('text=Previous:').locator('xpath=ancestor::div[2]').getByRole('button', { name: '+30s' }).click()
  await see(ada, 'You’re live'); await see(bo, 'You’re next in line!'); await shot(ada, 'revived-live'); await shot(bo, 'back-to-next')
}, admin)
await step('Next presenter starts; previous presenter gets the final thanks', async () => {
  await button(ada, 'I’m done'); await see(bo, 'It’s your turn!'); await button(bo, 'Start Presenting'); await see(bo, 'You’re live')
  await see(ada, 'Join again'); await shot(ada, 'thanks')
}, bo)
await step('Organizer removes someone: they are told', async () => {
  const st = await adminApi('/session/start') // no-op, returns current state
  await adminApi('/remove', { id: st.queue.find((e: any) => e.name === 'Dee Ruiz').id })
  await see(dee, 'You were removed from the queue.'); await shot(dee, 'removed')
}, dee)
await step('Admin timing stats load', async () => { const r = await adminCtx.request.get(`${WEB}/api/admin/metrics`); if (!r.ok()) throw new Error(`metrics ${r.status()}`) })
await step('Organizer ends the checkpoint: everyone sees it ended', async () => {
  await adminApi('/session/end'); await see(eve, 'This checkpoint has ended.'); await shot(eve, 'ended')
  await admin.reload(); await shot(admin, 'admin-ended')
}, eve)

await browser.close()

// --- Report: one page anyone can open.
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const failed = results.filter((r) => !r.ok).length
const stamp = new Date().toLocaleString()
const commit = (await new Response(Bun.spawn(['git', 'log', '-1', '--format=%h %s']).stdout).text()).trim()
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkpoints E2E</title>
<style>body{font:15px system-ui;background:#0b0b0b;color:#eee;margin:0 auto;max-width:1100px;padding:24px}h1{margin:0}.meta{color:#999;margin:4px 0 24px}
.step{border:1px solid #333;margin:0 0 16px;padding:12px 16px}.pass{border-left:6px solid #8bd450}.fail{border-left:6px solid #ff5c8a}.err{color:#ff5c8a;font-family:monospace;font-size:13px}
.shots{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.shots a img{height:180px;border:1px solid #333}</style>
<h1>${failed ? `${failed} of ${results.length} steps failed` : `All ${results.length} steps passed`}</h1>
<p class="meta">${esc(stamp)} · ${esc(commit)}</p>
${results.map((r, i) => `<div class="step ${r.ok ? 'pass' : 'fail'}"><b>${i + 1}. ${r.ok ? 'PASS' : 'FAIL'}</b> ${esc(r.name)}${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}
<div class="shots">${r.shots.map((f) => `<a href="${f}"><img src="${f}" alt="${f}"></a>`).join('')}</div></div>`).join('\n')}`)
console.log(`\n${failed ? `${failed} FAILED` : 'ALL PASSED'} · report: ${OUT}/index.html`)
process.exit(failed ? 1 : 0)
