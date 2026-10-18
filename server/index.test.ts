// HTTP and WebSocket abuse: the server must stay up and cheap under hostile clients.
import { afterAll, expect, test } from 'bun:test'

process.env.TURSO_DATABASE_URL = ':memory:'
process.env.ADMIN_PASSCODE = 'test-passcode-long-enough'
const { app } = await import('./index')
app.listen(0)
const base = `http://localhost:${app.server!.port}/api`
afterAll(() => app.stop())

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

// Collects every message a socket gets after sending `msgs`, for `ms` milliseconds.
async function socket(msgs: unknown[], ms = 400) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws')
  const got: any[] = []
  let closed = false
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)))
  ws.onclose = () => (closed = true)
  await new Promise((r) => (ws.onopen = r))
  for (const m of msgs) ws.send(typeof m === 'string' ? m : JSON.stringify(m))
  await Bun.sleep(ms)
  ws.close()
  return { got, closed }
}

test('errors say nothing about internals', async () => {
  const bad = await post('/join', { token: 123, name: [], project: {} })
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'Invalid request' })
  expect((await post('/nope', {})).status).toBe(404)
  expect((await post('/admin/stop', { id: 'x' }, { 'x-admin-token': 'x'.repeat(64) })).status).toBe(401)
})

test('request bodies are size-limited', async () => {
  const r = await post('/join', { token: 'tok-big-body', name: 'x'.repeat(200_000), project: 'p' })
  expect(r.status).toBe(413)
})

test('a socket subscribes once; repeated messages get no extra replies', async () => {
  const { got } = await socket(Array.from({ length: 50 }, () => ({ role: 'host' })))
  expect(got).toHaveLength(1)
})

test('a hacker socket with a bad token is ignored', async () => {
  for (const token of ['short', 'x'.repeat(65), 42, null]) expect((await socket([{ role: 'hacker', token }])).got).toEqual([])
})

test('oversized socket messages close the socket', async () => {
  const { got, closed } = await socket([JSON.stringify({ role: 'host', pad: 'x'.repeat(100_000) })])
  expect(got).toEqual([])
  expect(closed).toBe(true)
})

test('one IP cannot hold every socket', async () => {
  const opened = await Promise.all(Array.from({ length: 160 }, () => new Promise<WebSocket>((r) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws')
    ws.onopen = () => { ws.send(JSON.stringify({ role: 'host' })); r(ws) }
    ws.onclose = () => r(ws) // refused before opening counts as not live
  })))
  await Bun.sleep(500)
  const live = opened.filter((ws) => ws.readyState === WebSocket.OPEN).length
  opened.forEach((ws) => ws.close())
  expect(live).toBeLessThanOrEqual(100)
  await Bun.sleep(200)
})

// ---- organizer flow over HTTP, from its own IP so the abuse tests' budgets don't interfere ----
const ip = { 'x-real-ip': '10.9.9.9' }
let admin: Record<string, string> = {}
const as = (path: string, body: object = {}) => post('/admin' + path, body, admin)
const hacker = (path: string, token: string, body: object = {}) => post(path, { token, ...body }, ip).then((r) => r.json())
// The server runs in this process, so moving Date.now moves the server's clock too. Frozen, so exact times compare.
async function at<T>(ms: number, fn: () => Promise<T>) {
  const real = Date.now, fixed = real() + ms
  Date.now = () => fixed
  try { return await fn() } finally { Date.now = real }
}
const MIN = 60_000

test('organizer routes: login, a fresh checkpoint, and bad input is refused', async () => {
  const { token } = await (await post('/admin/login', { passcode: 'test-passcode-long-enough' }, ip)).json()
  admin = { ...ip, 'x-admin-token': token }
  await as('/session/end'); expect((await as('/session/start')).status).toBe(200)
  await hacker('/join', 'http-aaaaaaaa', { name: 'Ann', project: 'P' })
  const id = (await (await as('/limit', { seconds: 120 })).json()).current.entryId
  expect((await as('/stop', {})).status).toBe(400) // must say who to stop
  for (const delta of [45, 0, '30', -3000]) expect((await as('/adjust', { id, delta })).status).toBe(400)
  expect((await as('/call-next', { expect: null })).status).toBe(404) // removed
  for (const path of ['/pause', '/resume', '/adjust', '/stop']) {
    expect((await post('/admin' + path, { id, delta: 30 }, { ...ip, 'x-admin-token': 'nope'.repeat(16) })).status).toBe(401)
  }
})

