import { expect, mock, test } from 'bun:test'
import { loadNoShare, saveNoShare, waitingCopy } from './waiting'

const base = { position: 3, shareState: 'not_shared' as const, noShare: false, what: 'screen', wait: 'about 6 min', ahead: 'Ada' }
const status = 'Up in about 6 min ⊹ You’re after Ada'

test('joined without a current share keeps their place and gets an instruction', () => {
  expect(waitingCopy(base)).toEqual({ title: 'You’re 3rd in line', sub: `${status}. Share your screen before your turn.` })
  expect(waitingCopy({ ...base, what: 'camera' }).sub).toBe(`${status}. Share your camera before your turn.`)
  expect(waitingCopy({ ...base, shareState: 'stopped' }).sub).toBe(`${status}. Share again before your turn.`)
})

test('sharing gives queue status; no-share adds an optional sharing reminder', () => {
  expect(waitingCopy({ ...base, shareState: 'sharing' })).toEqual({ title: 'You’re 3rd in line', sub: status })
  expect(waitingCopy({ ...base, noShare: true }).sub).toBe(`${status}. You can share your screen anytime before your turn.`)
  expect(waitingCopy({ ...base, noShare: true, what: 'camera', ahead: '' }).sub).toBe('Up in about 6 min. You can share your camera anytime before your turn.')
})

test('up next still includes the action needed before their turn', () => {
  for (const shareState of ['not_shared', 'stopped', 'sharing'] as const) {
    expect(waitingCopy({ ...base, position: 1, shareState })).toEqual({ ...waitingCopy({ ...base, shareState }), title: 'You’re up next!' })
  }
  expect(waitingCopy({ ...base, position: 1, noShare: true }).sub).toBe(`${status}. You can share your screen anytime before your turn.`)
})

test('noShare choice persists per token and never throws', () => {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
  expect(loadNoShare('a')).toBe(false)
  saveNoShare('a', true)
  expect(loadNoShare('a')).toBe(true)
  expect(loadNoShare('b')).toBe(false)
  saveNoShare('a', false)
  expect(loadNoShare('a')).toBe(false)
  ;(globalThis as any).localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  expect(loadNoShare('a')).toBe(false)
  expect(() => saveNoShare('a', true)).not.toThrow()
  delete (globalThis as any).localStorage
})

test('ShareBox captures before joining, and cancellation or join failure never reports stopped', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  mock.module('@vdoninja/sdk', () => ({ default: class { constructor() { throw new Error('Must not publish before joining') } } }))
  const { ShareBox } = await import('../lib/vdo')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const calls: string[] = []
  const track = { readyState: 'live', stop: () => calls.push('stop') }
  const shareRef = { current: null as (() => Promise<void>) | null }
  let cancelled = true
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getDisplayMedia: async () => {
      calls.push('capture')
      if (cancelled) throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' })
      return { getVideoTracks: () => [track], getTracks: () => [track] }
    },
  } } })
  try {
    renderToStaticMarkup(createElement(ShareBox, {
      streamId: async () => { calls.push('join'); throw new Error('Queue closed') },
      label: 'Ada', live: false, quality: '1080p', stats: false, hidden: true,
      onCloseStats: () => {}, onState: (state) => calls.push(state), shareRef,
    }))
    await shareRef.current!()
    expect(calls).toEqual(['capture'])
    calls.length = 0
    cancelled = false
    await shareRef.current!()
    expect(calls).toEqual(['capture', 'join', 'stop', 'not_shared'])
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
