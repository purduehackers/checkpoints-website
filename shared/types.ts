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
  streamId?: string // admin always; host only while live
}

export interface State {
  serverNow: number
  session: { status: 'open' | 'closed'; limitSec: number; quality: Quality; audio: boolean; reactions: boolean } | null
  current: Current | null
  queue: QueueItem[]
  me?: {
    entryId: string
    name: string
    project: string
    status: EntryStatus
    position: number // 1-based among waiting; 0 if not waiting
    streamId: string
    quizPassed: boolean // this device has passed the first-time quiz
  }
}
