import { expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as live from '../lib/live'
import type { State } from '../../shared/types'

const state: State = { serverNow: 0, session: null, current: null, previous: null, queue: [] }
mock.module('../lib/live', () => ({
  ...live,
  useUser: () => ({ user: { name: 'Organizer', organizer: true }, authMode: 'password' }),
  useLive: () => ({ state, online: true, now: () => 0 }),
}))
mock.module('./DitheredSoup', () => ({ DitheredSoup: () => null }))
mock.module('../lib/vdo', () => ({ ViewFrame: () => null, ShareBox: () => null }))
mock.module('../lib/stats', () => ({ StatsButton: () => null, StatsOverlay: () => null, useRemoteStats: () => [], useStatsToggle: () => ({ on: false }) }))
const { default: Admin } = await import('./Admin')

test('admin explains the empty presenter card without showing presenter controls', () => {
  const html = renderToStaticMarkup(createElement(Admin))
  expect(html).toContain('Nobody up yet')
  expect(html).toContain('Start a checkpoint to open the queue.')
  expect(html).not.toContain('>Stop</button>')
  state.session = { status: 'open', limitSec: 120, quality: '1080p', audio: true, reactions: true }
  expect(renderToStaticMarkup(createElement(Admin))).toContain('The next person in the queue will be called automatically.')
})

test('admin replaces the empty state with the current presenter', () => {
  state.current = { entryId: 'a', name: 'Alex', project: 'LED Matrix', status: 'called', deadline: null, pausedLeft: null, shareState: 'not_shared', shareEpoch: 0 }
  const html = renderToStaticMarkup(createElement(Admin))
  expect(html).toContain('Alex')
  expect(html).toContain('>Start</button>')
  expect(html).not.toContain('Nobody up yet')
  state.current = null
})
