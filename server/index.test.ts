// HTTP and WebSocket abuse: the server must stay up and cheap under hostile clients.
import { afterAll, expect, setSystemTime, test } from 'bun:test'
import { RedisClient } from 'bun'

// A fake Purdue Hackers ID: discovery, authorize, token (checks PKCE), userinfo and JWKS, with EdDSA ID tokens like the real one.
const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', alg: 'EdDSA', use: 'sig' }
const b64 = (v: object | ArrayBuffer) => Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : JSON.stringify(v)).toString('base64url')
const codes = new Map<string, { challenge: string; nonce: string; user: typeof member }>()
const member = { sub: 'user-ada', name: 'Ada Lovelace', roles: [] as string[] }
const organizer = { sub: 'user-grace', name: 'Grace Hopper', roles: ['organizer'] }
let signingIn = member
const id: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url), iss = `http://localhost:${id.port}`
    if (url.pathname === '/.well-known/openid-configuration') return Response.json({
      issuer: iss, authorization_endpoint: iss + '/authorize', token_endpoint: iss + '/token', userinfo_endpoint: iss + '/userinfo',
      jwks_uri: iss + '/jwks', id_token_signing_alg_values_supported: ['EdDSA'],
    })
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] })
    if (url.pathname === '/authorize') {
      const code = crypto.randomUUID(), p = url.searchParams
      codes.set(code, { challenge: p.get('code_challenge')!, nonce: p.get('nonce')!, user: signingIn })
      return Response.redirect(`${p.get('redirect_uri')}?code=${code}&state=${p.get('state')}&iss=${encodeURIComponent(iss)}`, 302)
    }
    if (url.pathname === '/token') {
      const form = await req.formData(), c = codes.get(String(form.get('code')))
      const challenge = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(form.get('code_verifier')))))
      if (!c || c.challenge !== challenge) return Response.json({ error: 'invalid_grant' }, { status: 400 })
      codes.delete(String(form.get('code')))
      const now = Math.floor(Date.now() / 1000), head = b64({ alg: 'EdDSA', kid: 'k1' })
      const body = b64({ iss, aud: 'checkpoints-test', sub: c.user.sub, nonce: c.nonce, iat: now, exp: now + 600 })
      const sig = b64(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(`${head}.${body}`)))
      return Response.json({ access_token: 'at-' + c.user.sub, token_type: 'Bearer', expires_in: 600, id_token: `${head}.${body}.${sig}` })
    }
    if (url.pathname === '/userinfo') {
      const u = [member, organizer].find((u) => req.headers.get('authorization') === 'Bearer at-' + u.sub)
      return u ? Response.json(u) : new Response(null, { status: 401 })
    }
    return new Response(null, { status: 404 })
  },
})

process.env.TURSO_DATABASE_URL = ':memory:'
process.env.ID_ISSUER = `http://localhost:${id.port}`
process.env.ID_CLIENT_ID = 'checkpoints-test'
process.env.SESSION_SECRET = 'test-session-secret'
process.env.VERCEL_ENV = 'test' // reactions use their own Redis channel, never dev's or prod's
// Reactions get a throwaway local Redis, never the shared one in .env; their tests skip where redis-server isn't installed.
const REDIS_PORT = 20000 + Math.floor(Math.random() * 10000), REDIS_URL = `redis://localhost:${REDIS_PORT}`
const CH = 'checkpoints:reactions:test'
const startRedis = async () => {
  const p = Bun.spawn(['redis-server', '--port', String(REDIS_PORT), '--save', '', '--appendonly', 'no'], { stdout: 'ignore' })
  const c = new RedisClient(REDIS_URL)
  for (let i = 0; i < 50; i++) { if (await c.ping().then(() => true, () => false)) break; await Bun.sleep(50) }
  c.close()
  return p
}
let redisProc = Bun.which('redis-server') ? await startRedis() : undefined
process.env.REDIS_URL = redisProc ? REDIS_URL : ''
const { app } = await import('./index')
app.listen(0)
const base = `http://localhost:${app.server!.port}/api`
const wsUrl = base.replace('http', 'ws') + '/ws'
afterAll(() => { app.stop(); id.stop(); redisProc?.kill() })

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers, redirect: 'manual' })
const cookies = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

