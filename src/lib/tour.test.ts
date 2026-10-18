import { expect, test } from 'bun:test'
import { place, seenStore } from './tour'

const vw = 1000, vh = 800, h = 100
const rect = (top: number, left: number, height = 40, width = 200) => ({ top, left, width, height })
const onScreen = (p: { top: number; left: number; width: number }) => {
  expect(p.top).toBeGreaterThanOrEqual(0)
  expect(p.top + h).toBeLessThanOrEqual(vh)
  expect(p.left).toBeGreaterThanOrEqual(0)
  expect(p.left + p.width).toBeLessThanOrEqual(vw)
}

test('the bubble sits under the target when there is room', () => {
  const t = rect(100, 50), p = place(t, h, vw, vh)
  expect(p.top).toBeGreaterThan(t.top + t.height) // below, not covering it
  expect(p.left).toBe(50)
})

test('near the bottom of the screen the bubble goes above the target', () => {
  const t = rect(700, 50), p = place(t, h, vw, vh)
  expect(p.top + h).toBeLessThan(t.top) // above, not covering it
  onScreen(p)
})

test('the bubble never runs off the left or right edge', () => {
  onScreen(place(rect(100, 950), h, vw, vh))
  onScreen(place(rect(100, -30), h, vw, vh))
  const narrow = place(rect(100, 0), h, 300, vh) // a small window still fits the bubble
  expect(narrow.left + narrow.width).toBeLessThanOrEqual(300)
})

test('a target taller than the screen still gets a visible bubble', () => {
  onScreen(place(rect(-200, 0, 2000, 1000), h, vw, vh))
})

const memoryStorage = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

test('a part shown once is not shown again, even after a reload; other parts still are', () => {
  const storage = memoryStorage()
  const a = seenStore(storage)
  expect(a.has('join')).toBe(false)
  a.add('join')
  expect(a.has('join')).toBe(true)
  expect(a.has('wait')).toBe(false)
  expect(seenStore(storage).has('join')).toBe(true) // a new page load reads the same storage
})

test('"How it works" replays every part', () => {
  const s = seenStore(memoryStorage())
  s.add('join'); s.add('wait')
  s.clear()
  expect(s.has('join') || s.has('wait')).toBe(false)
})

test('blocked or missing storage: no errors, and it is remembered for this page load', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
  for (const storage of [broken, null]) {
    const s = seenStore(storage)
    expect(s.has('join')).toBe(false)
    s.add('join')
    expect(s.has('join')).toBe(true)
    s.clear()
    expect(s.has('join')).toBe(false)
  }
})

test('corrupt saved data is treated as nothing seen yet', () => {
  const storage = memoryStorage()
  storage.setItem('cp-tour', '{not json')
  expect(seenStore(storage).has('join')).toBe(false)
})
