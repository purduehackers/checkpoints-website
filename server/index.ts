import { Elysia, t } from 'elysia'
import { timingSafeEqual } from 'node:crypto'
import * as q from './queue'
import { QUALITY, REACTIONS, type Role, type State } from '../shared/types'

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
type Sub = { send: (s: string) => void; role: Role; token?: string; ip: string; last?: string; canReact?: boolean; lastReact?: number; strikes?: number; strikeAt?: number; offenses?: number; lastOffense?: number; slowUntil?: number }
const subs = new Map<string, Sub>()
let timer: ReturnType<typeof setInterval> | undefined
let ticks = 0

function push(sub: Sub, snap: q.Snapshot, force = false) {
  const state = q.view(snap, sub.role, sub.token)
  const { serverNow, ...rest } = state
  // Refreshed with every snapshot (about 1s), so the admin toggle and leaving the queue take effect quickly.
  // Waiting only: the person on stage is presenting, not reacting.
  sub.canReact = sub.role === 'hacker' && state.session?.status === 'open' && state.session.reactions && state.me?.status === 'waiting'
  const key = JSON.stringify(rest) // only send when something changed
  if (force || key !== sub.last) { sub.last = key; sub.send(JSON.stringify(state)) }
}
// Reactions are counted in memory and written as one {emoji: n} row per window. The host's socket can be on another
// Vercel instance, so delivery is through the DB: an instance holding hosts polls for new rows every REACT_POLL_MS
// (only while it has a host) and sends them as one message. Tap to screen is about 0.1–0.3s.
const REACT_BATCH_MS = 100, REACT_POLL_MS = 150, REACT_COOLDOWN_MS = 200 // cooldown is per socket
let tally: Record<string, number> = {}, flushing = false, reactAfter: number | null = null, relaying = false
let relayTimer: ReturnType<typeof setInterval> | undefined
// Spam, Discord-style: STRIKES taps inside the cooldown within STRIKE_MS is an offense. The first gets a warning;
// a repeat within OFFENSE_MS gets slow mode (one reaction per SLOW_MS for SLOW_FOR_MS). Taps are never queued.
const STRIKES = 8, STRIKE_MS = 3000, OFFENSE_MS = 120_000, SLOW_MS = 2000, SLOW_FOR_MS = 30_000
function spam(sub: Sub, now: number) {
  if (now - (sub.strikeAt ?? 0) > STRIKE_MS) { sub.strikeAt = now; sub.strikes = 0 }
  if (++sub.strikes! < STRIKES) return
  sub.strikes = 0; sub.strikeAt = now
  sub.offenses = now - (sub.lastOffense ?? 0) > OFFENSE_MS ? 1 : (sub.offenses ?? 0) + 1
  sub.lastOffense = now
  if (sub.offenses < 2) return sub.send(JSON.stringify({ notice: 'Easy on the reactions, please don’t spam.' }))
  sub.slowUntil = now + SLOW_FOR_MS
  sub.send(JSON.stringify({ notice: 'Slow mode: one reaction every 2 seconds for 30 seconds.', slowMs: SLOW_FOR_MS }))
}
function react(sub: Sub, emoji: unknown) {
  const now = Date.now()
  if (!sub.canReact || !(REACTIONS as readonly unknown[]).includes(emoji)) return
  if (now - (sub.lastReact ?? 0) < ((sub.slowUntil ?? 0) > now ? SLOW_MS : REACT_COOLDOWN_MS)) return spam(sub, now)
  sub.lastReact = now
  tally[emoji as string] = (tally[emoji as string] ?? 0) + 1
  if (flushing) return
  flushing = true
  setTimeout(() => {
    const counts = tally
    tally = {}; flushing = false
    q.addReactions(counts).catch(console.error)
  }, REACT_BATCH_MS)
}
async function relayReactions() {
  if (relaying) return // a slow read must not overlap the next one and send its rows twice
  relaying = true
  try {
    const { last, counts } = await q.newReactions(reactAfter)
    reactAfter = last
    if (Object.keys(counts).length) { const msg = JSON.stringify({ reactions: counts }); for (const s of subs.values()) if (s.role === 'host') s.send(msg) }
  } finally { relaying = false }
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
  const tokens = [...subs.values()].flatMap((s) => (s.token ? [s.token] : []))
  // Before the sweep: a hacker with another tab still open on any instance keeps their spot when one tab closes.
  await q.back(...tokens)
  await q.expire()
  if (++ticks % TOUCH_EVERY === 0) {
    await q.touch(tokens)
    if ([...subs.values()].some((s) => s.role === 'admin')) await q.adminSeen()
    await q.pruneReactions()
  }
  await pushAll()
}

// Mutations answer with the caller's fresh state, then nudge sockets on this instance.
const reply = async (role: Role, token?: string): Promise<State> => {
  await q.expire() // first: a timed-out checkpoint stays ended, even if nobody had a page open to tick it
  await q.activity()
  if (role === 'admin') await q.adminSeen()
  pushAll().catch(console.error)
  return q.loadState(role, token)
}

