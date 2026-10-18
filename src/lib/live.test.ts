import { expect, test } from 'bun:test'
import { aboutMin, waitMs } from './live'
import type { Current, State } from '../../shared/types'

const now = 1_000_000
const state = (current: Partial<Current> | null, limitSec = 120): State => ({
  serverNow: now, queue: [],
  session: { status: 'open', limitSec, quality: '1080p', audio: true, reactions: true },
  current: current && { entryId: 'x', name: 'X', project: 'P', status: 'live', startedAt: null, deadline: null, pausedLeft: null, shareState: 'sharing', ...current },
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
