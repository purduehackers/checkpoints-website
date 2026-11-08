import { useEffect, useRef, useState } from 'react'
import { Badge, fmt, useLive, useTick } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { spawn } from '../lib/reactions'
import { DitheredSoup } from './DitheredSoup'

// The projector may be opened on an old/preview URL, so the shown address can be pinned (build-time var).
const pinnedHost = import.meta.env.PUBLIC_JOIN_HOST

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
  const prevLeft = useRef<{ id: number | string, left: number } | null>(null) // last timer value per presenter, so a refresh never buzzes
  // Chrome won't autoplay video with sound before a click on the page, and &cleanoutput hides vdo.ninja's play button,
  // so the projector stayed blank. The stream starts muted (always allowed) and unmutes on the first click or key.
  const [clicked, setClicked] = useState(false)
  useEffect(() => {
    const on = () => { setClicked(true); unlock() } // the same first click also unlocks the buzzer
    addEventListener('pointerdown', on, { once: true }); addEventListener('keydown', on, { once: true })
    return () => { removeEventListener('pointerdown', on); removeEventListener('keydown', on) }
  }, [])
  useTick()
  const [scale, setScale] = useState(1) // the 1920x1080 Figma frame is scaled to fit any screen
  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / 1920, innerHeight / 1080))
    fit(); addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  // Chrome blocks audio until a click, so the first click creates (or resumes) the buzzer's AudioContext.
  const unlock = () => {
    try {
      audioCtx ??= new AudioContext()
      if (audioCtx.state === 'suspended') void audioCtx.resume()
    } catch { /* ignore */ }
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
  const inPerson = !!live && c!.shareState !== 'sharing' // "Present without sharing": nothing to project
  const timeUp = left !== null && left <= 0 && c?.pausedLeft == null // in the GRACE_MS save window the presenter is still live
  // Only the last 10 seconds (and TIME'S UP) show on the big screen; the speaker has /timer for the full countdown.
  const timer = left !== null && left <= 10_000 && <div className={`px-[0.4em] font-bold tabular-nums ${c?.pausedLeft != null ? 'border border-border bg-black text-ph-yellow' : 'bg-red-600 text-white'}`}>{c?.pausedLeft != null && '⏸ '}{timeUp ? "TIME'S UP" : fmt(left)}</div>
  const queue = state?.queue ?? []

  // Buzz once when a running (not paused) presenter's time crosses from >0 to <=0; adding time and running out again buzzes again.
  useEffect(() => {
    try {
      if (!c || left === null) { prevLeft.current = null; return }
      const prev = prevLeft.current
      prevLeft.current = { id: c.entryId, left }
      if (prev && prev.id === c.entryId && prev.left > 0 && left <= 0 && c.status === 'live' && c.pausedLeft == null) buzz()
    } catch { /* ignore */ }
  })

  const cards = [
    { bg: '#ff9300', rot: -3.22, left: 34.2, top: 115.9, shadow: true },
    { bg: '#0084ff', rot: 2.5, left: 24.1, top: 302.8, shadow: true },
    { bg: '#fcd202', rot: -1.8, left: 41, top: 470.8, shadow: false },
  ]
  const wide = open && queue.length > 0 // "In Line" panel shrinks the idle screen's left pane
  const poly = { fontFamily: 'var(--font-sans)' }
  const pixel = { fontFamily: 'var(--font-pixel)' }
  const avatar = (i: number) => i === 0
    ? <img alt="" src="/host/avatar-1.png" className="absolute" style={{ left: 326.4, top: 6.75, width: 174, height: 174, mixBlendMode: 'color-burn', transform: 'rotate(3.22deg)', objectFit: 'cover' }} />
    : i === 1
      ? <img alt="" src="/host/avatar-2.png" className="absolute" style={{ left: 318, top: -4, width: 176, height: 207, mixBlendMode: 'color-burn', transform: 'rotate(-2.5deg)', objectFit: 'cover' }} />
      : <img alt="" src="/host/avatar-3.png" className="absolute" style={{ left: 337.5, top: 13.2, width: 157.2, height: 202.6, opacity: 0.32, objectFit: 'cover', objectPosition: 'bottom' }} />

  return (
    <main className={`relative h-screen w-screen overflow-hidden bg-black ${idle ? 'cursor-none' : ''}`}>
      <Badge online={online} />
      {c?.away && <div className="absolute left-1/2 top-[8vh] z-30 -translate-x-1/2 bg-ph-orange px-[1.2vw] py-[0.6vw] text-[2vw] font-bold text-black"><span className="dots">{c.name} disconnected</span></div>}
      <div ref={reactBox} className="pointer-events-none absolute bottom-0 right-0 top-0 z-20 w-40 overflow-hidden" />
      {live ? (
        // Edge to edge so the share is as big as the screen allows; the bar sits above the video, never over it.
        <div className="absolute inset-0 flex flex-col">
          <div className="relative flex shrink-0 items-center justify-between gap-[2vw] overflow-hidden border-b border-border px-[0.8vw] py-[0.6vw] text-[max(16px,1.25vw)] text-white">
            <DitheredSoup fgColor="#2e2e2e" />
            <p className="relative flex min-w-0 items-baseline gap-[0.6em] whitespace-nowrap"><span className="truncate font-medium">{c!.project}</span><span className="ph-subheadline text-ph-pink">{c!.name}</span></p>
            {open && <p className="ph-headline relative whitespace-nowrap">Join at <span className="text-ph-yellow">{joinHost}</span></p>}
          </div>
          <div className="relative min-h-0 flex-1">
            {/* The frame stays mounted behind the screen, so a share that starts after going live flips to video. */}
            <ViewFrame key={`${c!.streamId}:${c!.shareEpoch}`} streamId={c!.streamId!} className="absolute inset-0 h-full w-full bg-black" muted={!audio || !clicked} />
            {inPerson && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[2vw] bg-black p-[2vw] text-center text-white">
                <p className="ph-subheadline text-[2vw]">{c!.project}</p>
                <h1 className="ph-headline text-[3.75vw]">Watch <span className="text-ph-yellow">{c!.name}</span> in person</h1>
                {timer && <div className="text-[5vw]">{timer}</div>}
                <div className="text-[8vw] leading-none text-ph-yellow motion-safe:animate-pulse">⬅</div>
              </div>
            )}
            {!inPerson && timer && <div className="absolute left-[1vw] top-[1vw] z-10 text-[2.5vw]">{timer}</div>}
          </div>
        </div>
      ) : (
        // Edge to edge: the soup fills the viewport and "In Line" hugs the right edge. Their contents keep the
        // Figma 1920x1080 sizes, scaled by `scale`; the text + QR column stays centered in the left pane.
        <div className="absolute inset-0 flex">
          <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
            <DitheredSoup fgColor="#2e2e2e" />
            <div className="relative shrink-0" style={{ width: 989, height: 1080, transform: `scale(${scale})` }}>
              <div className="absolute inset-x-0 flex flex-col items-center text-center text-white" style={{ ...pixel, top: 151, gap: 20 }}>
                <p className="w-full text-[96px] leading-[normal]">Checkpoints</p>
                {state && !state.session && <p className="w-full text-[40px]">Waiting for an organizer to start</p>}
                {state?.session && !open && <p className="w-full text-[40px]">Checkpoints have ended. Thanks for coming!</p>}
                {open && <p className="w-full text-[64px] leading-[normal]">Join at <span className="text-ph-yellow">phack.rs/checkpoints</span></p>}
                {c?.status === 'called' && <p className="w-full text-[48px]"><span className="text-ph-yellow">{c.name}</span>, go to the podium</p>}
              </div>
              {open && <img alt="QR code: join at phack.rs/checkpoints" src="/host/qr.png" className="absolute" style={{ left: 236, top: 411, width: 517, height: 517 }} />}
            </div>
          </div>
          {wide && (
            <div className="relative shrink-0 overflow-hidden border-l border-border bg-black" style={{ width: 573 * scale }}>
            <div className="absolute left-0 top-0 origin-top-left" style={{ width: 573, height: 1080, transform: `scale(${scale})`, ...poly }}>
              <p className="absolute whitespace-nowrap text-[48px] leading-[normal] text-white" style={{ left: 31, top: 47 }}>In Line</p>
              {cards.map((k, i) => { const e = queue[i]; return e && (
                <div key={e.id} className="absolute overflow-hidden" style={{ left: k.left, top: k.top, width: 501, height: 200, background: k.bg, transform: `rotate(${k.rot}deg)`, boxShadow: k.shadow ? '0 2px 4px rgba(0,0,0,.25)' : undefined }}>
                  <div className="absolute flex flex-col leading-[normal] text-black" style={{ left: 25, top: 27, width: 277 }}>
                    <p className="truncate text-[48px]">#{i + 1}</p>
                    <p className="truncate text-[48px]">{e.name}</p>
                    <p className="truncate text-[32px]">{e.project}</p>
                  </div>
                  {avatar(i)}
                </div>
              ) })}
            </div>
            </div>
          )}
        </div>
      )}
      {audio && !clicked && <span className="ph-subheadline absolute bottom-3 right-3 z-40 border border-border bg-ph-yellow px-3 py-1 text-xs text-black">Click anywhere for sound</span>}
    </main>
  )
}
