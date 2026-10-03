// All SQL and every state transition lives here.
import { db, ready } from './db'
import type { Current, Me, QueueItem, Role, ShareState, State } from '../shared/types'

const DISCONNECTED_MS = 3 * 60_000 // US-2.4 grace period
// Join order is a counter, not a timestamp: two joins in the same millisecond still get distinct keys.
const NEXT_KEY = `(SELECT COALESCE(MAX(sort_key), 0) + 1 FROM queue_entries WHERE session_id = ?)`
type Row = Record<string, any>

const all = async (sql: string, args: any[] = []) => {
  await ready
  return (await db.execute({ sql, args })).rows as Row[]
}
const one = async (sql: string, args: any[] = []) => (await all(sql, args))[0] as Row | undefined
const run = async (sql: string, args: any[] = []) => (await all(sql, args), undefined)

const latestSession = () => one(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1`)
const openSession = () => one(`SELECT * FROM sessions WHERE status = 'open'`)

export async function startSession(limitSec = 120) {
  if (await openSession()) return
  await run(`INSERT INTO sessions (id, status, limit_sec, created_at) VALUES (?, 'open', ?, ?)`, [crypto.randomUUID(), limitSec, Date.now()])
}

export async function endSession() {
  const s = await openSession()
  if (!s) return
  await run(`UPDATE queue_entries SET status = 'done' WHERE session_id = ? AND status IN ('called','live')`, [s.id])
  await run(`UPDATE sessions SET status = 'closed' WHERE id = ?`, [s.id])
}

export async function setLimit(sec: number) {
  if (!(sec >= 10 && sec <= 3600)) throw new Error('limit must be 10–3600 seconds')
  await run(`UPDATE sessions SET limit_sec = ? WHERE status = 'open'`, [Math.round(sec)])
}

export async function join(token: string, name: string, project: string) {
  name = name.trim().slice(0, 60)
  project = project.trim().slice(0, 80)
  if (!name || !project) throw new Error('name and project are required')
  const s = await openSession()
  if (!s) throw new Error('No checkpoint is running')
  const now = Date.now()
  const mine = await one(`SELECT * FROM queue_entries WHERE session_id = ? AND client_token = ?`, [s.id, token])
  if (!mine) {
    await run(
      `INSERT INTO queue_entries (id, session_id, client_token, name, project, stream_id, sort_key, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ${NEXT_KEY}, ?, ?)`,
      [crypto.randomUUID(), s.id, token, name, project, 'ck' + crypto.randomUUID().replaceAll('-', '').slice(0, 14), s.id, now, now],
    )
  } else if (mine.status === 'left') {
    await run(`UPDATE queue_entries SET status = 'waiting', name = ?, project = ?, share_state = 'not_shared', sort_key = ${NEXT_KEY}, joined_at = ?, last_seen_at = ? WHERE id = ?`, [name, project, s.id, now, now, mine.id])
  } // else: already has a spot (or finished / was removed): joining again returns it unchanged
}

const mineSql = `UPDATE queue_entries SET %SET% WHERE client_token = ? AND session_id IN (SELECT id FROM sessions WHERE status = 'open') AND status %WHERE%`
const mutateMine = (set: string, where: string, token: string, args: any[] = []) =>
  run(mineSql.replace('%SET%', set).replace('%WHERE%', where), [...args, token])

export const leave = (token: string) => mutateMine(`status = 'left'`, `IN ('waiting','called','live')`, token)
export const setShare = (token: string, state: ShareState) => mutateMine(`share_state = ?`, `IN ('waiting','called','live')`, token, [state])
export const end = (token: string) => mutateMine(`status = 'done'`, `= 'live'`, token)
export const touch = (token: string) => mutateMine(`last_seen_at = ?`, `IN ('waiting','called','live')`, token, [Date.now()])

// Ready gate: called -> live, and the server fixes the deadline.
async function goLive(where: string, arg: string) {
  const s = await openSession()
  if (!s) return
  const now = Date.now()
  await run(
    `UPDATE queue_entries SET status = 'live', started_at = ?, deadline = ?
     WHERE session_id = ? AND status = 'called' AND ${where} = ?`,
    [now, now + s.limit_sec * 1000, s.id, arg],
  )
}
export const hackerReady = (token: string) => goLive('client_token', token)
export const adminReady = (entryId: string) => goLive('id', entryId)

export async function callNext() {
  const s = await openSession()
  if (!s) throw new Error('No checkpoint is running')
  await ready
  const tx = await db.transaction('write')
  try {
    await tx.execute({ sql: `UPDATE queue_entries SET status = 'done' WHERE session_id = ? AND status IN ('called','live')`, args: [s.id] })
    await tx.execute({
      sql: `UPDATE queue_entries SET status = 'called', called_at = ? WHERE id = (
              SELECT id FROM queue_entries WHERE session_id = ? AND status = 'waiting' ORDER BY sort_key LIMIT 1)`,
      args: [Date.now(), s.id],
    })
    await tx.commit()
  } finally {
    tx.close()
  }
}

export const stop = async () => run(`UPDATE queue_entries SET status = 'done' WHERE status IN ('called','live') AND session_id IN (SELECT id FROM sessions WHERE status = 'open')`)
export const remove = (id: string) => run(`UPDATE queue_entries SET status = 'removed' WHERE id = ? AND status IN ('waiting','called','live')`, [id])

// Move behind the next waiting person.
export async function skip(id: string) {
  const s = await openSession()
  if (!s) return
  const w = await all(`SELECT id, sort_key FROM queue_entries WHERE session_id = ? AND status = 'waiting' ORDER BY sort_key`, [s.id])
  const i = w.findIndex((r) => r.id === id)
  if (i < 0 || i === w.length - 1) return
  const next = w[i + 1].sort_key as number
  const after = w[i + 2]?.sort_key as number | undefined
  await run(`UPDATE queue_entries SET sort_key = ? WHERE id = ?`, [after === undefined ? next + 1 : (next + after) / 2, id])
}

// The server-owned cutoff. Called every tick, so it also catches deadlines passed while the server was down.
export async function expire(now = Date.now()) {
  await run(`UPDATE queue_entries SET status = 'done' WHERE status = 'live' AND deadline <= ?`, [now])
}

export async function loadState(role: Role, token?: string): Promise<State> {
  const serverNow = Date.now()
  const s = await latestSession()
  if (!s) return { serverNow, session: null, current: null, queue: [] }
  const rows = await all(`SELECT * FROM queue_entries WHERE session_id = ? ORDER BY sort_key`, [s.id])
  const admin = role === 'admin'
  const cur = rows.find((r) => r.status === 'called' || r.status === 'live')
  const waiting = rows.filter((r) => r.status === 'waiting')
  const current: Current | null = !cur ? null : {
    entryId: cur.id, name: cur.name, project: cur.project, status: cur.status,
    startedAt: cur.started_at, deadline: cur.deadline, shareState: cur.share_state,
    ...((admin || (role === 'host' && cur.status === 'live')) && { streamId: cur.stream_id }),
  }
  const queue: QueueItem[] = waiting.map((r) => ({
    id: r.id, name: r.name, project: r.project, shareState: r.share_state, joinedAt: r.joined_at,
    connected: serverNow - r.last_seen_at < DISCONNECTED_MS,
    ...(admin && { streamId: r.stream_id }),
  }))
  const state: State = { serverNow, session: { status: s.status, limitSec: s.limit_sec }, current, queue }
  const mine = role === 'hacker' && token ? rows.find((r) => r.client_token === token) : undefined
  if (mine) {
    const me: Me = { entryId: mine.id, name: mine.name, project: mine.project, status: mine.status, position: waiting.indexOf(mine) + 1, streamId: mine.stream_id }
    state.me = me
  }
  return state
}
