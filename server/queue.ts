// All SQL and every state transition lives here.
import { db, ready } from './db'
import { QUALITY, type Current, type QueueItem, type Role, type ShareState, type State } from '../shared/types'

const DISCONNECTED_MS = 3 * 60_000 // US-2.4 grace period
const BYE_GRACE_MS = 15_000 // closed tab -> out of the line; long enough for a refresh to reconnect
// Join order is a counter, not a timestamp: two joins in the same millisecond still get distinct keys.
const NEXT_KEY = `(SELECT COALESCE(MAX(sort_key), 0) + 1 FROM queue_entries WHERE session_id = ?)`
type Row = Record<string, any>

const all = async (sql: string, args: any[] = []) => {
  await ready
  return (await db.execute({ sql, args })).rows as Row[]
}
const one = async (sql: string, args: any[] = []) => (await all(sql, args))[0] as Row | undefined
const run = async (sql: string, args: any[] = []) => (await all(sql, args), undefined)
const changes = async (sql: string, args: any[] = []) => {
  await ready
  return (await db.execute({ sql, args })).rowsAffected
}

// Invariant: stage empty + someone waiting => the first waiting entry is called. Enforced after join and at
// the end of every expire() (each tick and each reply), so it also heals slots finished by older code.
// One atomic statement, so two instances or a double-click can never leave two entries called/live.
const advance = async (sid: string) => {
  try {
    await run(
      `UPDATE queue_entries SET status = 'called', called_at = ? WHERE id = (
         SELECT id FROM queue_entries WHERE session_id = ? AND status = 'waiting' ORDER BY sort_key LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM queue_entries WHERE session_id = ? AND status IN ('called','live'))`,
      [Date.now(), sid, sid],
    )
  } catch (e: any) {
    if (!/UNIQUE|constraint/i.test(String(e?.message))) throw e // one_active_entry: another writer won the race
  }
}
const advanceOpen = async () => {
  const s = await openSession()
  if (s) await advance(s.id)
}

const latestSession = () => one(`SELECT * FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT 1`)
const openSession = () => one(`SELECT * FROM sessions WHERE status = 'open'`)

export async function startSession(limitSec = 120) {
  if (await openSession()) return
  await run(`INSERT INTO sessions (id, status, limit_sec, created_at) VALUES (?, 'open', ?, ?)`, [crypto.randomUUID(), limitSec, Date.now()])
}

const finishCurrent = (sid: string) => changes(`UPDATE queue_entries SET status = 'done' WHERE session_id = ? AND status IN ('called','live')`, [sid])

export async function endSession() {
  const s = await openSession()
  if (!s) return
  await finishCurrent(s.id) // no advance: the night is over
  await run(`UPDATE sessions SET status = 'closed' WHERE id = ?`, [s.id])
}

export async function setLimit(sec: number) {
  if (!(sec >= 10 && sec <= 3600)) throw new Error('limit must be 10–3600 seconds')
  await run(`UPDATE sessions SET limit_sec = ? WHERE status = 'open'`, [Math.round(sec)])
}

export async function setQuality(quality: string) {
  if (!(quality in QUALITY)) throw new Error('unknown quality')
  await run(`UPDATE sessions SET quality = ? WHERE status = 'open'`, [quality])
}
export const setAudio = (on: boolean) => run(`UPDATE sessions SET audio = ? WHERE status = 'open'`, [on ? 1 : 0])

const MAX_WAITING = 200 // a script can't bury the line; far above a real hack night. Reset = end + start a session.
// Names go on the projector: drop control/format chars (bidi overrides, zero-width) and cap stacked combining marks.
const clean = (s: string, max: number) =>
  s.normalize('NFC').replace(/\s+/g, ' ').replace(/\p{C}/gu, '').replace(/(\p{M}{2})\p{M}+/gu, '$1').trim().slice(0, max)

export async function join(token: string, name: string, project: string) {
  name = clean(name, 60)
  project = clean(project, 80)
  if (!name || !project) throw new Error('name and project are required')
  const s = await openSession()
  if (!s) throw new Error('No checkpoint is running')
  const now = Date.now()
  const mine = await one(`SELECT * FROM queue_entries WHERE session_id = ? AND client_token = ?`, [s.id, token])
  // Left or already presented: joining again goes to the back of the line. Removed stays out.
  const again = mine?.status === 'left' || mine?.status === 'done'
  if (!mine || again) {
    const { n } = (await one(`SELECT COUNT(*) AS n FROM queue_entries WHERE session_id = ? AND status = 'waiting'`, [s.id]))!
    if (n >= MAX_WAITING) throw new Error('The queue is full')
  }
  if (!mine) {
    await run(
      `INSERT INTO queue_entries (id, session_id, client_token, name, project, stream_id, sort_key, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ${NEXT_KEY}, ?, ?)
       ON CONFLICT (session_id, client_token) DO NOTHING`, // a double-submitted Join must not 500
      [crypto.randomUUID(), s.id, token, name, project, 'ck' + crypto.randomUUID().replaceAll('-', '').slice(0, 14), s.id, now, now],
    )
  } else if (again) {
    await run(`UPDATE queue_entries SET status = 'waiting', bye_at = NULL, name = ?, project = ?, share_state = 'not_shared', started_at = NULL, deadline = NULL, paused_left = NULL, called_at = NULL, sort_key = ${NEXT_KEY}, joined_at = ?, last_seen_at = ? WHERE id = ? AND status IN ('left','done')`, [name, project, s.id, now, now, mine.id])
  } // else: already has a spot (or was removed): joining again returns it unchanged
  await advance(s.id) // empty stage: the joiner is up right away
}

