import { beforeAll, expect, test } from 'bun:test'

process.env.TURSO_DATABASE_URL = ':memory:'
const q = await import('./queue')

// Other test files share this in-memory DB: always start from a fresh checkpoint.
beforeAll(async () => { await q.endSession(); await q.startSession(120) })

const stopCur = async () => q.stop((await q.loadState('host')).current!.entryId)
const pos = async (t: string) => (await q.loadState('hacker', t)).me?.position

test('join is idempotent per token and ordered; the first joiner is called at once', async () => {
  await q.join('tok-aaaaaaaa', 'Ada', 'Engine')
  await q.join('tok-bbbbbbbb', 'Bob', 'Loom')
  await q.join('tok-cccccccc', 'Cy', 'Kite')
  await q.join('tok-aaaaaaaa', 'Ada', 'Engine')
  expect((await q.loadState('host')).current).toMatchObject({ name: 'Ada', status: 'called' })
  expect((await q.loadState('host')).queue.map((e) => e.name)).toEqual(['Bob', 'Cy'])
  expect(await pos('tok-cccccccc')).toBe(2)
})

test('stream ids only reach admin and (own entry) hacker', async () => {
  expect((await q.loadState('host')).queue[0].streamId).toBeUndefined()
  expect((await q.loadState('admin')).queue[0].streamId).toBeString()
  expect((await q.loadState('hacker', 'tok-aaaaaaaa')).me?.streamId).toBeString()
})

test('skip moves behind the next person', async () => {
  await q.skip((await q.loadState('host')).queue[0].id)
  expect((await q.loadState('host')).queue.map((e) => e.name)).toEqual(['Cy', 'Bob'])
})

test('called -> ready -> live sets a deadline; host sees stream only when live', async () => {
  let host = await q.loadState('host')
  expect(host.current).toMatchObject({ name: 'Ada', status: 'called' })
  expect(host.current?.streamId).toBeUndefined()
  // No share yet: the hacker's Ready is refused and the clock doesn't start.
  await expect(q.hackerReady('tok-aaaaaaaa')).rejects.toThrow('Share your screen first')
  host = await q.loadState('host')
  expect(host.current).toMatchObject({ status: 'called', deadline: null })
  await q.setShare('tok-aaaaaaaa', 'sharing')
  await q.hackerReady('tok-aaaaaaaa')
  host = await q.loadState('host')
  expect(host.current?.status).toBe('live')
  expect(host.current?.deadline).toBe(host.current!.startedAt! + 120_000)
  expect(host.current?.streamId).toBeString()
})

test('quality and projector audio round-trip; bad quality is rejected', async () => {
  expect((await q.loadState('host')).session).toMatchObject({ quality: '1080p', audio: true })
  await q.setQuality('720p')
  await q.setAudio(false)
  expect((await q.loadState('hacker', 'tok-aaaaaaaa')).session).toMatchObject({ quality: '720p', audio: false })
  await expect(q.setQuality('8k')).rejects.toThrow()
  await q.setQuality('1080p')
  await q.setAudio(true)
})

test('expire ends a live slot at its deadline, not before', async () => {
  const { deadline } = (await q.loadState('host')).current!
  await q.expire(deadline! - 1)
  expect((await q.loadState('host')).current).not.toBeNull()
  await q.expire(deadline!)
  expect((await q.loadState('host')).current).toMatchObject({ name: 'Cy', status: 'called' }) // auto-advanced
  expect((await q.loadState('hacker', 'tok-aaaaaaaa')).me?.status).toBe('done')
})

test('stop replaces the current presenter; remove drops a waiting entry', async () => {
  expect((await q.loadState('host')).current?.name).toBe('Cy')
  await stopCur()
  expect((await q.loadState('host')).current?.name).toBe('Bob')
  await q.join('tok-zzzzzzzz', 'Zed', 'Z')
  await q.remove((await q.loadState('host')).queue[0].id)
  expect((await q.loadState('host')).queue).toEqual([])
})

test('ending the session closes joining', async () => {
  await q.endSession()
  expect((await q.loadState('host')).session?.status).toBe('closed')
  expect((await q.loadState('host')).current).toBeNull()
  expect(q.join('tok-dddddddd', 'Di', 'Zip')).rejects.toThrow('No checkpoint')
})

// ---- a second session: leave/rejoin, share state, end early, limit, disconnect ----
const host = () => q.loadState('host')
const names = async () => (await host()).queue.map((e) => e.name)

