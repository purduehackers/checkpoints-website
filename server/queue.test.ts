import { beforeAll, expect, test } from 'bun:test'

process.env.TURSO_DATABASE_URL = ':memory:'
const q = await import('./queue')

beforeAll(() => q.startSession(120))

const pos = async (t: string) => (await q.loadState('hacker', t)).me?.position

test('join is idempotent per token and ordered', async () => {
  await q.join('tok-aaaaaaaa', 'Ada', 'Engine')
  await q.join('tok-bbbbbbbb', 'Bob', 'Loom')
  await q.join('tok-cccccccc', 'Cy', 'Kite')
  await q.join('tok-aaaaaaaa', 'Ada', 'Engine')
  expect((await q.loadState('host')).queue.map((e) => e.name)).toEqual(['Ada', 'Bob', 'Cy'])
  expect(await pos('tok-cccccccc')).toBe(3)
})

test('stream ids only reach admin and (own entry) hacker', async () => {
  expect((await q.loadState('host')).queue[0].streamId).toBeUndefined()
  expect((await q.loadState('admin')).queue[0].streamId).toBeString()
  expect((await q.loadState('hacker', 'tok-aaaaaaaa')).me?.streamId).toBeString()
})

test('skip moves behind the next person', async () => {
  await q.skip((await q.loadState('host')).queue[0].id)
  expect((await q.loadState('host')).queue.map((e) => e.name)).toEqual(['Bob', 'Ada', 'Cy'])
})

test('call-next -> ready -> live sets a deadline; only the projector host sees the stream, only when live', async () => {
  await q.callNext(null)
  let host = await q.loadState('host', undefined, true)
  expect(host.current).toMatchObject({ name: 'Bob', status: 'called' })
  expect(host.current?.streamId).toBeUndefined()
  await q.hackerReady('tok-bbbbbbbb')
  host = await q.loadState('host', undefined, true)
  expect(host.current?.status).toBe('live')
  expect(host.current?.deadline).toBe(host.current!.startedAt! + 120_000)
  expect(host.current?.streamId).toBeString()
  expect((await q.loadState('host')).current?.streamId).toBeUndefined() // a presenter's own /host tab
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
  expect((await q.loadState('host')).current).toBeNull()
  expect((await q.loadState('hacker', 'tok-bbbbbbbb')).me?.status).toBe('done')
})

test('call-next replaces the current presenter; remove drops a waiting entry', async () => {
  await q.callNext(null)
  await q.callNext(null) // a stale double-click: stage already changed, so nothing happens
  expect((await q.loadState('host')).current?.name).toBe('Ada')
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
  await q.callNext(null)
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
  expect((await host()).current).toBeNull()
  expect((await q.loadState('hacker', 'tok-ffffffff')).me?.status).toBe('done')
})

test('time limit is validated and applies to the next slot', async () => {
  expect(q.setLimit(5)).rejects.toThrow('limit')
  expect(q.setLimit(99999)).rejects.toThrow('limit')
  await q.setLimit(60)
  await q.callNext(null)
  await q.adminReady((await host()).current!.entryId)
  const c = (await host()).current!
  expect(c.deadline! - c.startedAt!).toBe(60_000)
})

test('stop ends the current presenter; remove works on the current one too', async () => {
  await q.stop()
  expect((await host()).current).toBeNull()
  await q.join('tok-hhhhhhhh', 'Hal', 'C')
  await q.callNext(null)
  await q.remove((await host()).current!.entryId)
  expect((await host()).current).toBeNull()
  expect((await q.loadState('hacker', 'tok-hhhhhhhh')).me?.status).toBe('removed')
})

test('an entry unseen for 3+ minutes shows as disconnected until it is touched', async () => {
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
  await q.stop(); await q.leave('tok-iiiiiiii')
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
  for (let i = 0; i < 200; i++) await q.join(`flood-${String(i).padStart(4, '0')}`, 'bot', 'spam')
  await expect(q.join('tok-oooooooo', 'Real', 'Person')).rejects.toThrow('full')
  expect((await host()).queue).toHaveLength(200)
})
