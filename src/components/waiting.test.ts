import { expect, test } from 'bun:test'
import { loadNoShare, saveNoShare, waitingCopy } from './waiting'

const base = { position: 3, sharing: false, noShare: false, what: 'screen', wait: 'about 6 min', ahead: 'Ada' }

test('not sharing, not chosen: asks to share, offers presenting without sharing', () => {
  expect(waitingCopy(base)).toEqual({ title: 'Share your screen', sub: 'Share now, or present without sharing' })
})

test('sharing or chose no-share: normal queue status', () => {
  const inLine = { title: 'You’re 3rd in line', sub: 'Up in about 6 min ⊹ You’re after Ada' }
  expect(waitingCopy({ ...base, sharing: true })).toEqual(inLine)
  expect(waitingCopy({ ...base, noShare: true })).toEqual(inLine)
  expect(waitingCopy({ ...base, noShare: true, ahead: '' }).sub).toBe('Up in about 6 min')
})

test('first in line: up next with the wait, either way', () => {
  expect(waitingCopy({ ...base, position: 1 })).toEqual({ title: 'You’re up next!', sub: 'Up in about 6 min ⊹ You’re after Ada' })
})

test('noShare choice persists per token and never throws', () => {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) }
  expect(loadNoShare('a')).toBe(false)
  saveNoShare('a', true)
  expect(loadNoShare('a')).toBe(true)
  expect(loadNoShare('b')).toBe(false)
  saveNoShare('a', false)
  expect(loadNoShare('a')).toBe(false)
  ;(globalThis as any).localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  expect(loadNoShare('a')).toBe(false)
  expect(() => saveNoShare('a', true)).not.toThrow()
  delete (globalThis as any).localStorage
})