test('leave drops me from the line; rejoining sends me to the back', async () => {
  await q.startSession(120)
  await q.join('tok-dummy000', 'Dum', 'X') // takes the stage, so Eve and Fay wait
  await q.join('tok-eeeeeeee', 'Eve', 'A')
  await q.join('tok-ffffffff', 'Fay', 'B')
  await q.leave('tok-eeeeeeee')
  expect(await names()).toEqual(['Fay'])
  expect((await q.loadState('hacker', 'tok-eeeeeeee')).me?.status).toBe('left')
  await q.join('tok-eeeeeeee', 'Eve', 'A')
  expect(await names()).toEqual(['Fay', 'Eve'])
})

test('join validates and trims; a second session cannot start while one is open', async () => {
  expect(q.join('tok-gggggggg', '  ', 'x')).rejects.toThrow('required')
  expect(q.join('tok-gggggggg', 'x', '')).rejects.toThrow('required')
  await q.join('tok-gggggggg', ` ${'N'.repeat(100)} `, 'P')
  expect((await host()).queue.at(-1)!.name).toHaveLength(60)
  await q.startSession(30) // no-op: already open
  expect((await host()).session?.limitSec).toBe(120)
  await q.leave('tok-gggggggg')
})

test('share state is recorded for the admin and the current slot', async () => {
  await q.setShare('tok-ffffffff', 'sharing')
  expect((await host()).queue[0].shareState).toBe('sharing')
  await q.setShare('tok-ffffffff', 'stopped')
  expect((await host()).queue[0].shareState).toBe('stopped')
  await q.setShare('tok-ffffffff', 'sharing')
  await q.stop((await host()).current!.entryId) // Dum off, Fay up
  expect((await host()).current).toMatchObject({ name: 'Fay', shareState: 'sharing' })
})

test('only a live presenter can end early; ready on a waiting entry does nothing', async () => {
  await q.end('tok-ffffffff') // still `called`, so ignored
  expect((await host()).current?.status).toBe('called')
  await q.hackerReady('tok-eeeeeeee') // Eve is waiting, not called
  expect((await q.loadState('hacker', 'tok-eeeeeeee')).me?.status).toBe('waiting')
  await q.adminReady((await host()).current!.entryId)
  expect((await host()).current?.status).toBe('live')
  await q.end('tok-ffffffff')
  expect((await host()).current).toMatchObject({ name: 'Eve', status: 'called' }) // auto-advanced
  expect((await q.loadState('hacker', 'tok-ffffffff')).me?.status).toBe('done')
})

test('time limit is validated and applies to the next slot', async () => {
  expect(q.setLimit(5)).rejects.toThrow('limit')
  expect(q.setLimit(99999)).rejects.toThrow('limit')
  await q.setLimit(60)
  await q.hackerReady('tok-eeeeeeee', true) // Eve isn't sharing but chose to present without a screen
  const c = (await host()).current!
  expect(c).toMatchObject({ name: 'Eve', status: 'live', shareState: 'not_shared' })
  expect(c.deadline! - c.startedAt!).toBe(60_000)
})

test('stop ends the current presenter; remove works on the current one too', async () => {
  await stopCur()
  expect((await host()).current).toBeNull()
  await q.join('tok-hhhhhhhh', 'Hal', 'C') // empty stage: called at once
  await q.remove((await host()).current!.entryId)
  expect((await host()).current).toBeNull()
  expect((await q.loadState('hacker', 'tok-hhhhhhhh')).me?.status).toBe('removed')
})

test('an entry unseen for 3+ minutes shows as disconnected until it is touched', async () => {
  await q.join('tok-dummy111', 'Dum', 'X') // on stage
  await q.join('tok-iiiiiiii', 'Ivy', 'D')
  expect((await host()).queue[0].connected).toBe(true)
  const realNow = Date.now
  Date.now = () => realNow() + 4 * 60_000
  try {
    expect((await host()).queue[0].connected).toBe(false)
    await q.touch(['tok-iiiiiiii'])
    expect((await host()).queue[0].connected).toBe(true)
  } finally { Date.now = realNow }
})