const ACTIVE = `IN ('waiting','called','live')`
const OPEN = `session_id IN (SELECT id FROM sessions WHERE status = 'open')`
const mutate = (set: string, status: string, token: string, args: any[] = []) =>
  run(`UPDATE queue_entries SET ${set}, bye_at = NULL WHERE client_token = ? AND ${OPEN} AND status ${status}`, [...args, token])

// Finishing the called/live entry advances the line; a waiting entry leaving does not.
export async function leave(token: string) {
  const n = await changes(`UPDATE queue_entries SET status = 'left', paused_left = NULL WHERE client_token = ? AND ${OPEN} AND status IN ('called','live')`, [token])
  if (n) return advanceOpen()
  await mutate(`status = 'left', paused_left = NULL`, `= 'waiting'`, token)
}
export const setShare = (token: string, state: ShareState) => mutate(`share_state = ?`, ACTIVE, token, [state])
export async function end(token: string) {
  const n = await changes(`UPDATE queue_entries SET status = 'done', paused_left = NULL WHERE client_token = ? AND ${OPEN} AND status = 'live'`, [token])
  if (n) await advanceOpen()
}
// One statement for every connected hacker, instead of one per socket.
export const touch = (tokens: string[]) => tokens.length
  ? run(`UPDATE queue_entries SET last_seen_at = ?, bye_at = NULL WHERE client_token IN (${tokens.map(() => '?').join()}) AND ${OPEN} AND status ${ACTIVE}`, [Date.now(), ...tokens])
  : undefined

// Tab closed (pagehide beacon). Not removed yet: a refresh or a new socket within BYE_GRACE_MS cancels it (back).
export const bye = (token: string, now = Date.now()) =>
  run(`UPDATE queue_entries SET bye_at = ? WHERE client_token = ? AND ${OPEN} AND status ${ACTIVE}`, [now, token])
export const back = (...tokens: string[]) => tokens.length
  ? run(`UPDATE queue_entries SET bye_at = NULL WHERE client_token IN (${tokens.map(() => '?').join()}) AND bye_at IS NOT NULL AND ${OPEN}`, tokens)
  : undefined
// Grace over: they really left. Called/live advance the line, waiting just drop out.
export async function sweepByes(now = Date.now()) {
  const cutoff = now - BYE_GRACE_MS
  const n = await changes(`UPDATE queue_entries SET status = 'left', paused_left = NULL WHERE bye_at <= ? AND ${OPEN} AND status IN ('called','live')`, [cutoff])
  await run(`UPDATE queue_entries SET status = 'left', paused_left = NULL WHERE bye_at <= ? AND ${OPEN} AND status = 'waiting'`, [cutoff])
  if (n) await advanceOpen()
}

// Ready gate: called -> live, and the server fixes the deadline.
export async function adminReady(entryId: string) {
  const s = await openSession()
  if (!s) return
  const now = Date.now()
  await run(`UPDATE queue_entries SET status = 'live', started_at = ?, deadline = ?, paused_left = NULL WHERE session_id = ? AND status = 'called' AND id = ?`, [now, now + s.limit_sec * 1000, s.id, entryId])
}

export const pause = (id: string) =>
  run(`UPDATE queue_entries SET paused_left = MAX(0, deadline - ?), deadline = NULL WHERE id = ? AND status = 'live' AND deadline IS NOT NULL`, [Date.now(), id])
export const resume = (id: string) =>
  run(`UPDATE queue_entries SET deadline = ? + paused_left, paused_left = NULL WHERE id = ? AND status = 'live' AND paused_left IS NOT NULL`, [Date.now(), id])
export const adjust = (id: string, deltaSec: number) =>
  run(`UPDATE queue_entries SET
    deadline = CASE WHEN deadline IS NOT NULL THEN MAX(?, deadline + ?) END,
    paused_left = CASE WHEN paused_left IS NOT NULL THEN MAX(0, paused_left + ?) END
    WHERE id = ? AND status = 'live'`, [Date.now(), deltaSec * 1000, deltaSec * 1000, id])

// The hacker's own Ready needs a running share, so the clock never starts on a blank screen.
// adminReady stays unconditional: the organizer's override (e.g. someone on the backup share).
// noShare: the hacker chose to present without a screen (talk only, phone, backup share).
export async function hackerReady(token: string, noShare = false) {
  const e = await one(`SELECT id, status, share_state FROM queue_entries WHERE client_token = ? AND ${OPEN}`, [token])
  if (!e) return
  if (e.status === 'called' && e.share_state !== 'sharing' && !noShare) throw new Error('Share your screen first, then press Start presenting.')
  await adminReady(e.id as string)
}

