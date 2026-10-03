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

test('call-next -> ready -> live sets a deadline; host sees stream only when live', async () => {
  await q.callNext()
  let host = await q.loadState('host')
  expect(host.current).toMatchObject({ name: 'Bob', status: 'called' })
  expect(host.current?.streamId).toBeUndefined()
  await q.hackerReady('tok-bbbbbbbb')
  host = await q.loadState('host')
  expect(host.current?.status).toBe('live')
  expect(host.current?.deadline).toBe(host.current!.startedAt! + 120_000)
  expect(host.current?.streamId).toBeString()
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
  await q.callNext()
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