// ---- US-5.5 reorder ----
test('move shifts a waiting entry up or down one place; edges and non-waiting are no-ops', async () => {
  await stopCur(); await q.leave('tok-iiiiiiii') // stop calls Ivy, who then leaves
  await q.join('tok-blocker1', 'Blk', 'X') // on stage, so the three below wait
  for (const [t, n] of [['tok-jjjjjjjj', 'Jo'], ['tok-kkkkkkkk', 'Ki'], ['tok-llllllll', 'Lu']]) await q.join(t, n, 'P')
  const id = async (n: string) => (await host()).queue.find((e) => e.name === n)!.id
  await q.move(await id('Lu'), -1)
  expect(await names()).toEqual(['Jo', 'Lu', 'Ki'])
  await q.move(await id('Jo'), 1)
  expect(await names()).toEqual(['Lu', 'Jo', 'Ki'])
  await q.move(await id('Lu'), -1) // already first
  await q.move(await id('Ki'), 1) // already last
  expect(await names()).toEqual(['Lu', 'Jo', 'Ki'])
  await q.move('no-such-id', -1)
  expect(await names()).toEqual(['Lu', 'Jo', 'Ki'])
})

// ---- abuse ----
test('names are cleaned: bidi overrides, zero-width and control chars dropped, combining marks capped', async () => {
  await q.join('tok-mmmmmmmm', '‮evil\u0000​ ' + 'Z̶̶̶̶', 'line\n\nbreak')
  const me = (await q.loadState('hacker', 'tok-mmmmmmmm')).me!
  expect(me.name).toBe('evil Z̶̶')
  expect(me.project).toBe('line break')
  await expect(q.join('tok-nnnnnnnn', '​‮', 'P')).rejects.toThrow('required')
})

test('the waiting line is capped so a script cannot flood it', async () => {
  await q.endSession(); await q.startSession()
  for (let i = 0; i < 201; i++) await q.join(`flood-${String(i).padStart(4, '0')}`, 'bot', 'spam')
  await expect(q.join('tok-oooooooo', 'Real', 'Person')).rejects.toThrow('full')
  expect((await host()).queue).toHaveLength(200)
})

test('ready gate: needs a running share (or noShare); the clock starts only on Ready', async () => {
  await q.endSession(); await q.startSession(90)
  for (const [t, n] of [['gate-aaaaaaaa', 'Gia'], ['gate-bbbbbbbb', 'Gus'], ['gate-cccccccc', 'Gwen']]) await q.join(t, n, 'Proj')
  // Not called yet: Ready (even with noShare) changes nothing.
  await q.hackerReady('gate-bbbbbbbb', true)
  expect((await q.loadState('hacker', 'gate-bbbbbbbb')).me?.status).toBe('waiting')
  // Called but not sharing, or share stopped: refused, still called, no deadline.
  await expect(q.hackerReady('gate-aaaaaaaa')).rejects.toThrow('Share your screen first')
  await q.setShare('gate-aaaaaaaa', 'stopped')
  await expect(q.hackerReady('gate-aaaaaaaa')).rejects.toThrow('Share your screen first')
  expect((await host()).current).toMatchObject({ name: 'Gia', status: 'called', deadline: null, startedAt: null })
  // Sharing: Ready goes live with deadline = now + limit.
  await q.setShare('gate-aaaaaaaa', 'sharing')
  const before = Date.now()
  await q.hackerReady('gate-aaaaaaaa')
  const c = (await host()).current!
  expect(c.status).toBe('live')
  expect(c.startedAt!).toBeGreaterThanOrEqual(before)
  expect(c.deadline).toBe(c.startedAt! + 90_000)
  // noShare works while called.
  await q.stop(c.entryId) // Gus
  expect((await host()).current).toMatchObject({ name: 'Gus', status: 'called', deadline: null })
  await q.hackerReady('gate-bbbbbbbb', true)
  expect((await host()).current).toMatchObject({ name: 'Gus', status: 'live', shareState: 'not_shared' })
})

test('a double-submitted join is one spot, not an error', async () => {
  await q.endSession(); await q.startSession(90)
  await Promise.all([q.join('dbl-aaaaaaaa', 'Dee', 'Proj'), q.join('dbl-aaaaaaaa', 'Dee', 'Proj')])
  expect((await q.snapshot()).rows).toHaveLength(1)
})

// ---- auto-advance ----
const cur = async () => (await host()).current
const live = async (t: string) => { await q.hackerReady(t, true) }
const fresh = async (...ns: string[]) => {
  await q.endSession(); await q.startSession(90)
  for (const n of ns) await q.join(`aa-${n}-xxxx`, n, 'P')
}
const status = async (n: string) => (await q.loadState('hacker', `aa-${n}-xxxx`)).me?.status
const calledOrLive = async () => (await q.snapshot()).rows.filter((r) => r.status === 'called' || r.status === 'live').length

