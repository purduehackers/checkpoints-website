import { expect, test } from 'bun:test'
import { aboutMin, fmt, ordinal, span, waitMs } from './live'
import type { Current, State } from '../../shared/types'

const now = 1_000_000
const state = (current: Partial<Current> | null, limitSec = 120): State => ({
  serverNow: now, queue: [],
  session: { status: 'open', limitSec, quality: '1080p', audio: true, reactions: true },
  current: current && { entryId: 'x', name: 'X', project: 'P', status: 'live', deadline: null, pausedLeft: null, shareState: 'sharing', shareEpoch: 1, ...current },
})

test('wait: every person ahead counts as a full slot', () => {
  expect(waitMs(state(null), 0, now)).toBe(0)
  expect(waitMs(state(null), 3, now)).toBe(3 * 120_000)
})

test('wait: a live presenter counts as their time left, a paused one as their frozen time', () => {
  expect(waitMs(state({ deadline: now + 30_000 }), 2, now)).toBe(30_000 + 240_000)
  expect(waitMs(state({ pausedLeft: 50_000 }), 0, now)).toBe(50_000)
  expect(waitMs(state({ deadline: now - 5_000 }), 0, now)).toBe(0) // overran: never negative
})

test('wait: someone called but not started yet counts as a full slot', () => {
  expect(waitMs(state({ status: 'called' }, 60), 1, now)).toBe(120_000)
})

test('wait text rounds up and never says 0 min', () => {
  expect(aboutMin(0)).toBe('under a minute')
  expect(aboutMin(59_999)).toBe('under a minute')
  expect(aboutMin(60_000)).toBe('about 1 min')
  expect(aboutMin(61_000)).toBe('about 2 min')
})

test('countdown: mm:ss, rounds up so 0:00 means time is up, never negative', () => {
  expect(fmt(120_000)).toBe('02:00')
  expect(fmt(61_000)).toBe('01:01')
  expect(fmt(1)).toBe('00:01')
  expect(fmt(0)).toBe('00:00')
  expect(fmt(-5_000)).toBe('00:00') // overran
  expect(fmt(3_600_000)).toBe('60:00') // the longest limit
})

test('place in line reads as an English ordinal, teens included', () => {
  const got = [1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 101, 111, 112, 200].map(ordinal)
  expect(got).toEqual(['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th', '200th'])
})

test('time limit reads in minutes when whole, else seconds', () => {
  expect([60, 120, 3600, 90, 30, 10].map(span)).toEqual(['1 minute', '2 minutes', '60 minutes', '90 seconds', '30 seconds', '10 seconds'])
})
