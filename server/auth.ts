import * as oidc from 'openid-client'
import { timingSafeEqual } from 'node:crypto'

// Sign-in with Purdue Hackers ID (OIDC code flow + PKCE). After the callback we keep only a signed,
// stateless cookie, so any Vercel instance can read it and nothing about users is stored in Turso.
const ISSUER = process.env.ID_ISSUER ?? 'https://id.purduehackers.com/api/auth'
const SCOPE = 'openid profile roles'
const SESSION = 'cp_session', FLOW = 'cp_oauth'
const SESSION_MS = 12 * 3600_000 // one hack night; role changes in ID apply at the next sign-in
const FLOW_MS = 10 * 60_000

export type User = { sub: string; name: string; organizer: boolean }

const env = (name: string) => {
  if (!process.env[name]) throw new Error(`${name} is not set on the server`)
  return process.env[name]!
}

// Discovery runs once per instance; a failed fetch is retried on the next sign-in.
let config: Promise<oidc.Configuration> | undefined
const client = () => (config ??= oidc.discovery(
  new URL(ISSUER),
  env('ID_CLIENT_ID'),
  undefined,
  process.env.ID_CLIENT_SECRET ? oidc.ClientSecretBasic(process.env.ID_CLIENT_SECRET) : oidc.None(),
  ISSUER.startsWith('http:') ? { execute: [oidc.allowInsecureRequests] } : undefined, // a local ID in dev
).catch((e) => { config = undefined; throw e }))

// ---- signed cookies: base64url(json).hmac. The cookie name is part of the MAC, so a flow cookie can't pass as a session.
const mac = (name: string, data: string) => new Bun.CryptoHasher('sha256', env('SESSION_SECRET')).update(`${name}.${data}`).digest('base64url')
const seal = (name: string, value: object, ms: number) => {
  const data = Buffer.from(JSON.stringify({ ...value, exp: Date.now() + ms })).toString('base64url')
  return `${data}.${mac(name, data)}`
}
function unseal<T>(name: string, raw: string | undefined): T | null {
  const [data, sig] = raw?.split('.') ?? []
  if (!data || !sig) return null
  const a = Buffer.from(sig), b = Buffer.from(mac(name, data))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const value = JSON.parse(Buffer.from(data, 'base64url').toString())
    return value.exp > Date.now() ? value : null
  } catch { return null }
}

const cookieOf = (header: string | null | undefined, name: string) =>
  header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='))?.slice(name.length + 1)

const setCookie = (name: string, value: string, ms: number, secure: boolean) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ms / 1000)}${secure ? '; Secure' : ''}`

/** The signed-in user from a Cookie header, or null. */
export function userOf(cookie: string | null | undefined): User | null {
  const s = unseal<User>(SESSION, cookieOf(cookie, SESSION))
  return s && { sub: s.sub, name: s.name, organizer: s.organizer }
}

// Public origin of this site: the redirect URI registered in ID must be `${origin}/api/auth/callback`.
const hostOf = (headers: Headers) => headers.get('x-forwarded-host') ?? headers.get('host') ?? ''
function originOf(request: Request) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN
  const proto = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')
  return `${proto}://${hostOf(request.headers)}`
}

/** Cookies ride along on cross-site-but-same-site requests (other *.purduehackers.com apps), so state changes check Origin. */
export function sameOrigin(headers: Headers) {
  const origin = headers.get('origin')
  if (!origin) return true // non-browser clients, and browsers on same-origin GETs
  try { return new URL(origin).host === hostOf(headers) } catch { return false }
}

// Only local paths, so ?next= can't send someone off-site.
const local = (next: string | null) => (next && /^\/(?![/\\])/.test(next) ? next : '/')

const redirect = (location: string, ...cookies: string[]) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(null, { status: 302, headers })
}

export async function login(request: Request) {
  const origin = originOf(request), secure = origin.startsWith('https:')
  const verifier = oidc.randomPKCECodeVerifier(), state = oidc.randomState(), nonce = oidc.randomNonce()
  const next = local(new URL(request.url).searchParams.get('next'))
  const url = oidc.buildAuthorizationUrl(await client(), {
    redirect_uri: `${origin}/api/auth/callback`,
    scope: SCOPE,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  })
  return redirect(url.href, setCookie(FLOW, seal(FLOW, { verifier, state, nonce, next }, FLOW_MS), FLOW_MS, secure))
}

export async function callback(request: Request) {
  const origin = originOf(request), secure = origin.startsWith('https:')
  const clear = setCookie(FLOW, '', 0, secure)
  const flow = unseal<{ verifier: string; state: string; nonce: string; next: string }>(FLOW, cookieOf(request.headers.get('cookie'), FLOW))
  try {
    if (!flow) throw new Error('No sign-in in progress (it expires after 10 minutes)')
    const config = await client()
    // Rebuild the URL as ID saw it: behind Vercel's rewrite request.url isn't the public address.
    const current = new URL(`${origin}/api/auth/callback${new URL(request.url).search}`)
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true,
    })
    const { sub } = tokens.claims()!
    const info = await oidc.fetchUserInfo(config, tokens.access_token, sub)
    const name = String(info.name || info.preferred_username || 'Hacker')
    const organizer = Array.isArray(info.roles) && info.roles.includes('organizer') // ID's admin role grants organizer too
    return redirect(flow.next, clear, setCookie(SESSION, seal(SESSION, { sub, name, organizer }, SESSION_MS), SESSION_MS, secure))
  } catch (e) {
    console.error('[auth] sign-in failed:', e)
    const retry = `/api/auth/login?next=${encodeURIComponent(flow?.next ?? '/')}`
    return new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><p>Sign-in failed. <a href="${retry}">Try again</a></p>`,
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clear } })
  }
}

// Ends the session here only; the person stays signed in to ID itself.
export const logout = (request: Request) =>
  redirect(local(new URL(request.url).searchParams.get('next')), setCookie(SESSION, '', 0, originOf(request).startsWith('https:')))