test('pause freezes time past the old deadline; resume restores the remaining time', async () => {
  await fresh('A', 'B')
  await live('aa-A-xxxx')
  const { entryId, deadline } = (await cur())!
  const realNow = Date.now
  let now = deadline! - 45_000
  Date.now = () => now
  try {
    await q.pause(entryId)
    expect(await cur()).toMatchObject({ entryId, status: 'live', deadline: null, pausedLeft: 45_000 })
    now = deadline! + 60_000
    await q.expire(now)
    await q.pause(entryId) // repeated pause keeps the frozen time
    expect(await cur()).toMatchObject({ entryId, status: 'live', deadline: null, pausedLeft: 45_000 })
    await q.resume(entryId)
    expect(await cur()).toMatchObject({ deadline: now + 45_000, pausedLeft: null })
    now += 1000
    await q.resume(entryId) // repeated resume does not extend the clock
    expect((await cur())!.deadline).toBe(now + 44_000)
  } finally { Date.now = realNow }
})

test('adjust adds and subtracts running time, clamped at zero until expire', async () => {
  await fresh('A', 'B')
  await live('aa-A-xxxx')
  const { entryId, deadline } = (await cur())!
  const realNow = Date.now
  const now = deadline! - 20_000
  Date.now = () => now
  try {
    await q.adjust(entryId, 30)
    expect(await cur()).toMatchObject({ deadline: deadline! + 30_000, pausedLeft: null })
    await q.adjust(entryId, -30)
    expect((await cur())!.deadline).toBe(deadline)
    await q.adjust(entryId, -30)
    expect(await cur()).toMatchObject({ entryId, status: 'live', deadline: now, pausedLeft: null })
    await q.expire(now)
    expect(await cur()).toMatchObject({ name: 'B', status: 'called' })
  } finally { Date.now = realNow }
})

test('adjust adds and subtracts paused time, clamped at zero without expiring', async () => {
  await fresh('A')
  await live('aa-A-xxxx')
  const { entryId, deadline } = (await cur())!
  const realNow = Date.now
  let now = deadline! - 20_000
  Date.now = () => now
  try {
    await q.pause(entryId)
    await q.adjust(entryId, 30)
    expect(await cur()).toMatchObject({ deadline: null, pausedLeft: 50_000 })
    await q.adjust(entryId, -30)
    expect((await cur())!.pausedLeft).toBe(20_000)
    await q.adjust(entryId, -30)
    now = deadline! + 60_000
    await q.expire(now)
    expect(await cur()).toMatchObject({ entryId, status: 'live', deadline: null, pausedLeft: 0 })
    await q.resume(entryId)
    expect(await cur()).toMatchObject({ deadline: now, pausedLeft: null })
    now += 1000
    await q.pause(entryId)
    expect((await cur())!.pausedLeft).toBe(0)
  } finally { Date.now = realNow }
})

test('pause, resume and adjust on non-live or unknown entries are no-ops', async () => {
  await fresh('A', 'B', 'C')
  await q.stop((await cur())!.entryId)
  const before = await q.snapshot()
  for (const id of [...before.rows.map((r) => r.id), 'no-such-id']) {
    await q.pause(id)
    await q.resume(id)
    await q.adjust(id, 30)
    await q.adjust(id, -30)
  }
  expect(await q.snapshot()).toEqual(before)
})

test('a paused presenter who finishes any way frees the stage, and their next turn gets a full running clock', async () => {
  const ways: [string, (id: string) => Promise<unknown>][] = [
    ['stop', q.stop], ['remove', q.remove], ['end', () => q.end('aa-A-xxxx')], ['leave', () => q.leave('aa-A-xxxx')],
    ['closed tab', async () => { await q.bye('aa-A-xxxx'); await q.sweepByes(Date.now() + 5_000) }],
  ]
  for (const [way, finish] of ways) {
    await fresh('A', 'B')
    await live('aa-A-xxxx')
    const { entryId } = (await cur())!
    await q.pause(entryId)
    await finish(entryId)
    expect(await cur(), way).toMatchObject({ name: 'B', status: 'called', pausedLeft: null })
    if (way === 'remove') continue // removed people can't come back
    await q.join('aa-A-xxxx', 'A', 'P') // back of the line
    await q.stop((await cur())!.entryId) // B done, A up again
    await live('aa-A-xxxx')
    const again = (await cur())!
    expect(again, way).toMatchObject({ name: 'A', status: 'live', pausedLeft: null })
    expect(again.deadline! - again.startedAt!, way).toBe(90_000) // not the old frozen time
  }
})

