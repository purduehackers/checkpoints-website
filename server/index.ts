import { Elysia, t } from 'elysia'
import { timingSafeEqual } from 'node:crypto'
import * as q from './queue'
import { QUALITY, type Role, type State } from '../shared/types'

// ?? Assumes Vercel Pro and ~1s latency. Each tick is a few Turso reads per socket-holding instance, however
// ?? many sockets it holds; if 1s feels slow, move cross-instance sync to Redis pub/sub and tick only for expire().
const TICK_MS = 1000
const TOUCH_EVERY = 20 // ticks between last_seen refreshes
const MAX_SUBS = 500 // sockets per instance; a hack night needs ~1 per person
// Per IP. Campus Wi-Fi puts many people behind one address, so these are generous: they stop one
// machine from hogging the server, not a room. Bigger floods are for Vercel's firewall.
const IP_SOCKETS = 100
const IP_REQUESTS = 300, IP_WINDOW_MS = 10_000
const LOGIN_TRIES = 10, LOGIN_WINDOW_MS = 15 * 60_000

const passcode = () => {
  if (!process.env.ADMIN_PASSCODE) throw new Error('ADMIN_PASSCODE is not set on the server')
  return process.env.ADMIN_PASSCODE
}
const adminToken = () => new Bun.CryptoHasher('sha256', passcode()).update('admin').digest('hex')
// Constant-time; anything that isn't a string (from JSON over the socket) is simply wrong.
const same = (a: unknown, b: string) => {
  const x = Buffer.from(typeof a === 'string' ? a : ''), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
const isAdmin = (t: unknown) => same(t, adminToken())
const fail = (message: string, status: number) => Object.assign(new Error(message), { status })

// Fixed-window counters, in memory per instance (Vercel may run a few). x-real-ip is set by Vercel.
const windows = new Map<string, { n: number; reset: number }>()
const allow = (key: string, max: number, ms: number) => {
  const now = Date.now()
  let w = windows.get(key)
  if (!w || w.reset <= now) {
    if (windows.size > 50_000) windows.clear() // bound memory under a many-IP flood
    windows.set(key, (w = { n: 0, reset: now + ms }))
  }
  return ++w.n <= max
}
const ipOf = (request: Request, server: { requestIP(r: Request): { address: string } | null } | null) =>
  request.headers.get('x-real-ip') ?? server?.requestIP(request)?.address ?? '?'
const ipSockets = new Map<string, number>()

// ---- live sockets held by THIS instance ----
type Sub = { send: (s: string) => void; role: Role; token?: string; projector?: boolean; ip: string; last?: string }
const subs = new Map<string, Sub>()
let timer: ReturnType<typeof setInterval> | undefined
let ticks = 0

function push(sub: Sub, snap: q.Snapshot, force = false) {
  const state = q.view(snap, sub.role, sub.token, sub.projector)
  const { serverNow, ...rest } = state
  const key = JSON.stringify(rest) // only send when something changed
  if (force || key !== sub.last) { sub.last = key; sub.send(JSON.stringify(state)) }
}
// At most one broadcast in flight plus one queued, so a burst of requests can't multiply DB reads.
let pushing = false, again = false
async function pushAll() {
  if (pushing) { again = true; return }
  pushing = true
  try {
    do { again = false; const snap = await q.snapshot(); for (const s of subs.values()) push(s, snap) } while (again)
  } finally { pushing = false }
}

async function tick() {
  await q.expire()
  if (++ticks % TOUCH_EVERY === 0) await q.touch([...subs.values()].flatMap((s) => (s.token ? [s.token] : [])))
  await pushAll()
}

// Mutations answer with the caller's fresh state, then nudge sockets on this instance.
const reply = async (role: Role, token?: string): Promise<State> => {
  await q.expire()
  pushAll().catch(console.error)
  return q.loadState(role, token)
}

const tok = t.String({ minLength: 8, maxLength: 64 })
const hackerBody = t.Object({ token: tok })

export const app = new Elysia({
  prefix: '/api',
  serve: { maxRequestBodySize: 64 * 1024 },
  websocket: { maxPayloadLength: 4096 }, // the only client message is a small JSON hello; bigger closes the socket
})
  .onRequest(({ request, server, set }) => {
    if (!allow('ip:' + ipOf(request, server), IP_REQUESTS, IP_WINDOW_MS)) {
      set.status = 429
      return { error: 'Too many requests. Slow down.' }
    }
  })
  .onError(({ code, error, set }) => {
    if (code === 'NOT_FOUND') { set.status = 404; return { error: 'Not found' } }
    if (code === 'VALIDATION' || code === 'PARSE') { set.status = 400; return { error: 'Invalid request' } }
    // Our own errors are plain Errors with a user-facing message; anything else (DB, bugs) stays in the logs.
    if (error instanceof Error && error.constructor === Error) { set.status = (error as any).status ?? 400; return { error: error.message } }
    console.error(error)
    set.status = 500
    return { error: 'Server error' }
  })
  .get('/health', () => ({ ok: true }))

  // hacker
  .post('/join', async ({ body }) => (await q.join(body.token, body.name, body.project), reply('hacker', body.token)),
    { body: t.Object({ token: tok, name: t.String({ maxLength: 200 }), project: t.String({ maxLength: 200 }) }) })
  .post('/leave', async ({ body }) => (await q.leave(body.token), reply('hacker', body.token)), { body: hackerBody })
  .post('/ready', async ({ body }) => (await q.hackerReady(body.token), reply('hacker', body.token)), { body: hackerBody })
  .post('/end', async ({ body }) => (await q.end(body.token), reply('hacker', body.token)), { body: hackerBody })
  .post('/share-state', async ({ body }) => (await q.setShare(body.token, body.state), reply('hacker', body.token)),
    { body: t.Object({ token: tok, state: t.Union([t.Literal('not_shared'), t.Literal('sharing'), t.Literal('stopped')]) }) })

  // admin
  .post('/admin/login', ({ body, request, server }) => {
    // Every attempt counts, so guessing is slow; a long random passcode is still the real defence.
    if (!allow('login:' + ipOf(request, server), LOGIN_TRIES, LOGIN_WINDOW_MS)) {
      throw fail('Too many attempts. Try again in 15 minutes.', 429)
    }
    if (!same(body.passcode, passcode())) throw fail('Wrong passcode', 401)
    return { token: adminToken() }
  }, { body: t.Object({ passcode: t.String({ maxLength: 200 }) }) })
  .group('/admin', (g) =>
    g
      // transform runs before body validation, so unauthenticated callers learn nothing about the schema
      .onTransform(({ headers }) => {
        if (!isAdmin(headers['x-admin-token'])) throw Object.assign(new Error('Not authorized'), { status: 401 })
      })
      .post('/session/start', async () => (await q.startSession(), reply('admin')))
      .post('/session/end', async () => (await q.endSession(), reply('admin')))
      .post('/call-next', async ({ body }) => (await q.callNext(body.expect), reply('admin')), { body: t.Object({ expect: t.Nullable(t.String()) }) })
      .post('/stop', async () => (await q.stop(), reply('admin')))
      .post('/skip', async ({ body }) => (await q.skip(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/move', async ({ body }) => (await q.move(body.id, body.dir), reply('admin')), { body: t.Object({ id: t.String(), dir: t.Union([t.Literal(-1), t.Literal(1)]) }) })
      .post('/remove', async ({ body }) => (await q.remove(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/ready', async ({ body }) => (await q.adminReady(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/limit', async ({ body }) => (await q.setLimit(body.seconds), reply('admin')), { body: t.Object({ seconds: t.Number() }) })
      .post('/quality', async ({ body }) => (await q.setQuality(body.quality), reply('admin')),
        { body: t.Object({ quality: t.Union(Object.keys(QUALITY).map((k) => t.Literal(k))) }) })
      .post('/audio', async ({ body }) => (await q.setAudio(body.on), reply('admin')), { body: t.Object({ on: t.Boolean() }) }),
  )

  .ws('/ws', {
    // First message from the client: { role, token?, adminToken? }. A host with the admin token is the projector.
    async message(ws, msg: any) {
      const id = String(ws.id)
      if (subs.has(id)) return // one subscription per socket; repeats would only make the server re-query
      const role = msg?.role, token = msg?.token
      if (!['hacker', 'admin', 'host'].includes(role)) return
      if (role === 'hacker' && !(typeof token === 'string' && token.length >= 8 && token.length <= 64)) return
      if (role === 'admin' && !isAdmin(msg.adminToken)) { ws.send(JSON.stringify({ error: 'Not authorized' })); return } // returning send()'s byte count would echo it
      const ip = ws.data.headers['x-real-ip'] ?? ws.remoteAddress
      if (subs.size >= MAX_SUBS || (ipSockets.get(ip) ?? 0) >= IP_SOCKETS) { ws.close(1013, 'Server busy'); return } // the client retries with backoff
      const sub: Sub = { send: (s) => ws.send(s), role, token: role === 'hacker' ? token : undefined, projector: role === 'host' && isAdmin(msg.adminToken), ip }
      subs.set(id, sub)
      ipSockets.set(ip, (ipSockets.get(ip) ?? 0) + 1)
      timer ??= setInterval(() => tick().catch(console.error), TICK_MS)
      await q.expire() // first message must not show a slot whose deadline passed while nobody was connected
      push(sub, await q.snapshot(), true)
    },
    close(ws) {
      const sub = subs.get(String(ws.id))
      if (sub) { const n = (ipSockets.get(sub.ip) ?? 1) - 1; n > 0 ? ipSockets.set(sub.ip, n) : ipSockets.delete(sub.ip) }
      subs.delete(String(ws.id))
      if (!subs.size) { clearInterval(timer); timer = undefined }
    },
  })