// Ends exactly the entry the organizer clicked. If it already finished (deadline, double-click), the next
// person who was just called is NOT touched.
export async function stop(id: string) {
  const n = await changes(`UPDATE queue_entries SET status = 'done', paused_left = NULL WHERE id = ? AND ${OPEN} AND status IN ('called','live')`, [id])
  if (n) await advanceOpen()
}
export async function remove(id: string) {
  const n = await changes(`UPDATE queue_entries SET status = 'removed', paused_left = NULL WHERE id = ? AND status IN ('called','live')`, [id])
  if (n) return advanceOpen()
  await run(`UPDATE queue_entries SET status = 'removed', paused_left = NULL WHERE id = ? AND status = 'waiting'`, [id])
}

// Move behind the next waiting person. A called (not yet live) entry goes back to waiting, then the next is called.
export async function skip(id: string) {
  const s = await openSession()
  if (!s) return
  const w = await all(`SELECT id, sort_key FROM queue_entries WHERE session_id = ? AND status = 'waiting' ORDER BY sort_key`, [s.id])
  const key = (next: number, after?: number) => (after === undefined ? next + 1 : (next + after) / 2)
  const i = w.findIndex((r) => r.id === id)
  if (i < 0) {
    if (!w.length) return // nobody to swap with
    const n = await changes(
      `UPDATE queue_entries SET status = 'waiting', called_at = NULL, paused_left = NULL, sort_key = ? WHERE id = ? AND session_id = ? AND status = 'called'`,
      [key(w[0].sort_key as number, w[1]?.sort_key as number | undefined), id, s.id],
    )
    if (n) await advance(s.id)
    return
  }
  if (i === w.length - 1) return
  await run(`UPDATE queue_entries SET sort_key = ? WHERE id = ?`, [key(w[i + 1].sort_key as number, w[i + 2]?.sort_key as number | undefined), id])
}

// US-5.5: swap places with the neighbouring waiting entry (dir -1 = up, 1 = down).
export async function move(id: string, dir: -1 | 1) {
  const s = await openSession()
  if (!s) return
  const w = await all(`SELECT id, sort_key FROM queue_entries WHERE session_id = ? AND status = 'waiting' ORDER BY sort_key`, [s.id])
  const i = w.findIndex((r) => r.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= w.length) return
  await run(`UPDATE queue_entries SET sort_key = CASE id WHEN ? THEN ? ELSE ? END WHERE id IN (?, ?)`, [id, w[j].sort_key, w[i].sort_key, id, w[j].id])
}

// The server-owned cutoff. Called every tick, so it also catches deadlines passed while the server was down.
export async function expire(now = Date.now()) {
  const n = await changes(`UPDATE queue_entries SET status = 'done', paused_left = NULL WHERE status = 'live' AND deadline <= ?`, [now])
  if (n) await advanceOpen()
  await sweepByes(now)
  await advanceOpen() // the invariant, last: covers every path above and slots finished elsewhere
}

// Two reads cover every client: broadcasts build each socket's view from one snapshot, so DB load
// doesn't grow with the number of open sockets.
export async function snapshot() {
  const s = await latestSession()
  return { s, rows: s ? await all(`SELECT * FROM queue_entries WHERE session_id = ? ORDER BY sort_key`, [s.id]) : [] }
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>

export const loadState = async (role: Role, token?: string) => view(await snapshot(), role, token)

export function view({ s, rows }: Snapshot, role: Role, token?: string): State {
  const serverNow = Date.now()
  if (!s) return { serverNow, session: null, current: null, queue: [] }
  const admin = role === 'admin'
  const cur = rows.find((r) => r.status === 'called' || r.status === 'live')
  const waiting = s.status === 'open' ? rows.filter((r) => r.status === 'waiting') : [] // a closed session has no line
  const current: Current | null = !cur ? null : {
    entryId: cur.id, name: cur.name, project: cur.project, status: cur.status,
    startedAt: cur.started_at, deadline: cur.deadline, pausedLeft: cur.paused_left, shareState: cur.share_state,
    ...((admin || (role === 'host' && cur.status === 'live')) && { streamId: cur.stream_id }),
  }
  const queue: QueueItem[] = waiting.map((r) => ({
    id: r.id, name: r.name, project: r.project, shareState: r.share_state, joinedAt: r.joined_at,
    connected: serverNow - r.last_seen_at < DISCONNECTED_MS,
    ...(admin && { streamId: r.stream_id }),
  }))
  const state: State = { serverNow, session: { status: s.status, limitSec: s.limit_sec, quality: s.quality, audio: !!s.audio }, current, queue }
  const mine = role === 'hacker' && token ? rows.find((r) => r.client_token === token) : undefined
  if (mine) {
    state.me = { entryId: mine.id, name: mine.name, project: mine.project, status: mine.status, position: waiting.indexOf(mine) + 1, streamId: mine.stream_id }
  }
  return state
}