test('stop on someone waiting, or on a closed checkpoint, does nothing', async () => {
  await fresh('A', 'B', 'C')
  await q.stop((await host()).queue[0].id) // B is waiting, not on stage
  expect(await cur()).toMatchObject({ name: 'A', status: 'called' })
  expect(await names()).toEqual(['B', 'C'])
  await q.stop('no-such-id')
  expect(await cur()).toMatchObject({ name: 'A', status: 'called' })
  const a = (await cur())!.entryId
  await q.endSession(); await q.startSession(90)
  await q.join('aa-X-xxxx', 'X', 'P')
  await q.stop(a) // A's old checkpoint is over; the new stage is untouched
  expect(await cur()).toMatchObject({ name: 'X', status: 'called' })
})

test('pausing one presenter never pauses the next one', async () => {
  await fresh('A', 'B')
  await live('aa-A-xxxx')
  const a = (await cur())!.entryId
  await q.pause(a)
  await q.stop(a)
  await live('aa-B-xxxx')
  const { deadline } = (await cur())!
  await q.expire(deadline!) // B's clock runs and ends on time
  expect(await status('B')).toBe('done')
})

test('joining an empty stage calls that person at once; the next joiner waits', async () => {
  await fresh()
  expect(await cur()).toBeNull()
  await q.join('aa-A-xxxx', 'A', 'P')
  expect(await cur()).toMatchObject({ name: 'A', status: 'called' })
  expect((await q.snapshot()).rows[0].called_at).toBeNumber()
  await q.join('aa-B-xxxx', 'B', 'P')
  expect(await cur()).toMatchObject({ name: 'A' })
  expect(await names()).toEqual(['B'])
})

test('expire calls the first waiting person when the stage is empty (self-heal)', async () => {
  await fresh('A', 'B', 'C')
  const { db } = await import('./db')
  await db.execute(`UPDATE queue_entries SET status = 'done' WHERE name = 'A'`) // e.g. older code finished it without advancing
  expect(await cur()).toBeNull()
  await q.expire()
  expect(await cur()).toMatchObject({ name: 'B', status: 'called' })
  expect(await names()).toEqual(['C'])
})

test('skip on the called person goes behind the next and calls the next; alone it does nothing', async () => {
  await fresh('A', 'B', 'C')
  await q.skip((await cur())!.entryId)
  expect(await cur()).toMatchObject({ name: 'B', status: 'called' })
  expect(await names()).toEqual(['A', 'C'])
  expect((await q.snapshot()).rows.find((r) => r.name === 'A')!.called_at).toBeNull()
  await fresh('A')
  await q.skip((await cur())!.entryId)
  expect(await cur()).toMatchObject({ name: 'A', status: 'called' })
  await fresh('A', 'B')
  await q.hackerReady('aa-A-xxxx', true)
  await q.skip((await cur())!.entryId) // live: not skippable
  expect(await cur()).toMatchObject({ name: 'A', status: 'live' })
})

test('concurrent joins and expire leave exactly one called/live', async () => {
  await fresh()
  await Promise.all([...'ABCDEFGH'].map((n) => q.join(`aa-${n}-xxxx`, n, 'P')).concat([q.expire(), q.expire()]))
  expect(await calledOrLive()).toBe(1)
  expect(await names()).toHaveLength(7)
})

test('expire, end, stop advance to the first waiting person', async () => {
  await fresh('A', 'B', 'C', 'D')
  await live('aa-A-xxxx')
  const { deadline } = (await cur())!
  await q.expire(deadline!)
  expect(await cur()).toMatchObject({ name: 'B', status: 'called' })
  expect((await q.loadState('host')).queue.map((e) => e.name)).toEqual(['C', 'D'])
  await live('aa-B-xxxx')
  await q.end('aa-B-xxxx')
  expect(await cur()).toMatchObject({ name: 'C', status: 'called' })
  await stopCur()
  expect(await cur()).toMatchObject({ name: 'D', status: 'called' })
  expect((await q.snapshot()).rows.find((r) => r.name === 'D')!.called_at).toBeNumber()
})

