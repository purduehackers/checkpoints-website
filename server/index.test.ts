// HTTP and WebSocket abuse: the server must stay up and cheap under hostile clients.
import { afterAll, expect, setSystemTime, test } from 'bun:test'

process.env.TURSO_DATABASE_URL = ':memory:'
process.env.ADMIN_PASSCODE = 'test-passcode-long-enough'
const { app } = await import('./index')
app.listen(0)
const base = `http://localhost:${app.server!.port}/api`
const wsUrl = base.replace('http', 'ws') + '/ws'
afterAll(() => app.stop())

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

// Opens a socket (optionally from its own IP), sends `msgs`, and keeps every message it gets.
async function connect(msgs: unknown[], ip?: string) {
  const ws = new WebSocket(wsUrl, (ip && { headers: { 'x-real-ip': ip } }) as any), got: any[] = []
  let closed = false
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)))
  ws.onclose = () => (closed = true)
  await new Promise((r) => (ws.onopen = r))
  for (const m of msgs) ws.send(typeof m === 'string' ? m : JSON.stringify(m))
  return { ws, got, closed: () => closed, react: (emoji: string) => ws.send(JSON.stringify({ react: emoji })) }
}
// One-shot: what a socket gets for `ms` after sending `msgs`.
async function socket(msgs: unknown[], ms = 400) {
  const s = await connect(msgs)
  await Bun.sleep(ms)
  const closed = s.closed()
  s.ws.close()
  return { got: s.got, closed }
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
// The server runs in this process, so moving the clock moves the server's too. Frozen, so exact times compare.
async function at<T>(ms: number, fn: () => Promise<T>) {
  setSystemTime(Date.now() + ms)
  try { return await fn() } finally { setSystemTime() }
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
  for (const path of ['/pause', '/resume', '/adjust', '/stop', '/unremove']) {
    expect((await post('/admin' + path, { id, delta: 30 }, { ...ip, 'x-admin-token': 'nope'.repeat(16) })).status).toBe(401)
  }
})

