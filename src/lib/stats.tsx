// "Stats for nerds". The presenter's browser measures its own send stats (it owns the encoder) and
// pipes a sample over the VDO.Ninja data channel each second; /host and /admin listen with a data-only
// viewer, which costs the presenter no extra encode.
import { useEffect, useState } from 'react'
import VDONinjaSDK from '@vdoninja/sdk'

export type Sample = {
  fps: number; w: number; h: number; vKbps: number; aKbps: number
  rtt: number | null; loss: number | null; limit: string; codec: string; path: string; viewers: number
}
const HISTORY = 60

// Returns a function that reads one Sample from a publishing SDK: the worst (lowest fps) viewer.
export function statsCollector(sdk: VDONinjaSDK) {
  const prev = new Map<string, { t: number; v: number; a: number }>()
  return async (): Promise<Sample | null> => {
    const all = (await sdk.getStats()) as Record<string, any[]>
    const now = performance.now()
    let worst: Sample | null = null, viewers = 0
    for (const [uuid, list] of Object.entries(all)) {
      const r = list.filter((e) => e.connectionType === 'publisher')
      const v = r.find((e) => e.type === 'outbound-rtp' && e.kind === 'video')
      // Data-only viewers (stats listeners) still get an idle video sender: count only peers we send video to.
      if (!v?.bytesSent || v.active === false) { prev.delete(uuid); continue }
      viewers++
      const byId = new Map(r.map((e) => [e.id, e]))
      const a = r.find((e) => e.type === 'outbound-rtp' && e.kind === 'audio')
      const ri = r.find((e) => e.type === 'remote-inbound-rtp' && e.kind === 'video')
      const pair = byId.get(r.find((e) => e.type === 'transport')?.selectedCandidatePairId)
        ?? r.find((e) => e.type === 'candidate-pair' && e.nominated && e.state === 'succeeded')
      const p = prev.get(uuid), dt = p ? (now - p.t) / 1000 : 0
      const kbps = (bytes: number, before: number) => (dt ? Math.max(0, ((bytes - before) * 8) / 1000 / dt) : 0)
      const s: Sample = {
        fps: v.framesPerSecond ?? 0, w: v.frameWidth ?? 0, h: v.frameHeight ?? 0,
        vKbps: p ? kbps(v.bytesSent, p.v) : 0, aKbps: p && a ? kbps(a.bytesSent, p.a) : 0,
        rtt: pair?.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null,
        loss: ri?.fractionLost != null ? ri.fractionLost * 100 : null,
        limit: v.qualityLimitationReason ?? '?',
        codec: String(byId.get(v.codecId)?.mimeType ?? '?').replace(/^video\//, ''),
        path: pair ? `${byId.get(pair.localCandidateId)?.candidateType ?? '?'} → ${byId.get(pair.remoteCandidateId)?.candidateType ?? '?'}` : '?',
        viewers: 0,
      }
      prev.set(uuid, { t: now, v: v.bytesSent, a: a?.bytesSent ?? 0 })
      if (!worst || s.fps < worst.fps) worst = s
    }
    if (worst) worst.viewers = viewers
    return worst
  }
}

export const pushSample = (h: Sample[], s: Sample | null) => (s ? [...h, s].slice(-HISTORY) : h)

// Listen to a presenter's stats from /host or /admin.
export function useRemoteStats(streamId: string | null, enabled: boolean) {
  const [history, setHistory] = useState<Sample[]>([])
  useEffect(() => {
    setHistory([])
    if (!streamId || !enabled) return
    const sdk = new VDONinjaSDK({ salt: 'vdo.ninja' })
    sdk.addEventListener('dataReceived', (e: any) => {
      const s = e.detail?.data?.cpStats
      if (s) setHistory((h) => pushSample(h, s))
    })
    sdk.connect().then(() => sdk.view(streamId, { dataOnly: true, downloads: false })).catch(() => {})
    return () => { sdk.disconnect().catch(() => {}) }
  }, [streamId, enabled])
  return history
}

// Toggle state, persisted per browser, plus the right-click menu that flips it.
export function useStatsToggle() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem('cp-stats') === '1' } catch { return false } })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const toggle = () => setOn((v) => { try { localStorage.setItem('cp-stats', v ? '0' : '1') } catch {} return !v })
  useEffect(() => {
    const open = (e: MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }
    const close = () => setMenu(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('contextmenu', open)
    window.addEventListener('click', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('contextmenu', open); window.removeEventListener('click', close); window.removeEventListener('keydown', esc) }
  }, [])
  const menuEl = menu && (
    <div style={{ left: menu.x, top: menu.y }} className="fixed z-[60] rounded border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-lg">
      <button className="block w-full px-3 py-1 text-left hover:bg-neutral-800" onClick={toggle}>{on ? 'Hide' : 'Show'} stats for nerds</button>
    </div>
  )
  return { on, toggle, menu: menuEl }
}

export function StatsButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return <button className={`z-40 rounded bg-neutral-800/80 px-2 py-1 text-xs text-neutral-300 hover:text-white ${className}`} onClick={onClick}>Stats for nerds</button>
}

function Spark({ label, values, unit, max }: { label: string; values: (number | null)[]; unit: string; max?: number }) {
  const nums = values.map((v) => v ?? 0)
  const top = Math.max(max ?? 0, ...nums, 1)
  const pts = nums.map((v, i) => `${(i / (HISTORY - 1)) * 120},${28 - (v / top) * 26}`).join(' ')
  const last = values[values.length - 1]
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-neutral-400">{label}</span>
      <svg viewBox="0 0 120 28" className="h-7 w-32 rounded bg-white/5"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-400" /></svg>
      <span className="w-20 text-right tabular-nums">{last == null ? '–' : `${Math.round(last)} ${unit}`}</span>
    </div>
  )
}

export function StatsOverlay({ history, title, onClose }: { history: Sample[]; title: string; onClose: () => void }) {
  const s = history[history.length - 1]
  return (
    <div className="fixed bottom-12 left-3 z-50 space-y-1 rounded-lg bg-black/80 p-3 font-mono text-xs text-neutral-100 backdrop-blur">
      <div className="flex items-center justify-between gap-4"><b>{title}</b><button className="text-neutral-400 hover:text-white" onClick={onClose} aria-label="Close stats">✕</button></div>
      {!s ? <p className="text-neutral-400">No stream stats yet.</p> : (
        <>
          <Spark label="fps" values={history.map((h) => h.fps)} unit="" max={30} />
          <Spark label="video" values={history.map((h) => h.vKbps)} unit="kbps" />
          <Spark label="audio" values={history.map((h) => h.aKbps)} unit="kbps" />
          <Spark label="rtt" values={history.map((h) => h.rtt)} unit="ms" />
          <Spark label="loss" values={history.map((h) => h.loss)} unit="%" max={5} />
          <div className="grid grid-cols-[auto_1fr] gap-x-3 pt-1 text-neutral-300">
            <span className="text-neutral-400">res</span><span>{s.w}×{s.h}</span>
            <span className="text-neutral-400">codec</span><span>{s.codec}</span>
            <span className="text-neutral-400">limited by</span><span className={s.limit === 'none' ? '' : 'text-amber-400'}>{s.limit}</span>
            <span className="text-neutral-400">path</span><span>{s.path}</span>
            <span className="text-neutral-400">viewers</span><span className={s.viewers > 2 ? 'text-amber-400' : ''}>{s.viewers}</span>
          </div>
        </>
      )}
    </div>
  )
}
