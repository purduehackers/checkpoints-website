import { useEffect, useState } from 'react'
import { Badge, adminToken, fmt, useLive, useTick } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { StatsButton, StatsOverlay, useRemoteStats, useStatsToggle } from '../lib/stats'

const projector = !!adminToken() // only a host logged in as admin gets the live stream (see loadState)

export default function Host() {
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
  const live = c?.status === 'live' && c.streamId
  const left = c?.deadline ? c.deadline - now() : null
  const open = state?.session?.status === 'open'
  const audio = state?.session?.audio ?? true
  const stats = useStatsToggle()
  const history = useRemoteStats(live ? c!.streamId! : null, stats.on)

  return (
    <main className={`relative flex h-screen flex-col ${idle ? 'cursor-none' : ''}`}>
      <Badge online={online} />
      {stats.menu}
      {stats.on && <StatsOverlay history={history} title={live ? `Live: ${c!.name}` : 'Nobody live'} onClose={stats.toggle} />}
      {live ? (
        <>
          <div className="flex items-center gap-4 bg-neutral-900 px-6 py-3 text-2xl"><b>{c!.name}</b><span className="text-neutral-400">{c!.project}</span></div>
          <ViewFrame key={String(audio)} streamId={c!.streamId!} className="w-full grow bg-black" audio={audio} />
          {left !== null && left <= 15_000 && <div className="absolute left-4 top-20 rounded bg-red-600 px-4 py-2 text-5xl font-bold tabular-nums">{fmt(left)}</div>}
        </>
      ) : (
        <div className="flex grow flex-col items-center justify-center gap-6 p-8 text-center">
          <h1 className="text-5xl font-bold">Purdue Hackers · Checkpoints</h1>
          {state && !state.session && <p className="text-2xl text-neutral-400">Waiting for an organizer to start</p>}
          {state?.session && !open && <p className="text-3xl">Checkpoints have ended. Thanks for coming!</p>}
          {open && <p className="text-4xl">Join at <b className="text-amber-400">{location.host}</b></p>}
          {c?.status === 'live' && !projector && <p className="text-sm text-neutral-500">Screens only show on the projector. Log in at /admin on this device to show them here.</p>}
          {c && <p className="text-3xl">Up now: <b>{c.name}</b> · {c.project} <span className="text-neutral-400">({c.status === 'live' ? 'live' : 'getting ready'})</span></p>}
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
