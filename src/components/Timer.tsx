import { Button } from './ph/button'
import { useEffect, useState } from 'react'
import { ConnectionBadge, fmt, useLive, useTick } from '../lib/live'

// The inset frame does the signalling (background stays black, per Figma 81:90 / 81:124):
// thicker red from 0:30, a gentle pulse from 0:10, then a thick steady red at TIME'S UP.
export const frameBorder = (left: number | null, paused: boolean) =>
  paused || left === null || left > 30_000 ? 'border border-border'
    : left <= 0 ? 'border-[4.6875vw] border-[red]'
    : left <= 10_000 ? 'border-[1.5vw] border-[red] alarm-pulse'
    : 'border-[1.5vw] border-[red]'

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
  const expired = live && !paused && left !== null && left <= 0

  return (
    <main className={`relative h-screen overflow-hidden bg-background text-foreground ${idle ? 'cursor-none' : ''}`}>
      <ConnectionBadge online={online} />
      {live ? (
        <>
          <div className={`absolute inset-x-[1.875vw] inset-y-[3.333vh] box-border border-solid ${frameBorder(left, paused)}`} />
          <p className={`ph-headline absolute inset-x-0 top-[17.59%] text-center text-[10.4167vw] ${paused ? 'text-ph-yellow' : ''}`}>{paused && '⏸ Paused · '}{c.name}</p>
          <div className={`absolute inset-x-0 top-[36.11%] text-center font-bold leading-none tabular-nums text-[26.0417vw] ${paused ? 'text-ph-yellow' : expired ? 'text-[red]' : ''}`}>{left === null ? '--:--' : fmt(Math.max(left, 0))}</div>
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
      <Button variant="outline" size="sm" className="absolute bottom-3 right-3 z-40" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</Button>
    </main>
  )
}
