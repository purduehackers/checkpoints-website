import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { frameBorder } from './Timer'

const HAIRLINE = 'border border-border'

test('frameBorder: hairline while paused, idle or with time to spare', () => {
  expect(frameBorder(null, false)).toBe(HAIRLINE)
  expect(frameBorder(5_000, true)).toBe(HAIRLINE)
  expect(frameBorder(-1_000, true)).toBe(HAIRLINE)
  expect(frameBorder(60_000, false)).toBe(HAIRLINE)
})

test('frameBorder: only the border turns red, never the background', () => {
  for (const left of [30_000, 10_000, 3_000, 0, -2_000]) {
    expect(frameBorder(left, false)).toContain('border-[red]')
    expect(frameBorder(left, false)).not.toMatch(/\bbg-|text-/)
  }
})

test('frameBorder: thicker red from 0:30, gentle pulse from 0:10, thick steady red when expired', () => {
  expect(frameBorder(30_000, false)).toBe('border-[1.5vw] border-[red]')
  expect(frameBorder(10_000, false)).toBe('border-[1.5vw] border-[red] alarm-pulse')
  expect(frameBorder(1, false)).toContain('alarm-pulse')
  expect(frameBorder(0, false)).toBe('border-[4.6875vw] border-[red]')
  expect(frameBorder(-2_000, false)).toBe('border-[4.6875vw] border-[red]')
})

test('css: pulse is a slow border breathe (no background), no strobe, off under reduced motion', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  expect(css).not.toContain('strobe')
  expect(css).not.toContain('.shake')
  expect(css).toMatch(/@keyframes alarm-pulse\s*\{[^}]*\{[^}]*opacity/)
  expect(css).not.toMatch(/@keyframes alarm-pulse\s*\{[^}]*background/)
  expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.alarm-pulse/)
})
