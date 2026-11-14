import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { screenColor } from './Timer'

test('screenColor: black while paused, idle or with time to spare', () => {
  for (const [left, paused] of [[null, false], [5_000, true], [-1_000, true], [60_000, false], [30_001, false]] as const)
    expect(screenColor(left, paused)).toBe('bg-background')
})

test('screenColor: solid red background from 0:30, flashing from 0:10, steady red at time up', () => {
  expect(screenColor(30_000, false)).toBe('bg-[red] text-white')
  expect(screenColor(10_001, false)).toBe('bg-[red] text-white')
  expect(screenColor(10_000, false)).toBe('bg-[red] text-white alarm-flash')
  expect(screenColor(1, false)).toContain('alarm-flash')
  expect(screenColor(0, false)).toBe('bg-[red] text-white')
  expect(screenColor(-2_000, false)).toBe('bg-[red] text-white')
})

test('css: the flash is a hard red/black flip every 0.7s', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  expect(css).toMatch(/\.alarm-flash\s*\{\s*animation:\s*alarm-flash 0\.7s steps\(1\) infinite/)
  expect(css).toMatch(/@keyframes alarm-flash\s*\{[^}]*background-color:\s*red/)
})