// The browser's side of signing in: our login -> ID authorize -> our callback. Returns the final response.
async function signIn(user: typeof member, next = '/') {
  signingIn = user
  const login = await get('/auth/login?next=' + encodeURIComponent(next))
  const approved = await fetch(login.headers.get('location')!, { redirect: 'manual' })
  return get(new URL(approved.headers.get('location')!).pathname.replace('/api', '') + new URL(approved.headers.get('location')!).search, { cookie: cookies(login) })
}
const session = async (user: typeof member) => ({ cookie: cookies(await signIn(user)) })

// Opens a socket (optionally from its own IP / with extra headers), sends `msgs`, and keeps every message it gets.
async function connect(msgs: unknown[], ip?: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(wsUrl, { headers: { ...(ip && { 'x-real-ip': ip }), ...headers } } as any), got: any[] = []
  let closed = false
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)))
  ws.onclose = () => (closed = true)
  await new Promise((r) => (ws.onopen = r))
  for (const m of msgs) ws.send(typeof m === 'string' ? m : JSON.stringify(m))
  return { ws, got, closed: () => closed, react: (emoji: string) => ws.send(JSON.stringify({ react: emoji })) }
}
// One-shot: what a socket gets for `ms` after sending `msgs`.
async function socket(msgs: unknown[], ms = 400, headers: Record<string, string> = {}) {
  const s = await connect(msgs, undefined, headers)
  await Bun.sleep(ms)
  const closed = s.closed()
  s.ws.close()
  return { got: s.got, closed }
}

test('signing in sets a session; /me reports the ID name and organizer role', async () => {
  const done = await signIn(member, '/admin')
  expect(done.status).toBe(302)
  expect(done.headers.get('location')).toBe('/admin')
  expect(await (await get('/me', { cookie: cookies(done) })).json()).toEqual({ user: { sub: 'user-ada', name: 'Ada Lovelace', organizer: false }, authMode: 'oidc' })
  expect((await (await get('/me', await session(organizer))).json()).user.organizer).toBe(true)
  expect(await (await get('/me')).json()).toEqual({ user: null, authMode: 'oidc' })
})

test('password sign-in is disabled when an OIDC issuer is configured', async () => {
  const r = await post('/auth/password', { password: '123' })
  expect(r.status).toBe(403)
  expect(r.headers.getSetCookie()).toEqual([])
})

test('without an issuer, password sign-in grants an organizer session and logout clears it', async () => {
  const issuer = process.env.ID_ISSUER, clientId = process.env.ID_CLIENT_ID
  const oidcCookie = cookies(await signIn(organizer))
  let passwordCookie = ''
  delete process.env.ID_ISSUER
  delete process.env.ID_CLIENT_ID
  try {
    expect(await (await get('/me')).json()).toEqual({ user: null, authMode: 'password' })
    expect((await get('/auth/login')).headers.get('location')).toBe('/admin')
    expect((await get('/auth/callback')).status).toBe(403)
    expect((await (await get('/me', { cookie: oidcCookie })).json()).user).toBeNull()
    const wrong = await post('/auth/password', { password: 'wrong' })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.getSetCookie()).toEqual([])
    expect((await post('/auth/password', { password: '123' }, { origin: 'https://evil.example' })).status).toBe(403)
    const login = await post('/auth/password', { password: '123' }, { 'x-forwarded-proto': 'https' })
    expect(login.status).toBe(200)
    const cookie = login.headers.getSetCookie()[0]!
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=43200']) expect(cookie).toContain(flag)
    passwordCookie = cookies(login)
    const headers = { cookie: passwordCookie }
    expect((await (await get('/me', headers)).json()).user).toMatchObject({ organizer: true, name: 'Preview organizer' })
    expect((await post('/admin/stop', { id: 'x' }, headers)).status).toBe(200)
    expect((await socket([{ role: 'admin' }], 100, headers)).got[0].serverNow).toBeNumber()
    const logout = await get('/auth/logout?next=/admin', headers)
    expect(logout.headers.get('location')).toBe('/admin')
    expect(logout.headers.getSetCookie()[0]).toContain('Max-Age=0')
    expect((await (await get('/me', { cookie: cookies(logout) })).json()).user).toBeNull()
    setSystemTime(Date.now() + 13 * 3600_000)
    expect((await (await get('/me', headers)).json()).user).toBeNull()
  } finally {
    setSystemTime()
    process.env.ID_ISSUER = issuer
    process.env.ID_CLIENT_ID = clientId
  }
  // Enabling OIDC invalidates preview password sessions, even with the same signing secret.
  expect((await (await get('/me', { cookie: passwordCookie })).json()).user).toBeNull()
  expect((await post('/admin/stop', { id: 'x' }, { cookie: passwordCookie })).status).toBe(401)
})

