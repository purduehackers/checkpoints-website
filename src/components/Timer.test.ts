import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { alarm } from './Timer'

test('alarm: nothing while paused, idle or with time to spare', () => {
  expect(alarm(null, false)).toBe('')
  expect(alarm(5_000, true)).toBe('')
  expect(alarm(60_000, false)).toBe('')
})

test('alarm: solid red from 0:30, a gentle pulse (never a strobe) from 0:10', () => {
  expect(alarm(30_000, false)).toBe('bg-red-600 text-white')
  for (const left of [10_000, 3_000, 0, -2_000]) {
    expect(alarm(left, false)).toContain('alarm-pulse')
    expect(alarm(left, false)).not.toContain('strobe')
  }
})

test('css: no strobe/shake, and the pulse stops under reduced motion', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  expect(css).not.toContain('strobe')
  expect(css).not.toContain('.shake')
  expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.alarm-pulse/)
})
