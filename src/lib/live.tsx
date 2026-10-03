import { useCallback, useEffect, useRef, useState } from 'react'
import type { Role, State } from '../../shared/types'

export const tokenKey = 'cp-token'
export const hackerToken = () => {
  try {
    let t = localStorage.getItem(tokenKey)
    if (!t) localStorage.setItem(tokenKey, (t = crypto.randomUUID()))
    return t
  } catch { return (window as any).__cpTok ??= crypto.randomUUID() }
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

export function beep(count = 1) {
  try {
    const ac = new AudioContext()
    for (let i = 0; i < count; i++) {
      const t = ac.currentTime + i * 0.22, o = ac.createOscillator(), g = ac.createGain()
      o.type = 'square'; o.frequency.value = i % 2 ? 1175 : 880
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.2)
    }
  } catch {}
}

export function Badge({ online }: { online: boolean }) {
  return online ? null : <div className="fixed right-2 top-2 z-50 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-black">reconnecting…</div>
}