test('a callback without the matching sign-in cookie or state fails', async () => {
  signingIn = member
  const login = await get('/auth/login')
  const cb = new URL((await fetch(login.headers.get('location')!, { redirect: 'manual' })).headers.get('location')!)
  expect((await get('/auth/callback' + cb.search)).status).toBe(400) // no flow cookie
  cb.searchParams.set('state', 'forged')
  const r = await get('/auth/callback' + cb.search, { cookie: cookies(login) })
  expect(r.status).toBe(400)
  expect(r.headers.getSetCookie().some((c) => c.startsWith('cp_session='))).toBe(false)
})

test('?next= only redirects within the site', async () => {
  for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example']) expect((await signIn(member, next)).headers.get('location')).toBe('/')
})

test('admin actions need the organizer role', async () => {
  expect((await post('/admin/stop', { id: 'x' })).status).toBe(401)
  expect((await post('/admin/stop', { id: 'x' }, { cookie: 'cp_session=forged.sig' })).status).toBe(401)
  expect((await post('/admin/stop', { id: 'x' }, await session(member))).status).toBe(401)
  expect((await post('/admin/stop', { id: 'x' }, await session(organizer))).status).toBe(200)
})

test('timing metrics are organizer-only', async () => {
  expect((await get('/admin/metrics')).status).toBe(401)
  expect((await get('/admin/metrics', await session(member))).status).toBe(401)
  const ok = await get('/admin/metrics', await session(organizer))
  expect(ok.status).toBe(200)
  expect(Object.keys((await ok.json()).metrics ?? { totalMs: 0 })).toContain('totalMs')
})

test('cross-site requests are refused even with a session', async () => {
  const org = await session(organizer)
  expect((await post('/admin/stop', { id: 'x' }, { ...org, origin: 'https://other.purduehackers.com' })).status).toBe(403)
  expect((await post('/admin/stop', { id: 'x' }, { ...org, origin: base.replace('/api', '') })).status).toBe(200)
  const { got } = await socket([{ role: 'admin' }], 400, { ...org, origin: 'https://other.purduehackers.com' })
  expect(got).toEqual([{ error: 'Not authorized' }])
})

test('admin sockets need the organizer role', async () => {
  expect((await socket([{ role: 'admin' }])).got).toEqual([{ error: 'Not authorized' }])
  expect((await socket([{ role: 'admin' }], 400, await session(member))).got).toEqual([{ error: 'Not authorized' }])
  expect((await socket([{ role: 'admin' }], 400, await session(organizer))).got[0].serverNow).toBeNumber()
})

test('errors say nothing about internals', async () => {
  const bad = await post('/join', { token: 123, name: [], project: {} })
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'Invalid request' })
  expect((await post('/nope', {})).status).toBe(404)
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
// Joining needs a sign-in in OIDC mode, so /join goes out with a member's session.
let memberSession: { cookie: string } | undefined
const hacker = async (path: string, token: string, body: object = {}) =>
  (await post(path, { token, ...body }, path === '/join' ? { ...ip, ...(memberSession ??= await session(member)) } : ip)).json()
// The server runs in this process, so moving the clock moves the server's too. Frozen, so exact times compare.
async function at<T>(ms: number, fn: () => Promise<T>) {
  setSystemTime(Date.now() + ms)
  try { return await fn() } finally { setSystemTime() }
}
const MIN = 60_000

test('organizer routes: sign in, a fresh checkpoint, and bad input is refused', async () => {
  admin = { ...ip, ...(await session(organizer)) }
  await as('/session/end'); expect((await as('/session/start')).status).toBe(200)
  await hacker('/join', 'http-aaaaaaaa', { name: 'Ann', project: 'P' })
  const id = (await (await as('/limit', { seconds: 120 })).json()).current.entryId
  expect((await as('/stop', {})).status).toBe(400) // must say who to stop
  for (const delta of [45, 0, '30', -30, -3000]) expect((await as('/adjust', { id, delta })).status).toBe(400)
  for (const path of ['/pause', '/resume', '/adjust', '/stop', '/unremove']) {
    expect((await post('/admin' + path, { id, delta: 30 }, { ...ip, ...(await session(member)) })).status).toBe(401)
  }
})