const tok = t.String({ minLength: 8, maxLength: 64 })
const hackerBody = t.Object({ token: tok })
const fp = t.String({ pattern: '^[0-9a-f]{8,64}$', maxLength: 64 }) // device fingerprint: short hex

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
  .post('/join', async ({ body }) => (await q.join(body.token, body.name, body.project, body.fp), reply('hacker', body.token)),
    { body: t.Object({ token: tok, name: t.String({ maxLength: 200 }), project: t.String({ maxLength: 200 }), fp: t.Optional(fp) }) })
  .post('/quiz', async ({ body }) => (await q.passQuiz(body.token, body.fp), reply('hacker', body.token)), { body: t.Object({ token: tok, fp: t.Optional(fp) }) })
  // sendBeacon from pagehide; the answer is never read. The 5s grace in expire() does the actual removal.
  .post('/bye', async ({ body }) => (await q.bye(body.token), { ok: true }), { body: hackerBody })
  .post('/leave', async ({ body }) => (await q.leave(body.token), reply('hacker', body.token)), { body: hackerBody })
  .post('/ready', async ({ body }) => (await q.hackerReady(body.token, body.noShare), reply('hacker', body.token)), { body: t.Object({ token: tok, noShare: t.Optional(t.Boolean()) }) })
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
        if (!isAdmin(headers['x-admin-token'])) throw fail('Not authorized', 401)
      })
      .post('/session/start', async () => (await q.startSession(), reply('admin')))
      .post('/session/end', async () => (await q.endSession(), reply('admin')))
      .post('/stop', async ({ body }) => (await q.stop(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/skip', async ({ body }) => (await q.skip(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/move', async ({ body }) => (await q.move(body.id, body.dir), reply('admin')), { body: t.Object({ id: t.String(), dir: t.Union([t.Literal(-1), t.Literal(1)]) }) })
      .post('/remove', async ({ body }) => (await q.remove(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/unremove', async ({ body }) => (await q.unremove(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/ready', async ({ body }) => (await q.adminReady(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/pause', async ({ body }) => (await q.pause(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/resume', async ({ body }) => (await q.resume(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/adjust', async ({ body }) => (await q.adjust(body.id, body.delta), reply('admin')), { body: t.Object({ id: t.String(), delta: t.Union([t.Literal(-30), t.Literal(30)]) }) })
      .post('/limit', async ({ body }) => (await q.setLimit(body.seconds), reply('admin')), { body: t.Object({ seconds: t.Number() }) })
      .post('/quality', async ({ body }) => (await q.setQuality(body.quality), reply('admin')),
        { body: t.Object({ quality: t.Union(Object.keys(QUALITY).map((k) => t.Literal(k))) }) })
      .post('/audio', async ({ body }) => (await q.setAudio(body.on), reply('admin')), { body: t.Object({ on: t.Boolean() }) })
      .post('/reactions', async ({ body }) => (await q.setReactions(body.on), reply('admin')), { body: t.Object({ on: t.Boolean() }) }),
  )

  .ws('/ws', {
    // First message from the client: { role, token?, adminToken? }
    async message(ws, msg: any) {
      const id = String(ws.id)
      const known = subs.get(id)
      if (known) { if (msg?.react) react(known, msg.react); return } // one subscription per socket; repeats would only make the server re-query
      const role = msg?.role, token = msg?.token
      if (!['hacker', 'admin', 'host'].includes(role)) return
      if (role === 'hacker' && !(typeof token === 'string' && token.length >= 8 && token.length <= 64)) return
      if (role === 'admin' && !isAdmin(msg.adminToken)) { ws.send(JSON.stringify({ error: 'Not authorized' })); return } // returning send()'s byte count would echo it
      const ip = ws.data.headers['x-real-ip'] ?? ws.remoteAddress
      if (subs.size >= MAX_SUBS || (ipSockets.get(ip) ?? 0) >= IP_SOCKETS) { ws.close(1013, 'Server busy'); return } // the client retries with backoff
      const sub: Sub = { send: (s) => ws.send(s), role, token: role === 'hacker' ? token : undefined, ip }
      subs.set(id, sub)
      ipSockets.set(ip, (ipSockets.get(ip) ?? 0) + 1)
      timer ??= setInterval(() => tick().catch(console.error), TICK_MS)
      if (role === 'host') relayTimer ??= setInterval(() => relayReactions().catch(console.error), REACT_POLL_MS)
      if (sub.token) await q.back(sub.token) // a refresh or reconnect cancels a pending bye
      await q.expire() // first message must not show a slot whose deadline passed while nobody was connected
      if (role === 'admin') await q.adminSeen() // after expire: an organizer arriving late doesn't revive a timed-out night
      push(sub, await q.snapshot(), true)
    },
    close(ws) {
      const sub = subs.get(String(ws.id))
      if (sub) { const n = (ipSockets.get(sub.ip) ?? 1) - 1; n > 0 ? ipSockets.set(sub.ip, n) : ipSockets.delete(sub.ip) }
      subs.delete(String(ws.id))
      if (!subs.size) { clearInterval(timer); timer = undefined }
      // Last host gone: stop polling. One arriving later starts from the newest row, not with a backlog.
      if (![...subs.values()].some((s) => s.role === 'host')) { clearInterval(relayTimer); relayTimer = undefined; reactAfter = null }
    },
  })
