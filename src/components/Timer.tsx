import { useEffect, useState } from 'react'
import { Badge, fmt, useLive, useTick } from '../lib/live'
import { GRACE_MS } from '../../shared/types'

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
  // amber at <=60s, solid red at <=30s, a red/white strobe for ~1.5s as it hits 15 and 10, nonstop from 5 and at time's up.
  const burst = left !== null && ((left <= 15_000 && left > 13_500) || (left <= 10_000 && left > 8_500))
  const screen = !live || paused || left === null ? ''
    : left <= 5_000 || burst ? 'strobe'
    : left <= 30_000 ? 'bg-red-600 text-white'
    : left <= 60_000 ? 'bg-amber-400 text-black' : ''
  const sub = screen ? '' : 'text-neutral-400' // grey captions vanish on a colored screen
  const color = paused ? 'text-neutral-500' : ''

  return (
    <main className={`relative flex h-screen flex-col items-center justify-center overflow-hidden p-8 text-center ${screen} ${idle ? 'cursor-none' : ''}`}>
      <Badge online={online} />
      {live ? (
        <>
          {/* ⏸ goes on the name line: in front of the time it would push 28vw digits off screen */}
          <p className={`text-[4vw] ${sub}`}>{paused && '⏸ Paused · '}{c.name}</p>
          {/* Past the deadline the server keeps them live for GRACE_MS so the organizer can add time. */}
          {left !== null && left <= 0 && !paused
            ? <><div className="shake font-bold leading-none text-[16vw]">TIME'S UP</div><p className="text-[3vw]">{fmt(left + GRACE_MS)}</p></>
            : <div className={`font-bold leading-none tabular-nums text-[28vw] ${color} ${!paused && left !== null && left <= 5_000 ? 'shake' : ''}`}>{left === null ? '--:--' : fmt(left)}</div>}
        </>
      ) : c?.status === 'called' ? (
        <>
          <p className="text-[8vw] font-bold leading-tight"><b className="text-green-400">{c.name}</b> is up next</p>
          <p className="text-[3vw] text-neutral-400">Getting ready…</p>
        </>
      ) : (
        <p className="text-[6vw] text-neutral-500">{state ? 'No one presenting' : ''}</p>
      )}
      <div className="absolute bottom-3 right-3 opacity-60 hover:opacity-100">
        <button className="rounded bg-neutral-800 px-3 py-1" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      </div>
    </main>
  )
}