test('current leaving or being removed advances; a waiting person leaving or removed does not', async () => {
  await fresh('A', 'B', 'C', 'D')
  await q.leave('aa-A-xxxx')
  expect(await cur()).toMatchObject({ name: 'B' })
  await q.remove((await cur())!.entryId)
  expect(await cur()).toMatchObject({ name: 'C' })
  await stopCur(); await stopCur()
  expect(await cur()).toBeNull() // D was called by the first stop, finished by the second
  await q.join('aa-E-xxxx', 'E', 'P'); await q.join('aa-F-xxxx', 'F', 'P'); await q.join('aa-G-xxxx', 'G', 'P')
  await q.leave('aa-F-xxxx')
  await q.remove((await host()).queue[0].id)
  expect(await cur()).toMatchObject({ name: 'E' })
})

test('finishing with an empty line leaves the stage empty; endSession does not advance', async () => {
  await fresh('A')
  await stopCur()
  expect(await cur()).toBeNull()
  await fresh('A', 'B')
  await q.endSession()
  const rows = (await q.snapshot()).rows
  expect(rows.map((r) => r.status).sort()).toEqual(['done', 'waiting'])
})

test('concurrent finishes never leave two called/live entries', async () => {
  await fresh('A', 'B', 'C')
  await live('aa-A-xxxx')
  const { deadline } = (await cur())!
  const a = (await cur())!.entryId
  await Promise.all([q.stop(a), q.stop(a), q.expire(deadline!), q.end('aa-A-xxxx')])
  expect(await calledOrLive()).toBe(1)
  expect((await cur())!.name).toBe('B') // the repeated stops of A never touch B
  await q.stop(a) // late click on someone already finished
  expect((await cur())).toMatchObject({ name: 'B', status: 'called' })
})

// ---- closed tab (bye) ----
test('bye then grace -> left; before grace nothing happens; waiting leaving does not advance', async () => {
  await fresh('A', 'B', 'C')
  const t = Date.now()
  await q.bye('aa-C-xxxx', t)
  await q.sweepByes(t + 4_999)
  expect(await status('C')).toBe('waiting')
  await q.sweepByes(t + 5_000)
  expect(await status('C')).toBe('left')
  expect(await cur()).toMatchObject({ name: 'A', status: 'called' })
  expect(await names()).toEqual(['B'])
})

test('back within the grace keeps the spot', async () => {
  await fresh('A', 'B')
  const t = Date.now()
  await q.bye('aa-B-xxxx', t)
  await q.back('aa-B-xxxx')
  await q.sweepByes(t + 60_000)
  expect(await status('B')).toBe('waiting')
  await q.bye('aa-B-xxxx', t)
  await q.touch(['aa-B-xxxx']) // any sign of life also cancels it
  await q.sweepByes(t + 60_000)
  expect(await status('B')).toBe('waiting')
})

test('a called or live presenter who closes the tab frees the stage for the next person', async () => {
  await fresh('A', 'B', 'C')
  const t = Date.now()
  await q.bye('aa-A-xxxx', t)
  await q.sweepByes(t + 5_000)
  expect(await status('A')).toBe('left')
  expect(await cur()).toMatchObject({ name: 'B', status: 'called' })
  await live('aa-B-xxxx')
  await q.bye('aa-B-xxxx', t)
  await q.expire(t + 5_000) // the tick path
  expect(await status('B')).toBe('left')
  expect(await cur()).toMatchObject({ name: 'C', status: 'called' })
  expect(await calledOrLive()).toBe(1)
})

test('a live presenter who refreshes within the grace keeps their slot and their clock', async () => {
  await fresh('A', 'B')
  await live('aa-A-xxxx')
  const before = (await cur())!
  const t = Date.now()
  await q.bye('aa-A-xxxx', t) // refresh fires pagehide...
  await q.back('aa-A-xxxx') // ...and the new page's socket comes back
  await q.expire(t + 5_000)
  expect(await cur()).toMatchObject({ entryId: before.entryId, status: 'live', deadline: before.deadline, away: false })
})

test('when a closed tab runs out its grace, the next person is up and not shown as away', async () => {
  await fresh('A', 'B')
  const t = Date.now()
  await q.bye('aa-A-xxxx', t)
  expect(await cur()).toMatchObject({ name: 'A', away: true })
  await q.expire(t + 5_000)
  expect(await cur()).toMatchObject({ name: 'B', status: 'called', away: false })
})

