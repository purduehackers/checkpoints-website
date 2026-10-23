// HTTP and WebSocket abuse: the server must stay up and cheap under hostile clients.
import { afterAll, expect, test } from 'bun:test'

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
const { app } = await import('./index')
app.listen(0)
const base = `http://localhost:${app.server!.port}/api`
afterAll(() => { app.stop(); id.stop() })

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

// Collects every message a socket gets after sending `msgs`, for `ms` milliseconds.
async function socket(msgs: unknown[], ms = 400, headers: Record<string, string> = {}) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers } as any)
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

test('signing in sets a session; /me reports the ID name and organizer role', async () => {
  const done = await signIn(member, '/admin')
  expect(done.status).toBe(302)
  expect(done.headers.get('location')).toBe('/admin')
  expect(await (await get('/me', { cookie: cookies(done) })).json()).toEqual({ user: { sub: 'user-ada', name: 'Ada Lovelace', organizer: false } })
  expect((await (await get('/me', await session(organizer))).json()).user.organizer).toBe(true)
  expect(await (await get('/me')).json()).toEqual({ user: null })
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
  expect((await post('/admin/stop', {})).status).toBe(401)
  expect((await post('/admin/stop', {}, { cookie: 'cp_session=forged.sig' })).status).toBe(401)
  expect((await post('/admin/stop', {}, await session(member))).status).toBe(401)
  expect((await post('/admin/stop', {}, await session(organizer))).status).toBe(200)
})

test('cross-site requests are refused even with a session', async () => {
  const org = await session(organizer)
  expect((await post('/admin/stop', {}, { ...org, origin: 'https://other.purduehackers.com' })).status).toBe(403)
  expect((await post('/admin/stop', {}, { ...org, origin: base.replace('/api', '') })).status).toBe(200)
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
