export type EntryStatus = 'waiting' | 'called' | 'live' | 'done' | 'left' | 'removed'
export type ShareState = 'not_shared' | 'sharing' | 'stopped'
export type Role = 'hacker' | 'admin' | 'host'

// Stream quality the organizer picks; the presenter's browser applies it (capture cap + encoder bitrate).
export const QUALITY = {
  '720p': { width: 1280, height: 720, kbps: 2500 },
  '1080p': { width: 1920, height: 1080, kbps: 4000 },
  '1440p': { width: 2560, height: 1440, kbps: 6000 },
  source: { width: 0, height: 0, kbps: 8000 }, // 0 = no cap
} as const
export type Quality = keyof typeof QUALITY

export interface QueueItem {
  id: string
  name: string
  project: string
  shareState: ShareState
  connected: boolean
  joinedAt: number
  streamId?: string // admin only
}

export interface Current {
  entryId: string
  name: string
  project: string
  status: 'called' | 'live'
  startedAt: number | null
  deadline: number | null
  shareState: ShareState
  streamId?: string // admin always; host only while live
}

export interface State {
  serverNow: number
  session: { status: 'open' | 'closed'; limitSec: number; quality: Quality; audio: boolean } | null
  current: Current | null
  queue: QueueItem[]
  me?: {
    entryId: string
    name: string
    project: string
    status: EntryStatus
    position: number // 1-based among waiting; 0 if not waiting
    streamId: string
  }
}
