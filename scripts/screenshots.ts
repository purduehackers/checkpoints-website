// Screenshots of every participant/admin/projector state for UI review.
// Run: bun run screenshots  (starts its own server on a throwaway local DB, never Turso)
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'

const OUT = `screenshots/review-${new Date().toISOString().slice(0, 10)}`
const WEB = 'http://localhost:4321'
const DB = 'screens.db'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
for (const f of [DB, `${DB}-shm`, `${DB}-wal`]) rmSync(f, { force: true })

if (await fetch('http://localhost:3000/health').then(() => true, () => false)) throw new Error('Stop the API server on :3000 first (this script runs its own on a throwaway DB)')
const env = { ...process.env, TURSO_DATABASE_URL: `file:${DB}`, TURSO_AUTH_TOKEN: '', ID_ISSUER: '', REDIS_URL: '', SESSION_SECRET: 'screens', PORT: '3000' }
// Astro allows one dev server per project: reuse a running `astro dev` (it proxies /api to :3000).
const webUp = await fetch(WEB).then(() => true, () => false)
const procs = [Bun.spawn(['bun', 'api/server.ts'], { env, stdout: 'ignore', stderr: 'inherit' }), ...(webUp ? [] : [Bun.spawn(['bunx', 'astro', 'dev'], { env, stdout: 'ignore', stderr: 'inherit' })])]
const cleanup = () => procs.forEach((p) => p.kill())
process.on('exit', cleanup)

for (let i = 0; ; i++) {
  if (await fetch(`${WEB}/api/info`).then((r) => r.ok, () => false)) break
  if (i > 120) throw new Error('dev server did not start')
  await Bun.sleep(500)
}

// No real picker in automation: hand back a canvas stream, kept on window so a test can "stop sharing".
const fakeShare = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 })
    const g = c.getContext('2d')!
    const draw = () => { g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fbcb3b'; g.font = 'bold 64px monospace'; g.fillText('Demo screen ' + new Date().toLocaleTimeString(), 80, 380); requestAnimationFrame(draw) }
    draw()
    return ((window as any).__share = c.captureStream(30))
  }
}

const browser: Browser = await chromium.launch()
const desktop = { viewport: { width: 1440, height: 1000 } }
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }

const shot = async (page: Page, name: string) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log('saved', name) }
const text = (page: Page, t: string | RegExp) => page.getByText(t).first().waitFor({ timeout: 20_000 })

async function participant(opts = desktop) {
  const ctx: BrowserContext = await browser.newContext(opts)
  await ctx.addInitScript(fakeShare)
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept()) // confirm() on leave
  await page.goto(WEB)
  return page
}
async function joinForm(page: Page, name: string, project: string) {
  await page.getByLabel('Your Name').fill(name)
  await page.getByLabel('Project Name').fill(project)
}

// Admin: password sign-in (preview mode), then drive the night through its API with the same cookie.
const adminCtx = await browser.newContext(desktop)
const admin = await adminCtx.newPage()
await admin.goto(`${WEB}/admin`)
await adminCtx.request.post(`${WEB}/api/auth/password`, { data: { password: '123456' } })
const adminApi = (path: string, data: object = {}) => adminCtx.request.post(`${WEB}/api/admin${path}`, { data }).then((r) => r.json())

// --- No checkpoint yet
const ada = await participant()
await text(ada, 'No checkpoint is running.')
await shot(ada, '10-no-checkpoint')

await adminApi('/session/start')
await admin.reload()
await text(admin, 'Queue')
await shot(admin, 'admin-01-empty')

// --- Form, then Ada joins by sharing; the stage is empty, so she's called right away
await ada.reload()
await text(ada, 'Join the Checkpoint')
await joinForm(ada, 'Ada Lovelace', 'Analytical Engine')
await shot(ada, '01-form')
await ada.getByRole('button', { name: 'Pick a screen to share' }).click()
await text(ada, 'It’s your turn!')
await shot(ada, '06-called')

