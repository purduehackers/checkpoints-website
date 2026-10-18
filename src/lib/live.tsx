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
export const adminKey = 'cp-admin'
export const adminToken = () => { try { return localStorage.getItem(adminKey) ?? '' } catch { return '' } }

export async function api(path: string, body?: object, admin = false): Promise<State> {
  const r = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(admin && { 'x-admin-token': adminToken() }) },
    body: JSON.stringify(body ?? {}),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? 'Request failed')
  return j
}

// Live state over one WebSocket. Reconnects forever: Vercel closes sockets at the function's max duration.
export function useLive(role: Role) {
  const [state, setState] = useState<State | null>(null)
  const [online, setOnline] = useState(false)
  const [denied, setDenied] = useState(false) // admin token refused (passcode changed or bad token)
  const skew = useRef(0)
  const apply = useCallback((s: State) => { skew.current = Date.now() - s.serverNow; setState(s) }, [])
  const now = useCallback(() => Date.now() - skew.current, [])

  useEffect(() => {
    let ws: WebSocket, delay = 500, dead = false, retry: ReturnType<typeof setTimeout>
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`)
      ws.onopen = () => {
        delay = 500
        ws.send(JSON.stringify({ role, token: role === 'hacker' ? hackerToken() : undefined, adminToken: role === 'admin' ? adminToken() : undefined }))
      }
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.serverNow) { setOnline(true); apply(m) }
        if (m.error === 'Not authorized') { dead = true; setDenied(true); ws.close() }
      }
      ws.onclose = () => { setOnline(false); if (!dead) retry = setTimeout(open, delay), (delay = Math.min(delay * 2, 10000)) }
    }
    open()
    return () => { dead = true; clearTimeout(retry); ws.close() }
  }, [role, apply])

  return { state, online, denied, apply, now }
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

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />
}

export function Badge({ online }: { online: boolean }) {
  return online ? null : <div className="fixed right-2 top-2 z-50 flex items-center gap-2 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-black"><Spinner className="size-3" />reconnecting…</div>
}
