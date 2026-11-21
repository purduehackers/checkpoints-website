import type { ShareState } from '../../shared/types'
import { ordinal } from '../lib/live'

// Every waiting participant has already joined, even if their share stopped.
export function waitingCopy({ position, shareState, noShare, what, wait, ahead }: { position: number; shareState: ShareState; noShare: boolean; what: string; wait: string; ahead: string }) {
  const first = position === 1 // "Next in line": the one after whoever is at the podium
  const title = first ? 'You’re next in line!' : `You’re ${ordinal(position)} in line`
  const action = shareState === 'sharing' ? (first ? 'Get ready to head to the podium.' : '') : noShare ? `You can share your ${what} anytime before your turn.`
    : shareState === 'stopped' ? (first ? 'Get ready: share again now.' : 'Share again before your turn.')
    : first ? `Get ready: share your ${what} now if you haven’t.` : `Share your ${what} before your turn.`
  const sub = `Your turn in ${wait}${ahead ? ` ⊹ You’re after ${ahead}` : ''}${action ? `. ${action}` : ''}`
  return { title, sub }
}

// The "present without sharing" choice, per hacker token, so a refresh keeps it. Storage can be blocked: fail quiet.
const key = (token: string) => `checkpoints:noShare:${token}`
export function loadNoShare(token: string) {
  try { return localStorage.getItem(key(token)) === '1' } catch { return false }
}
export function saveNoShare(token: string, on: boolean) {
  try { on ? localStorage.setItem(key(token), '1') : localStorage.removeItem(key(token)) } catch {}
}
