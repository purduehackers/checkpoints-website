export type EntryStatus = 'waiting' | 'called' | 'live' | 'done' | 'left' | 'removed'
export type ShareState = 'not_shared' | 'sharing' | 'stopped'
export type Role = 'hacker' | 'admin' | 'host'
export const REACTIONS = ['❤️', '👍', '😭', '🐴', '🤑'] as const

// Stream quality the organizer picks; the presenter's browser applies it as the encoder bitrate.
export const QUALITY = {
  '720p': { kbps: 2500 },
  '1080p': { kbps: 4000 },
  '1440p': { kbps: 6000 },
  source: { kbps: 8000 },
} as const
export type Quality = keyof typeof QUALITY

export interface QueueItem {
  id: string
  name: string
  project: string
  shareState: ShareState
  shareEpoch: number // bumps on every publish: key the viewer by it
  connected: boolean
  streamId?: string // admin only
}

export interface Current {
  entryId: string
  name: string
  project: string
  status: 'called' | 'live'
  deadline: number | null
  pausedLeft: number | null
  away?: boolean // admin/host: tab closed, about to be dropped unless they come back
  shareState: ShareState
  shareEpoch: number // bumps on every publish: key the viewer by it
  streamId?: string // admin always; host only while live
}

export interface State {
  serverNow: number
  title?: string // admin only: the night's name shown on /admin
  session: { status: 'open' | 'closed'; limitSec: number; quality: Quality; audio: boolean; reactions: boolean } | null
  current: Current | null
  previous: { entryId: string; name: string; project: string; streamId?: string } | null
  queue: QueueItem[]
  me?: {
    entryId: string
    name: string
    project: string
    status: EntryStatus
    position: number // 1-based among waiting; 0 if not waiting
    streamId: string
    signedIn: boolean // joined with a Purdue Hackers ID (the participant's own state only)
  }
}

// Organizer-only timing for one checkpoint (GET /api/admin/metrics). Durations in ms. Never part of State.
export interface Metrics {
  now: number
  sessionStatus: 'open' | 'closed'
  startedAt: number
  endedAt: number | null // null while open
  totalMs: number // wall clock, start to end (or to now while open)
  presentingMs: number // sum of every presentation's live time
  switchingMs: number // sum of the gaps between consecutive presentations
  otherMs: number // the rest of totalMs: before the first presenter, after the last
  presentingShare: number | null // presentingMs / (presentingMs + switchingMs), 0..1; null with no presenters
  presenters: number
  avgPresentingMs: number | null
  avgSwitchMs: number | null
  medianSwitchMs: number | null
  entries: { id: string; name: string; project: string; liveAt: number; endedAt: number | null; presentingMs: number; switchMs: number | null }[]
}