test('an admin socket needs the real token, and then sees stream ids', async () => {
  // Exactly this message: the admin page stops reconnecting and asks for the passcode again.
  expect((await socket([{ role: 'admin', adminToken: 'x'.repeat(64) }])).got).toEqual([{ error: 'Not authorized' }])
  const { got } = await socket([{ role: 'admin', adminToken: admin['x-admin-token'] }])
  expect(got.at(-1).current).toMatchObject({ name: 'Ann', streamId: expect.any(String) })
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

test('quiz over HTTP: join with a fingerprint, pass once, and the same device is known under a new token', async () => {
  await as('/session/end'); await as('/session/start')
  const fp = 'a1b2c3d4e5f60718'
  expect((await hacker('/join', 'quiz-http-0001', { name: 'Qu', project: 'P', fp })).me.quizPassed).toBe(false)
  expect((await hacker('/quiz', 'quiz-http-0001')).me.quizPassed).toBe(true)
  expect((await hacker('/join', 'quiz-http-0002', { name: 'Qv', project: 'P', fp })).me.quizPassed).toBe(true)
  expect((await hacker('/join', 'quiz-http-0003', { name: 'Qw', project: 'P' })).me.quizPassed).toBe(false)
  for (const bad of ['xyz', 'ABCDEF0123456789', 'abc', 'a'.repeat(65), 12345, '']) {
    expect((await post('/join', { token: 'quiz-http-0004', name: 'Qx', project: 'P', fp: bad }, ip)).status, String(bad)).toBe(400)
  }
  expect((await post('/quiz', { token: 1 }, ip)).status).toBe(400)
})

// Last: it uses up this IP's request budget.
test('one IP is rate limited across all routes', async () => {
  const codes = await Promise.all(Array.from({ length: 700 }, () => fetch(base + '/health').then((r) => r.status)))
  expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  expect(codes.filter((c) => c === 200).length).toBeGreaterThan(100) // a busy NAT still gets through
})

// Reaction sockets use their own IPs: earlier tests used up the shared request window.
// Hosts get reactions through the DB (polled every 150ms), so the host's socket can be on any instance.
const batches = (s: { got: any[] }) => s.got.filter((m) => m.reactions)
const settle = () => Bun.sleep(1100) // one tick: snapshot pushes (canReact, the toggle) reach sockets
const delivered = () => Bun.sleep(400) // the 100ms batch, then the next 150ms poll: a tap is on screen this fast

test('reactions: waiting hackers only, cooldown, allowlist, one batch to hosts, admin toggle', async () => {
  await as('/session/end'); await as('/session/start')
  await hacker('/join', 'react-stage-0', { name: 'Sam', project: 'P' }) // first in: called to the stage
  await hacker('/join', 'react-queued-1', { name: 'Ann', project: 'P' })
  await hacker('/join', 'react-queued-2', { name: 'Ben', project: 'P' })
  const host = await connect([{ role: 'host' }], '10.9.9.9')
  const sam = await connect([{ role: 'hacker', token: 'react-stage-0' }], '10.9.9.9')
  const ann = await connect([{ role: 'hacker', token: 'react-queued-1' }], '10.9.9.9')
  const ben = await connect([{ role: 'hacker', token: 'react-queued-2' }], '10.9.9.9')
  const outsider = await connect([{ role: 'hacker', token: 'react-outsider' }], '10.9.9.9')
  await settle()
  for (const e of ['❤️', '❤️', 'nope']) ann.react(e) // 2nd is inside the cooldown, 3rd isn't an emoji we know
  ben.react('🐴')
  outsider.react('👍') // not in the line
  sam.react('👍') // on stage: presenting, not reacting
  await delivered()
  expect(batches(host)).toEqual([{ reactions: { '❤️': 1, '🐴': 1 } }]) // everyone's taps in one message
  expect(batches(ann).length + batches(ben).length + batches(sam).length).toBe(0) // only the projector gets them
  ann.react('😭'); await delivered() // tapping at a normal pace always lands
  expect(batches(host).at(-1)).toEqual({ reactions: { '😭': 1 } })
  await as('/reactions', { on: false }); await settle() // the next snapshot push carries the toggle to the sockets
  ann.react('🐴'); await delivered()
  expect(batches(host)).toHaveLength(2)
  await as('/reactions', { on: true })
  ;[host, sam, ann, ben, outsider].forEach((s) => s.ws.close())
}, 20000)

test('reactions: spamming gets a warning, then slow mode that really slows', async () => {
  await hacker('/join', 'react-spammer-1', { name: 'Bo', project: 'P' }) // Sam still holds the stage
  const host = await connect([{ role: 'host' }], '10.9.9.8')
  const bo = await connect([{ role: 'hacker', token: 'react-spammer-1' }], '10.9.9.8')
  await settle()
  for (let i = 0; i < 20; i++) bo.react('❤️') // 1 lands, 19 are inside the cooldown
  await Bun.sleep(300)
  const notices = bo.got.filter((m) => m.notice)
  expect(notices.length).toBe(2)
  expect(notices[0].slowMs).toBeUndefined() // first offense: warning only
  expect(notices[1].slowMs).toBe(30_000) // second: slow mode
  bo.react('❤️'); await delivered() // past the normal cooldown, but slow mode allows one per 2s
  expect(batches(host)).toEqual([{ reactions: { '❤️': 1 } }])
  ;[host, bo].forEach((s) => s.ws.close())
}, 15000)

// The bug this relay fixes: on Vercel the tapper and the projector are often on different instances.
test('reactions written by another instance reach a host here, without replaying older ones', async () => {
  const { db } = await import('./db')
  const add = (counts: object) => db.execute({ sql: 'INSERT INTO reactions (at, counts) VALUES (?, ?)', args: [Date.now(), JSON.stringify(counts)] })
  await Bun.sleep(200) // earlier hosts' sockets finish closing, so this one is a fresh reader
  await add({ '👍': 9 }) // tapped while no projector was up: stale by the time one is
  const host = await connect([{ role: 'host' }], '10.9.9.7')
  await settle()
  await add({ '🔥': 3 })
  await delivered()
  expect(batches(host)).toEqual([{ reactions: { '🔥': 3 } }]) // earlier tests' rows are still in the table
  host.ws.close()
}, 10000)
