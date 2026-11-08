import { Button } from './ph/button'
import { useEffect, useState } from 'react'
import { Badge, fmt, useLive, useTick } from '../lib/live'

// The whole screen does the signalling, so the speaker sees it from the corner of their eye:
// solid red with white text from 0:30, then the red gently pulses from 0:10 through TIME'S UP.
export const alarm = (left: number | null, paused: boolean) =>
  paused || left === null ? '' : left <= 10_000 ? 'alarm-pulse bg-red-600 text-white' : left <= 30_000 ? 'bg-red-600 text-white' : ''

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
  const screen = live ? alarm(left, paused) : ''
  const expired = live && !paused && left !== null && left <= 0

  return (
    <main className={`relative h-screen overflow-hidden bg-background text-foreground ${screen} ${idle ? 'cursor-none' : ''}`}>
      <Badge online={online} />
      {live ? (
        <>
          <div className={`absolute inset-x-[1.875vw] inset-y-[3.333vh] box-border border-solid ${expired ? 'border-[4.6875vw] border-[red]' : 'border border-border'}`} />
          <p className={`ph-headline absolute inset-x-0 top-[17.59%] text-center text-[10.4167vw] ${paused && !screen ? 'text-ph-yellow' : ''}`}>{paused && '⏸ Paused · '}{c.name}</p>
          {/* Past the deadline the server keeps them live for GRACE_MS so the organizer can add time. */}
          <div className={`absolute inset-x-0 top-[36.11%] text-center font-bold leading-none tabular-nums text-[26.0417vw] ${paused ? 'text-ph-yellow' : expired && !screen ? 'text-[red]' : ''}`}>{left === null ? '--:--' : fmt(Math.max(left, 0))}</div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-[2vw] text-center">
          {c?.status === 'called' ? (
            <>
              <h1 className="ph-headline text-[8vw]"><span className="text-ph-yellow">{c.name}</span> is up next</h1>
              <p className="ph-subheadline text-[3vw]">Getting ready…</p>
            </>
          ) : <p className="ph-subheadline text-[4vw]">{state ? 'No one presenting' : ''}</p>}
        </div>
      )}
      <Button variant="outline" size="sm" className="absolute bottom-3 right-3 z-40 bg-background" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</Button>
    </main>
  )
}