test('bye for an unknown token or a finished entry is a no-op, and bye_at is not exposed', async () => {
  await fresh('A')
  await q.bye('no-such-token')
  await q.bye('aa-A-xxxx')
  await q.sweepByes(Date.now() + 60_000)
  expect(await status('A')).toBe('left')
  await q.join('aa-A-xxxx', 'A', 'P') // rejoining clears the old bye (and, on an empty stage, calls them)
  await q.sweepByes(Date.now() + 60_000)
  expect(await status('A')).toBe('called')
  expect(JSON.stringify(await q.loadState('hacker', 'aa-A-xxxx'))).not.toContain('bye')
})

test('after presenting you can join again at the back; removed stays out', async () => {
  await q.endSession(); await q.startSession(90)
  await q.join('again-aaaaaaa', 'Ann', 'P1')
  await q.join('again-bbbbbbb', 'Ben', 'P2')
  await q.hackerReady('again-aaaaaaa', true)
  await q.end('again-aaaaaaa') // Ann done; Ben is up
  expect((await q.loadState('hacker', 'again-aaaaaaa')).me?.status).toBe('done')
  await q.join('again-aaaaaaa', 'Ann', 'P1 v2')
  const ann = (await q.loadState('hacker', 'again-aaaaaaa')).me!
  expect(ann).toMatchObject({ status: 'waiting', position: 1, project: 'P1 v2' })
  expect((await host()).current).toMatchObject({ name: 'Ben', status: 'called', deadline: null })
  const row = (await q.snapshot()).rows.find((r) => r.client_token === 'again-aaaaaaa')!
  expect([row.started_at, row.deadline]).toEqual([null, null]) // the old slot's clock doesn't come back
  await q.remove(ann.entryId)
  await q.join('again-aaaaaaa', 'Ann', 'P1')
  expect((await q.loadState('hacker', 'again-aaaaaaa')).me?.status).toBe('removed')
})

// ---- auto-end ----
const sessionStatus = async () => (await host()).session?.status

test('no organizer page for 5 minutes ends the checkpoint like End does', async () => {
  await fresh('A', 'B')
  const t = Date.now()
  await q.activity(t + 4 * 60_000)
  await q.expire(t + 4 * 60_000)
  expect(await sessionStatus()).toBe('open')
  await q.activity(t + 5 * 60_000)
  await q.expire(t + 5 * 60_000)
  expect(await sessionStatus()).toBe('closed')
  expect(await status('A')).toBe('done')
  expect((await host()).queue).toEqual([])
})

test('10 minutes with no action and nobody live ends the checkpoint; a live slot or any action keeps it open', async () => {
  await fresh('A')
  const t = Date.now()
  await q.adminSeen(t + 9 * 60_000); await q.activity(t + 9 * 60_000) // an action at 9 min resets the clock
  await q.adminSeen(t + 11 * 60_000)
  await q.expire(t + 11 * 60_000)
  expect(await sessionStatus()).toBe('open')

  await fresh('A')
  await q.setLimit(3600)
  await live('aa-A-xxxx')
  await q.adminSeen(t + 11 * 60_000)
  await q.expire(t + 11 * 60_000) // nothing clicked for 11 min, but A is presenting
  expect(await sessionStatus()).toBe('open')

  await fresh('A')
  await q.adminSeen(t + 11 * 60_000)
  await q.expire(t + 11 * 60_000) // A was called but never started
  expect(await sessionStatus()).toBe('closed')
})

test('a closed tab shows as away to admin and host until it comes back', async () => {
  await fresh('A', 'B')
  await q.bye('aa-A-xxxx')
  await q.bye('aa-B-xxxx')
  expect((await host()).current?.away).toBe(true)
  expect((await q.loadState('admin')).queue[0].connected).toBe(false)
  expect(JSON.stringify(await q.loadState('hacker', 'aa-A-xxxx'))).not.toContain('away')
  await q.back('aa-A-xxxx', 'aa-B-xxxx')
  expect((await host()).current?.away).toBe(false)
  expect((await q.loadState('admin')).queue[0].connected).toBe(true)
})