// --- The line: Bo (up next), Cy (2nd), Dee (3rd), all sharing; Eve without sharing
const people: [string, string][] = [['Bo Chen', 'Bike lights'], ['Cy Park', 'Plant monitor'], ['Dee Ruiz', 'Pixel garden']]
const line: Page[] = []
for (const [n, p] of people) {
  const page = await participant()
  await joinForm(page, n, p)
  await page.getByRole('button', { name: 'Pick a screen to share' }).click()
  await text(page, /in line|up next/)
  line.push(page)
}
const [bo, cy, dee] = line
const eve = await participant()
await joinForm(eve, 'Eve Moss', 'Talk only')
await eve.getByRole('button', { name: 'I won’t need to share my screen' }).click()
await text(eve, 'in line')
await shot(bo, '03-waiting-up-next')
await shot(dee, '02-waiting-sharing-3rd')
await shot(eve, '05-waiting-no-share')

// Cy stops sharing from the browser bar: keeps the spot, gets told to share again.
await cy.evaluate(() => { const t = (window as any).__share.getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')) })
await text(cy, 'Share again before your turn')
await shot(cy, '04-waiting-share-stopped')

// Phone widths of the participant pages
const mForm = await participant(phone)
await text(mForm, 'Join the Checkpoint')
await joinForm(mForm, 'Fay Ito', 'Phone demo')
await shot(mForm, 'm01-form')
await mForm.getByRole('button', { name: 'I won’t need to share my screen' }).click()
await text(mForm, 'in line')
await shot(mForm, 'm02-waiting-no-share')
await mForm.getByRole('button', { name: 'Leave queue' }).click()

// --- Organizer and projector while Ada gets ready
await admin.reload()
await text(admin, 'Getting ready')
await shot(admin, 'admin-02-getting-ready')
const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
await host.goto(`${WEB}/host`)
await host.waitForTimeout(2000)
await shot(host, 'host-01-called')

// --- Ada goes live
await ada.getByRole('button', { name: 'Start Presenting' }).click()
await text(ada, 'You’re live')
await shot(ada, '07-live')
await text(admin, 'Live')
await shot(admin, 'admin-03-live')
await host.waitForTimeout(3000)
await shot(host, 'host-02-live')
const timer = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
await timer.goto(`${WEB}/timer`)
await timer.waitForTimeout(1500)
await shot(timer, 'timer-01-live')

// --- Ada ends: handoff window. Bo is called; admin can still add time to Ada.
await ada.getByRole('button', { name: 'End checkpoint' }).click()
await text(ada, 'Thanks for presenting!')
await shot(ada, '08-handoff')
await text(bo, 'It’s your turn!')
await shot(bo, '06b-called-after-handoff')
await text(admin, 'Previous:')
await shot(admin, 'admin-04-getting-ready-with-previous')

// Organizer gives Ada +30s: she's back live, Bo is back to up next.
await admin.getByRole('button', { name: '+30s' }).last().click()
await text(ada, 'You’re live')
await shot(ada, '08b-revived-live')
await text(bo, 'You’re up next!')
await shot(bo, '03b-back-to-up-next')

// Ada ends again, Bo starts: the handoff closes and Ada gets the thanks screen.
await ada.getByRole('button', { name: 'End checkpoint' }).click()
await text(bo, 'It’s your turn!')
await bo.getByRole('button', { name: 'Start Presenting' }).click()
await text(bo, 'You’re live')
await text(ada, 'Join again')
await shot(ada, '09-thanks')

// --- Removed by the organizer
const st = await adminApi('/session/start') // returns current state
await adminApi('/remove', { id: st.queue.find((e: any) => e.name === 'Dee Ruiz').id })
await text(dee, 'You were removed from the queue.')
await shot(dee, '12-removed')

// --- Checkpoint ended
await adminApi('/session/end')
await text(eve, 'This checkpoint has ended.')
await shot(eve, '11-ended')
await admin.reload()
await shot(admin, 'admin-05-ended')

await browser.close()
cleanup()
console.log(`\nScreenshots in ${OUT}`)
process.exit(0)
