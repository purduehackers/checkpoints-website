import { Button } from './ph/button'
import { useEffect, useState } from 'react'
import { ConnectionBadge, fmt, useLive, useTick } from '../lib/live'

// The whole background does the signalling: solid red from 0:30, flashing red/black (0.7s cycle) from 0:10,
// steady red at time's up. Black with a hairline frame otherwise, and while paused.
export const screenColor = (left: number | null, paused: boolean) =>
  paused || left === null || left > 30_000 ? 'bg-background'
    : left > 0 && left <= 10_000 ? 'bg-[red] text-white alarm-flash'
    : 'bg-[red] text-white'

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

  return (
    <main className={`relative h-screen overflow-hidden text-foreground ${live ? screenColor(left, paused) : 'bg-background'} ${idle ? 'cursor-none' : ''}`}>
      <ConnectionBadge online={online} />
      {live ? (
        <>
          {screenColor(left, paused) === 'bg-background' && <div className="absolute inset-x-[1.875vw] inset-y-[3.333vh] box-border border border-solid border-border" />}
          {paused && <p className="ph-headline absolute inset-x-0 top-[17.59%] text-center text-[10.4167vw] text-ph-yellow">⏸ Paused</p>}
          <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-bold leading-none tabular-nums text-[26.0417vw] ${paused ? 'text-ph-yellow' : ''}`}>{left === null ? '--:--' : fmt(Math.max(left, 0))}</div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-[2vw] text-center">
          {c?.status === 'called'
            ? <p className="ph-subheadline text-[4vw]">Getting ready…</p>
            : <p className="ph-subheadline text-[4vw]">{state ? 'No one presenting' : ''}</p>}
        </div>
      )}
      <Button variant="outline" size="sm" className="absolute bottom-3 right-3 z-40" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</Button>
    </main>
  )
}
