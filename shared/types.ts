export type EntryStatus = 'waiting' | 'called' | 'live' | 'done' | 'left' | 'removed'
export type ShareState = 'not_shared' | 'sharing' | 'stopped'
export type Role = 'hacker' | 'admin' | 'host'

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
  session: { status: 'open' | 'closed'; limitSec: number } | null
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
