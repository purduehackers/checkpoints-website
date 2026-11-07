import { useEffect, useState } from 'react'
import { Badge, fmt, useLive, useTick } from '../lib/live'

// Speaker-facing countdown for a second screen. Same 'host' feed as the projector (no auth), no reactions callback.
export default function Timer() {
  const { state, online, now } = useLive('host')
  const [idle, setIdle] = useState(false)
  useTick()

  // Hide the cursor after 3s without movement.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000) }
    wake(); window.addEventListener('mousemove', wake)
    return () => { window.removeEventListener('mousemove', wake); clearTimeout(t) }
  }, [])

  const c = state?.current
  const live = c?.status === 'live'
  const paused = live && c.pausedLeft != null
  const left = live ? c.pausedLeft ?? (c.deadline != null ? c.deadline - now() : null) : null
  // The whole screen does the shouting, so the speaker sees it from the corner of their eye:
  // solid red with white text from 0:30, then a red/white flash from 0:10 through TIME'S UP.
  const screen = !live || paused || left === null ? ''
    : left <= 10_000 ? 'strobe'
    : left <= 30_000 ? 'bg-red-600 text-white' : ''
  const expired = live && !paused && left !== null && left <= 0

  return (
    <main className={`relative h-screen overflow-hidden bg-black text-[#f5f5f5] ${screen} ${idle ? 'cursor-none' : ''}`}>
      <Badge online={online} />
      {live ? (
        <>
          <div className={`absolute inset-x-[1.875vw] inset-y-[3.333vh] box-border border-solid ${expired ? 'border-[4.6875vw] border-[red]' : 'border border-[#b6b6b6]'}`} />
          <p className={`absolute inset-x-0 top-[17.59%] text-center text-[10.4167vw] leading-none ${screen ? '' : expired ? 'text-[#a90a0a]' : 'text-[#666]'}`}>{paused && '⏸ Paused · '}{c.name}</p>
          {/* Past the deadline the server keeps them live for GRACE_MS so the organizer can add time. */}
          <div className={`absolute inset-x-0 top-[36.11%] text-center font-bold leading-none tabular-nums text-[26.0417vw] ${paused ? 'text-neutral-500' : expired && !screen ? 'text-[red]' : ''} ${!paused && left !== null && left <= 5_000 ? 'shake' : ''}`}>{left === null ? '--:--' : fmt(Math.max(left, 0))}</div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center text-center">
          {c?.status === 'called' ? (
            <>
              <p className="text-[8vw] font-bold leading-tight"><b className="text-green-400">{c.name}</b> is up next</p>
              <p className="text-[3vw] text-neutral-400">Getting ready…</p>
            </>
          ) : <p className="text-[6vw] text-neutral-500">{state ? 'No one presenting' : ''}</p>}
        </div>
      )}
      <div className="absolute bottom-3 right-3 z-40 opacity-60 transition-opacity hover:opacity-100">
        <button className="ph-subheadline border border-border bg-black px-3 py-1 text-xs text-white transition-transform active:scale-[0.97] hover:text-ph-yellow" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      </div>
    </main>
  )
}
