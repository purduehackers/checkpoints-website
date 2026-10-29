import { useCallback, useEffect, useRef, useState } from 'react'
import type { Role, State } from '../../shared/types'

export const tokenKey = 'cp-token'
// randomUUID needs Safari 15.4+ and a secure context; getRandomValues works everywhere.
const uuid = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
export const hackerToken = () => {
  try {
    let t = localStorage.getItem(tokenKey)
    if (!t) localStorage.setItem(tokenKey, (t = uuid()))
    return t
  } catch { return (window as any).__cpTok ??= uuid() }
}

// The organizer signed in with Purdue Hackers ID. The session is an HttpOnly cookie, so the page asks the server.
export type User = { sub: string; name: string; organizer: boolean }
export function useUser() {
  const [user, setUser] = useState<User | null | undefined>(undefined) // undefined while loading
  useEffect(() => { fetch('/api/me').then((r) => r.json()).then((j) => setUser(j.user ?? null), () => setUser(null)) }, [])
  return user
}
export const signInUrl = (next = location.pathname) => `/api/auth/login?next=${encodeURIComponent(next)}`
export const signOutUrl = (next = location.pathname) => `/api/auth/logout?next=${encodeURIComponent(next)}`

export async function api<T = State>(path: string, body?: object): Promise<T> {
  const r = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? 'Request failed')
  return j
}

// Live state over one WebSocket. Reconnects forever: Vercel closes sockets at the function's max duration.
export function useLive(role: Role, onReactions?: (counts: Record<string, number>) => void) {
  const [state, setState] = useState<State | null>(null)
  const [online, setOnline] = useState(false)
  const [denied, setDenied] = useState(false) // admin socket refused (session expired or not an organizer)
  const skew = useRef(0)
  const sock = useRef<WebSocket>(null)
  const [notice, setNotice] = useState<{ text: string; until: number; slowUntil: number } | null>(null) // from the reaction spam guard
  const onR = useRef(onReactions)
  onR.current = onReactions
  const apply = useCallback((s: State) => { skew.current = Date.now() - s.serverNow; setState(s) }, [])
  const now = useCallback(() => Date.now() - skew.current, [])

  useEffect(() => {
    let ws: WebSocket, delay = 500, dead = false, retry: ReturnType<typeof setTimeout>
    const open = () => {
      ws = sock.current = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`)
      ws.onopen = () => {
        delay = 500
        ws.send(JSON.stringify({ role, token: role === 'hacker' ? hackerToken() : undefined }))
      }
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.serverNow) { setOnline(true); apply(m) }
        if (m.reactions) onR.current?.(m.reactions)
        if (m.notice) setNotice({ text: m.notice, until: Date.now() + 5000, slowUntil: Date.now() + (m.slowMs ?? 0) })
        if (m.error === 'Not authorized') { dead = true; setDenied(true); ws.close() }
      }
      ws.onclose = () => { setOnline(false); if (!dead) retry = setTimeout(open, delay), (delay = Math.min(delay * 2, 10000)) }
    }
    open()
    return () => { dead = true; clearTimeout(retry); ws.close() }
  }, [role, apply])

  const react = useCallback((emoji: string) => { if (sock.current?.readyState === WebSocket.OPEN) sock.current.send(JSON.stringify({ react: emoji })) }, [])
  return { state, online, denied, apply, now, react, notice }
}

// Ticking clock for countdowns.
export function useTick(ms = 250) {
  const [, set] = useState(0)
  useEffect(() => { const i = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(i) }, [ms])
}

export const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// Rough wait until `ahead` more people finish: each counts as the full limit, the current slot as what it has left.
export function waitMs(s: State, ahead: number, now: number) {
  const limit = (s.session?.limitSec ?? 0) * 1000, c = s.current
  const cur = !c ? 0 : c.status === 'live' ? Math.max(0, c.pausedLeft ?? (c.deadline ?? now) - now) : limit
  return cur + ahead * limit
}
export const aboutMin = (ms: number) => ms < 60_000 ? 'under a minute' : `about ${Math.ceil(ms / 60_000)} min`
export const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`
export const span = (sec: number) => sec % 60 ? `${sec} seconds` : `${sec / 60} minute${sec === 60 ? '' : 's'}`

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />
}

export function Badge({ online }: { online: boolean }) {
  return online ? null : <div className="fixed right-2 top-2 z-50 flex items-center gap-2 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-black"><Spinner className="size-3" />reconnecting…</div>
}
