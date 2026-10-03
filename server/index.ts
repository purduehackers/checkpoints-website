import { Elysia, t } from 'elysia'
import { timingSafeEqual } from 'node:crypto'
import * as q from './queue'
import type { Role, State } from '../shared/types'

// ?? Assumes Vercel Pro and ~1s latency. Each tick is a few Turso reads per open socket-holding instance;
// ?? if that gets costly or 1s feels slow, move cross-instance sync to Redis pub/sub and tick only for expire().
const TICK_MS = 1000
const TOUCH_EVERY = 20 // ticks between last_seen refreshes

const adminToken = () => {
  if (!process.env.ADMIN_PASSCODE) throw new Error('ADMIN_PASSCODE is not set on the server')
  return new Bun.CryptoHasher('sha256', process.env.ADMIN_PASSCODE).update('admin').digest('hex')
}
const isAdmin = (t?: string) => {
  const want = Buffer.from(adminToken()), got = Buffer.from(t ?? '')
  return want.length === got.length && timingSafeEqual(want, got)
}

// ---- live sockets held by THIS instance ----
type Sub = { send: (s: string) => void; role: Role; token?: string; last?: string }
const subs = new Map<string, Sub>()
let timer: ReturnType<typeof setInterval> | undefined
let ticks = 0

async function push(sub: Sub, force = false) {
  const state = await q.loadState(sub.role, sub.token)
  const { serverNow, ...rest } = state
  const key = JSON.stringify(rest) // only send when something changed
  if (force || key !== sub.last) { sub.last = key; sub.send(JSON.stringify(state)) }
}
const pushAll = () => Promise.all([...subs.values()].map((s) => push(s).catch(() => {})))

async function tick() {
  await q.expire()
  if (++ticks % TOUCH_EVERY === 0) await Promise.all([...subs.values()].filter((s) => s.token).map((s) => q.touch(s.token!)))
  await pushAll()
}

// Mutations answer with the caller's fresh state, then nudge sockets on this instance.
const reply = async (role: Role, token?: string): Promise<State> => {
  pushAll()
  return q.loadState(role, token)
}

const tok = t.String({ minLength: 8, maxLength: 64 })
const hackerBody = t.Object({ token: tok })

export const app = new Elysia({ prefix: '/api' })
  .onError(({ error, set }) => {
    set.status = 400
    return { error: error instanceof Error ? error.message : String(error) }
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
  .post('/admin/login', ({ body }) => {
    if (!process.env.ADMIN_PASSCODE || body.passcode !== process.env.ADMIN_PASSCODE) throw new Error('Wrong passcode')
    return { token: adminToken() }
  }, { body: t.Object({ passcode: t.String() }) })
  .group('/admin', (g) =>
    g
      .onBeforeHandle(({ headers, set, path }) => {
        if (path.endsWith('/login')) return
        if (!isAdmin(headers['x-admin-token'])) return (set.status = 401, { error: 'Not authorized' })
      })
      .post('/session/start', async () => (await q.startSession(), reply('admin')))
      .post('/session/end', async () => (await q.endSession(), reply('admin')))
      .post('/call-next', async () => (await q.callNext(), reply('admin')))
      .post('/stop', async () => (await q.stop(), reply('admin')))
      .post('/skip', async ({ body }) => (await q.skip(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/remove', async ({ body }) => (await q.remove(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/ready', async ({ body }) => (await q.adminReady(body.id), reply('admin')), { body: t.Object({ id: t.String() }) })
      .post('/limit', async ({ body }) => (await q.setLimit(body.seconds), reply('admin')), { body: t.Object({ seconds: t.Number() }) }),
  )

  .ws('/ws', {
    // First message from the client: { role, token?, adminToken? }
    async message(ws, msg: any) {
      if (!msg || !['hacker', 'admin', 'host'].includes(msg.role)) return
      if (msg.role === 'admin' && !isAdmin(msg.adminToken)) return ws.send(JSON.stringify({ error: 'Not authorized' }))
      const sub: Sub = { send: (s) => ws.send(s), role: msg.role, token: msg.role === 'hacker' ? String(msg.token ?? '') : undefined }
      subs.set(String(ws.id), sub)
      timer ??= setInterval(() => tick().catch(console.error), TICK_MS)
      await push(sub, true)
    },
    close(ws) {
      subs.delete(String(ws.id))
      if (!subs.size) { clearInterval(timer); timer = undefined }
    },
  })
