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
  expect((await post('/admin/stop', {}, { 'x-admin-token': 'x'.repeat(64) })).status).toBe(401)
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

test('passcode guessing is locked out per IP, even for the right passcode', async () => {
  for (let i = 0; i < 10; i++) expect((await post('/admin/login', { passcode: 'guess-' + i })).status).toBe(401)
  expect((await post('/admin/login', { passcode: 'test-passcode-long-enough' })).status).toBe(429)
})

// Last: it uses up this IP's request budget.
test('one IP is rate limited across all routes', async () => {
  const codes = await Promise.all(Array.from({ length: 700 }, () => fetch(base + '/health').then((r) => r.status)))
  expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  expect(codes.filter((c) => c === 200).length).toBeGreaterThan(100) // a busy NAT still gets through
})
