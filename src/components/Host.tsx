import { useEffect, useRef, useState } from 'react'
import { Badge, fmt, useLive, useTick } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { spawn } from '../lib/reactions'
import { StatsButton, StatsOverlay, useRemoteStats, useStatsToggle } from '../lib/stats'

// The projector may be opened on an old/preview URL, so the shown address can be pinned (build-time var).
const pinnedHost = import.meta.env.PUBLIC_JOIN_HOST

const say = (text: string) => {
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel() // don't stack announcements
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    synth.speak(u)
  } catch { /* speech is a nicety */ }
}

// One shared AudioContext, created on the first click so Chrome lets the time's-up buzzer play later without one.
let audioCtx: AudioContext | null = null
const buzz = () => {
  try {
    const ctx = audioCtx
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    ;[493.88, 392, 293.66].forEach((hz, i) => { // B4, G4, D4 falling
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      const t = ctx.currentTime + i * 0.22, len = i === 2 ? 0.7 : 0.2
      osc.type = 'square'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.18, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + len)
    })
  } catch { /* sound is a nicety */ }
}

export default function Host() {
  const joinHost = pinnedHost || location.host
  const reactBox = useRef<HTMLDivElement>(null)
  const { state, online, now } = useLive('host', (counts) => spawn(reactBox.current, counts))
  const [idle, setIdle] = useState(false)
  const [announce, setAnnounce] = useState(() => { try { return localStorage.getItem('cp-announce') !== '0' } catch { return true } })
  const prevLeft = useRef<{ id: number | string, left: number } | null>(null) // last timer value per presenter, so a refresh never buzzes
  const prevCalled = useRef<string | null | undefined>(undefined) // undefined: no state yet, so a refresh never announces
  useTick()

  // Chrome blocks speech until a click, so the first button click speaks an empty utterance to unlock it.
  const unlock = () => {
    try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance('')) } catch { /* ignore */ }
    try {
      audioCtx ??= new AudioContext()
      if (audioCtx.state === 'suspended') void audioCtx.resume()
    } catch { /* ignore */ }
  }
  const toggleAnnounce = () => {
    unlock()
    const next = !announce
    setAnnounce(next)
    try { localStorage.setItem('cp-announce', next ? '1' : '0') } catch { /* private mode */ }
    if (!next) try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
  }

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
  const inPerson = !!live && c!.shareState !== 'sharing' // "Present without sharing": nothing to project
  const timeUp = left !== null && left <= 0 && c?.pausedLeft == null // in the GRACE_MS save window the presenter is still live
  const timer = left !== null && <div className={`rounded px-3 py-1 font-bold tabular-nums ${c?.pausedLeft != null ? 'bg-neutral-900/80 text-neutral-500' : left <= 30_000 ? 'bg-red-600' : 'bg-neutral-900/80'}`}>{c?.pausedLeft != null && '⏸ '}{timeUp ? "TIME'S UP" : fmt(left)}</div>
  const history = useRemoteStats(live ? c!.streamId! : null, stats.on)
  const queue = state?.queue ?? []
  const next = queue[0]

  // Buzz once when a running (not paused) presenter's time crosses from >0 to <=0; adding time and running out again buzzes again.
  useEffect(() => {
    try {
      if (!c || left === null) { prevLeft.current = null; return }
      const prev = prevLeft.current
      prevLeft.current = { id: c.entryId, left }
      if (prev && prev.id === c.entryId && prev.left > 0 && left <= 0 && c.status === 'live' && c.pausedLeft == null && announce) buzz()
    } catch { /* ignore */ }
  })

  // Announce only on a transition into 'called' (not on load).
  const calledKey = state ? (c?.status === 'called' ? `${c.entryId}` : null) : undefined
  useEffect(() => {
    if (calledKey === undefined) return
    const prev = prevCalled.current
    prevCalled.current = calledKey
    if (prev === undefined || calledKey === null || calledKey === prev || !announce) return
    say(`${c!.name} is next. ${c!.name}, please go to the podium.`)
  }, [calledKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className={`relative flex h-screen flex-col ${idle ? 'cursor-none' : ''}`}>
      <Badge online={online} />
      {c?.away && <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-lg bg-amber-500 px-6 py-3 text-3xl font-bold text-black"><span className="dots">{c.name} disconnected</span></div>}
      <div ref={reactBox} className="pointer-events-none absolute bottom-0 right-0 top-0 z-20 w-40 overflow-hidden" />
      {stats.on && <StatsOverlay history={history} title={live ? `Live: ${c!.name}` : 'Nobody live'} onClose={stats.toggle} />}
      {live ? (
        <>
          <div className="flex items-center gap-4 bg-neutral-900 px-6 py-3 text-2xl"><b>{c!.name}</b><span className="text-neutral-400">{c!.project}</span>
            {next && <span className="ml-auto text-2xl">Up next: <b className="text-amber-400">{next.name}</b></span>}
            {open && <span className={`text-xl ${next ? '' : 'ml-auto'}`}>Join at <b className="text-amber-400">{joinHost}</b></span>}</div>
          {/* The frame stays mounted behind the screen, so a share that starts after going live flips to video. */}
          <div className="relative flex grow flex-col">
            <ViewFrame streamId={c!.streamId!} className="w-full grow bg-black" muted={!audio} />
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
          {c?.status === 'called' && <p className="max-w-4xl text-5xl leading-tight"><b className="text-green-400">{c.name}</b>, go to the podium</p>}
          {open && next && <p className="text-4xl">Up next: <b className="text-amber-400">{next.name}</b></p>}
          {open && queue.length > 0 && (
            <ol className="space-y-1 text-xl text-neutral-300">
              {queue.slice(0, 5).map((e, i) => <li key={e.id}>{i + 1}. {e.name} · <span className="text-neutral-500">{e.project}</span></li>)}
              {queue.length > 5 && <li className="text-neutral-500">+{queue.length - 5} more</li>}
            </ol>
          )}
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex gap-2 opacity-60 hover:opacity-100">
        <StatsButton onClick={stats.toggle} />
        <button className="rounded bg-neutral-800 px-3 py-1" onClick={toggleAnnounce}>{announce ? '🔊' : '🔇'} Sounds</button>
        <button className="rounded bg-neutral-800 px-3 py-1" onClick={() => { unlock(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen() }}>Fullscreen</button>
      </div>
    </main>
  )
}
