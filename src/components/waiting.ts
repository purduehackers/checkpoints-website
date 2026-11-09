import { ordinal } from '../lib/live'

// Heading + sub for a waiting participant. Sharing or choosing to present without sharing both put you in line.
export function waitingCopy({ position, sharing, noShare, what, wait, ahead }: { position: number; sharing: boolean; noShare: boolean; what: string; wait: string; ahead: string }) {
  const inLine = sharing || noShare
  const title = position === 1 ? 'You’re up next!' : inLine ? `You’re ${ordinal(position)} in line` : 'You’re not in line yet'
  const sub = inLine || position === 1 ? `Up in ${wait}${ahead ? ` ⊹ You’re after ${ahead}` : ''}` : `Share your ${what} to join the queue`
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
