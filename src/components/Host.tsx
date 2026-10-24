import { useEffect, useRef, useState } from 'react'
import { Badge, fmt, useLive, useTick } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { spawn } from '../lib/reactions'
import { StatsButton, StatsOverlay, useRemoteStats, useStatsToggle } from '../lib/stats'

// The projector may be opened on an old/preview URL, so the shown address can be pinned (build-time var).
const pinnedHost = import.meta.env.PUBLIC_JOIN_HOST

export default function Host() {
  const joinHost = pinnedHost || location.host
  const reactBox = useRef<HTMLDivElement>(null)
  const { state, online, now } = useLive('host', (counts) => spawn(reactBox.current, counts))
  const [idle, setIdle] = useState(false)
  const [hasVideo, setHasVideo] = useState<boolean | null>(null) // from the iframe (null: it hasn't answered); a backup share has video while shareState is not_shared
  useTick()

  // Hide the cursor after 3s without movement.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000) }
    wake(); window.addEventListener('mousemove', wake)
    return () => { window.removeEventListener('mousemove', wake); clearTimeout(t) }
  }, [])

  const c = state?.current
  const live = c?.status === 'live' && c.streamId
  const left = c?.pausedLeft ?? (c?.deadline != null ? c.deadline - now() : null)
  const open = state?.session?.status === 'open'
  const audio = state?.session?.audio ?? true
  const stats = useStatsToggle()
  const inPerson = !!live && c!.shareState !== 'sharing' && hasVideo !== true // "Present without sharing": nothing to project
  // If vdo.ninja never answers, we can't rule out a backup share, so the frame shrinks to a corner instead of hiding.
  const pip = inPerson && hasVideo === null
  const timer = left !== null && <div className={`rounded px-3 py-1 font-bold tabular-nums ${c?.pausedLeft != null ? 'bg-neutral-900/80 text-neutral-500' : left <= 30_000 ? 'bg-red-600' : 'bg-neutral-900/80'}`}>{c?.pausedLeft != null && '⏸ '}{fmt(left)}</div>
  const history = useRemoteStats(live ? c!.streamId! : null, stats.on)

  return (
    <main className={`relative flex h-screen flex-col ${idle ? 'cursor-none' : ''}`}>
      <Badge online={online} />
      {c?.away && <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-lg bg-amber-500 px-6 py-3 text-3xl font-bold text-black"><span className="dots">{c.name} disconnected</span></div>}
      <div ref={reactBox} className="pointer-events-none absolute bottom-0 right-0 top-0 z-20 w-40 overflow-hidden" />
      {stats.on && <StatsOverlay history={history} title={live ? `Live: ${c!.name}` : 'Nobody live'} onClose={stats.toggle} />}
      {live ? (
        <>
          <div className="flex items-center gap-4 bg-neutral-900 px-6 py-3 text-2xl"><b>{c!.name}</b><span className="text-neutral-400">{c!.project}</span>
            {open && <span className="ml-auto text-xl">Join at <b className="text-amber-400">{joinHost}</b></span>}</div>
          {/* The frame stays mounted behind the screen, so a backup share that starts later flips to video. */}
          <div className="relative flex grow flex-col">
            <ViewFrame streamId={c!.streamId!} className={pip ? 'absolute bottom-4 right-4 z-20 aspect-video w-96 overflow-hidden rounded-lg bg-black' : 'w-full grow bg-black'} muted={!audio} onVideo={setHasVideo} />
            {inPerson && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-8 bg-neutral-950 p-8 text-center">
                <p className="text-4xl text-neutral-400">{c!.project}</p>
                <h1 className="text-7xl font-bold leading-tight">Watch <b className="text-green-400">{c!.name}</b> in person</h1>
                {timer && <div className="text-8xl [&>div]:px-8 [&>div]:py-2">{timer}</div>}
                <div className="animate-bounce text-[10rem] leading-none text-amber-400">⬇</div>
              </div>
            )}
            {!inPerson && left !== null && <div className="absolute left-4 top-4 text-3xl">{timer}</div>}
          </div>
        </>
      ) : (
        <div className="flex grow flex-col items-center justify-center gap-6 p-8 text-center">
          <h1 className="text-5xl font-bold">Purdue Hackers · Checkpoints</h1>
          {state && !state.session && <p className="text-2xl text-neutral-400">Waiting for an organizer to start</p>}
          {state?.session && !open && <p className="text-3xl">Checkpoints have ended. Thanks for coming!</p>}
          {open && <p className="text-4xl">Join at <b className="text-amber-400">{joinHost}</b></p>}
          {c?.status === 'called' && <p className="max-w-4xl text-5xl leading-tight"><b className="text-green-400">{c.name}</b>, you're up!<br />Walk to the front and press <b>Start presenting</b> on your laptop.</p>}
          {open && !c && state!.queue[0] && <p className="text-2xl">Up next: <b>{state!.queue[0].name}</b></p>}
          {open && (
            <ol className="space-y-1 text-xl text-neutral-300">
              {state!.queue.map((e, i) => <li key={e.id}>{i + 1}. {e.name} · <span className="text-neutral-500">{e.project}</span></li>)}
            </ol>
          )}
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex gap-2 opacity-60 hover:opacity-100">
        <StatsButton onClick={stats.toggle} />
        <button className="rounded bg-neutral-800 px-3 py-1" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      </div>
    </main>
  )
}