test('an admin socket sees stream ids once signed in as an organizer', async () => {
  const { got } = await socket([{ role: 'admin' }], 400, admin)
  expect(got.at(-1).current).toMatchObject({ name: 'Ann', streamId: expect.any(String) })
})

test('joining stores the sub from the cookie; a body-supplied sub is ignored; only the participant sees signedIn', async () => {
  const { db } = await import('./db')
  const from = { 'x-real-ip': '10.9.9.8' }
  const orgCookie = await session(organizer)
  await post('/admin/session/end', {}, { ...from, ...orgCookie }); await post('/admin/session/start', {}, { ...from, ...orgCookie })
  const sub = async (token: string) => (await db.execute({ sql: 'SELECT user_sub FROM queue_entries WHERE client_token = ?', args: [token] })).rows[0].user_sub
  const join = (token: string, headers: Record<string, string> = {}, extra: object = {}) =>
    post('/join', { token, name: 'Ann', project: 'P', ...extra }, { ...from, ...headers }).then((r) => r.json())

  const signed = await join('sub-signed-in', await session(member))
  expect(await sub('sub-signed-in')).toBe('user-ada')
  expect(signed.me.signedIn).toBe(true)

  // The identity comes from the cookie only: a sub in the body is ignored.
  await join('sub-forged-signed', await session(member), { sub: 'user-grace', userSub: 'user-grace' })
  expect(await sub('sub-forged-signed')).toBe('user-ada')

  // Other roles (host, and the admin screen) never get `me`, so nothing about sign-in leaks to them.
  const host = (await socket([{ role: 'host' }])).got
  expect(host.length).toBeGreaterThan(0)
  expect(JSON.stringify(host)).not.toContain('signedIn')
  expect(JSON.stringify(host)).not.toContain('user-ada')
  const admin = (await socket([{ role: 'admin' }], 400, { ...orgCookie })).got
  expect(admin[0].serverNow).toBeNumber()
  expect(JSON.stringify(admin)).not.toContain('signedIn')
  expect(JSON.stringify(admin)).not.toContain('user-ada')
  // A participant's own socket does carry it.
  const mine = (await socket([{ role: 'hacker', token: 'sub-signed-in' }])).got
  expect(mine.at(-1).me.signedIn).toBe(true)
})

