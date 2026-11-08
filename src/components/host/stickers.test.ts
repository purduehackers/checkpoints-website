import { expect, test } from 'bun:test'
import { COLORS, DOODLES, moreLine, stickers } from './stickers'

const ids = Array.from({ length: 40 }, (_, i) => `entry-${i}`)

test('stickers: one per id, from the palette', () => {
  const s = stickers(ids.slice(0, 4))
  expect(s).toHaveLength(4)
  for (const k of s) {
    expect(COLORS).toContain(k.color)
    expect(k.doodle).toBeGreaterThanOrEqual(0)
    expect(k.doodle).toBeLessThan(DOODLES.length)
  }
})

test('stickers: follow the person, not the slot', () => {
  // Run a long queue window by window: whoever is first in a window keeps the look they had when they were first before.
  const first = stickers([ids[5]])[0]
  expect(stickers([ids[5], ids[6]])[0]).toEqual(first)
  expect(stickers([ids[5]])[0]).toEqual(first)
})

test('stickers: no two adjacent cards share a color or a doodle', () => {
  for (let i = 0; i + 4 <= ids.length; i++) {
    const s = stickers(ids.slice(i, i + 4))
    for (let j = 1; j < s.length; j++) {
      expect(s[j].color).not.toBe(s[j - 1].color)
      expect(s[j].doodle).not.toBe(s[j - 1].doodle)
    }
  }
})

test('stickers: deterministic', () => {
  expect(stickers(ids.slice(0, 4))).toEqual(stickers(ids.slice(0, 4)))
})

test('moreLine: lists the next few names past the shown cards', () => {
  expect(moreLine([])).toBe('')
  expect(moreLine(['Eve', 'Finn', 'Gus'])).toBe('+3 more: Eve, Finn, Gus')
  expect(moreLine(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('+6 more: A, B, C, D, E…')
})