test('pause over HTTP: the projector and the presenter both see the same frozen time', async () => {
  await as('/session/end'); await as('/session/start')
  await hacker('/join', 'http-aaaaaaaa', { name: 'Ann', project: 'P' })
  const { current } = await hacker('/ready', 'http-aaaaaaaa', { noShare: true })
  expect(current.status).toBe('live')
  const paused = (await (await as('/pause', { id: current.entryId })).json()).current
  expect(paused.pausedLeft).toBeGreaterThan(110_000)
  await at(3 * MIN, async () => { // well past the 2-minute deadline
    const mine = (await hacker('/share-state', 'http-aaaaaaaa', { state: 'not_shared' })).current
    expect(mine).toMatchObject({ status: 'live', pausedLeft: paused.pausedLeft })
    const resumed = (await (await as('/resume', { id: current.entryId })).json()).current
    expect(resumed.pausedLeft).toBeNull()
    expect(resumed.deadline - Date.now()).toBe(paused.pausedLeft)
  })
})

test('hacker requests keep the night active but do not count as an organizer', async () => {
  await as('/session/end'); await as('/session/start')
  await hacker('/join', 'http-aaaaaaaa', { name: 'Ann', project: 'P' })
  await at(4 * MIN, () => hacker('/share-state', 'http-aaaaaaaa', { state: 'sharing' }))
  const s = await at(5 * MIN + 1000, () => hacker('/share-state', 'http-aaaaaaaa', { state: 'not_shared' }))
  expect(s.session.status).toBe('closed')
})

test('an organizer click keeps it alive for another 5 minutes', async () => {
  await as('/session/end'); await as('/session/start')
  await at(4 * MIN, () => as('/audio', { on: true }))
  expect((await at(8 * MIN, async () => (await as('/audio', { on: true })).json())).session.status).toBe('open')
})

test('an organizer coming back after a timeout finds it ended, not revived', async () => {
  await as('/session/end'); await as('/session/start')
  // Nobody had a page open, so nothing ticked; the late request itself must see the timeout first.
  const s = await at(6 * MIN, async () => (await as('/audio', { on: true })).json())
  expect(s.session.status).toBe('closed')
  // And a socket opening late sees it ended too.
  const late = await at(6 * MIN, () => socket([{ role: 'host' }]))
  expect(late.got.at(-1).session.status).toBe('closed')
  // Starting again gives a fresh night that doesn't end straight away.
  const fresh = await at(6 * MIN, async () => (await as('/session/start')).json())
  expect(fresh.session.status).toBe('open')
})

test('passcode guessing is locked out per IP, even for the right passcode', async () => {
  for (let i = 0; i < 10; i++) expect((await post('/admin/login', { passcode: 'guess-' + i })).status).toBe(401)
  expect((await post('/admin/login', { passcode: 'test-passcode-long-enough' })).status).toBe(429)
})

// sendBeacon posts a Blob with its own content-type; the reply is never read.
test('/bye accepts a beacon-style JSON body and rejects a bad one', async () => {
  const ok = await fetch(base + '/bye', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Blob([JSON.stringify({ token: 'bye-token-1234' })], { type: 'application/json' }) })
  expect(ok.status).toBe(200)
  expect((await post('/bye', { token: 1 })).status).toBe(400)
})

// Last: it uses up this IP's request budget.
test('one IP is rate limited across all routes', async () => {
  const codes = await Promise.all(Array.from({ length: 700 }, () => fetch(base + '/health').then((r) => r.status)))
  expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  expect(codes.filter((c) => c === 200).length).toBeGreaterThan(100) // a busy NAT still gets through
})