test('OIDC: joining needs a sign-in (also when rejoining); password mode still lets anonymous people join', async () => {
  const { db } = await import('./db')
  const from = { 'x-real-ip': '10.9.9.7' }
  const orgCookie = await session(organizer)
  await post('/admin/session/end', {}, { ...from, ...orgCookie }); await post('/admin/session/start', {}, { ...from, ...orgCookie })
  const entries = async (token: string) => (await db.execute({ sql: 'SELECT status, user_sub FROM queue_entries WHERE client_token = ?', args: [token] })).rows
  const body = (token: string) => ({ token, name: 'Ann', project: 'P' })

  const anon = await post('/join', body('req-anon'), from)
  expect(anon.status).toBe(401)
  expect(await anon.json()).toEqual({ error: 'Sign in with Purdue Hackers to join the queue.' })
  expect(await entries('req-anon')).toEqual([])

  const member1 = { ...from, ...(await session(member)) }
  expect((await post('/join', body('req-member'), member1)).status).toBe(200)
  expect(await entries('req-member')).toMatchObject([{ user_sub: 'user-ada' }])

  // Leaving and coming back is the same route, so it is gated the same way.
  await post('/leave', { token: 'req-member' }, from)
  expect((await post('/join', body('req-member'), from)).status).toBe(401)
  expect(await entries('req-member')).toMatchObject([{ status: 'left' }])
  expect((await post('/join', body('req-member'), member1)).status).toBe(200)

  const issuer = process.env.ID_ISSUER, clientId = process.env.ID_CLIENT_ID
  delete process.env.ID_ISSUER
  delete process.env.ID_CLIENT_ID
  try {
    expect((await post('/join', body('req-password-anon'), from)).status).toBe(200)
    expect(await entries('req-password-anon')).toMatchObject([{ user_sub: null }])
  } finally {
    process.env.ID_ISSUER = issuer
    process.env.ID_CLIENT_ID = clientId
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

test('/info says whether a checkpoint is active, and nothing else', async () => {
  await as('/session/end')
  const off = await get('/info', { ...ip, origin: 'https://other.example' })
  expect(await off.json()).toEqual({ active: false })
  expect(off.headers.get('cache-control')).toBe('no-store')
  expect(off.headers.get('access-control-allow-origin')).toBe('*')
  await as('/session/start')
  expect(await (await get('/info', ip)).json()).toEqual({ active: true })
  await as('/session/end')
  expect(await (await get('/info', ip)).json()).toEqual({ active: false })
  // A dormant night (no organizer for 5 minutes) reads as ended even though nothing ticked.
  await as('/session/start')
  expect(await at(6 * MIN, async () => (await get('/info', ip)).json())).toEqual({ active: false })
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

// Reaction sockets use their own IPs: earlier tests used up the shared request window.
// Hosts get reactions over Redis pub/sub, so the host's socket can be on any instance.
const reacts = test.skipIf(!redisProc)
const batches = (s: { got: any[] }) => s.got.filter((m) => m.reactions)
const settle = () => Bun.sleep(1100) // one tick: snapshot pushes (canReact, the toggle) reach sockets
const delivered = () => Bun.sleep(400) // the 100ms batch plus a Redis round-trip

reacts('reactions: waiting hackers only, cooldown, allowlist, one batch to hosts, admin toggle', async () => {
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

reacts('reactions: spamming gets a warning, then slow mode that really slows', async () => {
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
reacts('a batch published by another instance reaches every host here; other envs never do', async () => {
  const other = new RedisClient(REDIS_URL)
  const a = await connect([{ role: 'host' }], '10.9.9.7'), b = await connect([{ role: 'host' }], '10.9.9.7')
  await settle()
  await other.publish('checkpoints:reactions:production', JSON.stringify({ '👍': 1 })) // a prod tap never reaches a test/preview projector
  await other.publish(CH, JSON.stringify({ '🔥': 3 }))
  await delivered()
  for (const h of [a, b]) expect(batches(h)).toEqual([{ reactions: { '🔥': 3 } }])
  ;[a, b].forEach((s) => s.ws.close()); other.close()
}, 10000)

reacts('the last host leaving drops the subscription, even mid-subscribe; the next host gets only newer batches', async () => {
  const other = new RedisClient(REDIS_URL)
  const listeners = async () => Number((await other.send('PUBSUB', ['NUMSUB', CH]))[1])
  await Bun.sleep(200) // earlier hosts' sockets finish closing
  const a = await connect([{ role: 'host' }], '10.9.9.6')
  await settle()
  expect(await listeners()).toBe(1)
  a.ws.close(); await Bun.sleep(300)
  expect(await listeners()).toBe(0)
  const quick = await connect([{ role: 'host' }], '10.9.9.6'); quick.ws.close() // gone before its subscribe finishes
  await Bun.sleep(1500) // a tick included
  expect(await listeners()).toBe(0)
  await other.publish(CH, JSON.stringify({ '👍': 9 })) // nobody watching: gone, not replayed later
  const b = await connect([{ role: 'host' }], '10.9.9.6')
  await settle()
  await other.publish(CH, JSON.stringify({ '🔥': 1 }))
  await delivered()
  expect(batches(b)).toEqual([{ reactions: { '🔥': 1 } }])
  b.ws.close(); other.close()
}, 15000)

reacts('taps reach the projector again after Redis restarts', async () => {
  await hacker('/join', 'react-restart-1', { name: 'Cy', project: 'P' }) // Sam still holds the stage
  const host = await connect([{ role: 'host' }], '10.9.9.5')
  const cy = await connect([{ role: 'hacker', token: 'react-restart-1' }], '10.9.9.5')
  await settle()
  redisProc!.kill(); await redisProc!.exited
  redisProc = await startRedis()
  // Tap every 300ms until one lands: the publisher and the host's subscription both have to come back.
  for (const end = Date.now() + 8000; !batches(host).length && Date.now() < end;) { cy.react('❤️'); await Bun.sleep(300) }
  expect(batches(host).length).toBeGreaterThan(0)
  ;[host, cy].forEach((s) => s.ws.close())
}, 15000)