test('auto-end thresholds: just under stays open, just over ends', async () => {
  await fresh('A')
  const t = Date.now()
  await q.activity(t + 5 * 60_000 - 1000)
  await q.expire(t + 5 * 60_000 - 1000) // organizer gone 4:59
  expect(await sessionStatus()).toBe('open')
  await q.expire(t + 5 * 60_000 + 1000) // 5:01
  expect(await sessionStatus()).toBe('closed')

  await fresh('A')
  await q.adminSeen(t + 10 * 60_000 + 1000)
  await q.expire(t + 10 * 60_000 - 1000) // idle 9:59
  expect(await sessionStatus()).toBe('open')
  await q.expire(t + 10 * 60_000 + 1000) // idle 10:01
  expect(await sessionStatus()).toBe('closed')
})

test('with no organizer, the checkpoint ends even mid-presentation or while paused', async () => {
  for (const paused of [false, true]) {
    await fresh('A', 'B')
    await q.setLimit(3600)
    await live('aa-A-xxxx')
    if (paused) await q.pause((await cur())!.entryId)
    const t = Date.now()
    await q.activity(t + 6 * 60_000)
    await q.expire(t + 6 * 60_000)
    expect(await sessionStatus()).toBe('closed')
    expect(await status('A')).toBe('done')
    expect(await cur()).toBeNull() // nobody gets called into a closed checkpoint
  }
})

test('a paused presenter counts as presenting, so an idle organizer does not end the night', async () => {
  await fresh('A')
  await live('aa-A-xxxx')
  await q.pause((await cur())!.entryId)
  const t = Date.now()
  await q.adminSeen(t + 30 * 60_000)
  await q.expire(t + 30 * 60_000)
  expect(await sessionStatus()).toBe('open')
  expect(await cur()).toMatchObject({ name: 'A', status: 'live' })
})

test('heartbeats after a checkpoint ended do not touch it or the next one', async () => {
  await fresh('A')
  const t = Date.now()
  await q.expire(t + 11 * 60_000) // ends
  await q.adminSeen(t + 11 * 60_000); await q.activity(t + 11 * 60_000) // late page, nothing open to update
  expect(await sessionStatus()).toBe('closed')
  await q.startSession(90) // a fresh night starts with fresh clocks
  await q.expire()
  expect(await sessionStatus()).toBe('open')
})

test('a checkpoint opened before auto-end existed never ends by itself', async () => {
  await fresh('A')
  const { db } = await import('./db')
  await db.execute(`UPDATE sessions SET admin_seen_at = NULL, active_at = NULL WHERE status = 'open'`)
  await q.expire(Date.now() + 24 * 60 * 60_000)
  expect(await sessionStatus()).toBe('open')
})

// ---- undo remove ----
test('undoing a Remove puts the person back in the same spot, and they see it', async () => {
  await fresh('A', 'B', 'C', 'D') // A on stage; B, C, D wait
  const c = (await host()).queue.find((e) => e.name === 'C')!.id
  await q.remove(c)
  expect(await names()).toEqual(['B', 'D'])
  expect(await status('C')).toBe('removed')
  await q.join('aa-E-xxxx', 'E', 'P') // the line moves on meanwhile
  await q.unremove(c)
  expect(await names()).toEqual(['B', 'C', 'D', 'E'])
  expect((await q.loadState('hacker', 'aa-C-xxxx')).me).toMatchObject({ status: 'waiting', position: 2 })
})

test('undo only brings back removed people, only in the checkpoint they were removed from', async () => {
  await fresh('A', 'B', 'C')
  await q.leave('aa-B-xxxx') // left on their own: undo must not pull them back
  await q.unremove((await q.snapshot()).rows.find((r) => r.name === 'B')!.id)
  expect(await status('B')).toBe('left')
  const cId = (await host()).queue[0].id
  await q.unremove(cId) // C is waiting, not removed: nothing to undo
  await q.unremove('no-such-id')
  expect(await names()).toEqual(['C'])
  await q.remove(cId)
  await q.endSession(); await q.startSession(90)
  await q.unremove(cId) // that checkpoint is over: C doesn't reappear in the new one
  expect(await names()).toEqual([])
  expect(await cur()).toBeNull()
})

test('if the stage emptied before the undo, the restored person is called', async () => {
  await fresh('A', 'B')
  const b = (await host()).queue[0].id
  await q.remove(b)
  await q.stop((await cur())!.entryId) // A done, nobody left
  expect(await cur()).toBeNull()
  await q.unremove(b)
  expect(await cur()).toMatchObject({ name: 'B', status: 'called' })
  expect(await calledOrLive()).toBe(1)
})
