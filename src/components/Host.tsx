import { Badge } from './ph/badge'
import { Button } from './ph/button'
import { Icon } from './ph/icon'
import { useEffect, useRef, useState } from 'react'
import { ConnectionBadge, fmt, ordinal, useLive, useTick } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { spawn } from '../lib/reactions'
import { DitheredSoup } from './DitheredSoup'
import { DOODLES, moreLine, stickers } from './host/stickers'

// Per-slot tilt + nudge so the stack reads as hand-placed sticky notes (Figma 38:9); the look itself follows the person.
const SLOTS = [{ rot: -3.22, x: 5 }, { rot: 2.5, x: -5 }, { rot: -1.8, x: 12 }, { rot: 2.2, x: 0 }]

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
  const timeUp = left !== null && left <= 0 && c?.pausedLeft == null
  // Only the last 10 seconds (and TIME'S UP) show on the big screen; the speaker has /timer for the full countdown.
  const timer = left !== null && left <= 10_000 && <div className={`px-[0.4em] font-bold tabular-nums ${c?.pausedLeft != null ? 'border border-border bg-background text-ph-yellow' : 'bg-red-600 text-foreground'}`}>{c?.pausedLeft != null && '⏸ '}{timeUp ? "TIME'S UP" : fmt(left)}</div>
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

  const wide = open && queue.length > 0 // "In Line" panel shrinks the idle screen's left pane
  const called = c?.status === 'called' // Figma "Waiting for Next": the call replaces the title + QR
  const shown = queue.slice(0, 4)
  const looks = stickers(shown.map((e) => e.id))
  const more = moreLine(queue.slice(4).map((e) => e.name))
  const pixel = { fontFamily: 'var(--font-pixel)' }

  return (
    <main className={`relative h-screen w-screen overflow-hidden bg-background ${idle ? 'cursor-none' : ''}`}>
      <ConnectionBadge online={online} />
      {c?.away && <Badge color="orange" className="absolute left-1/2 top-[8vh] z-30 -translate-x-1/2"><span className="dots text-[2vw]">{c.name} disconnected</span></Badge>}
      <div ref={reactBox} className="pointer-events-none absolute bottom-0 right-0 top-0 z-20 w-40 overflow-hidden" />
      {live ? (
        // Edge to edge so the share is as big as the screen allows; the bar sits above the video, never over it.
        <div className="absolute inset-0 flex flex-col">
          <div className="relative flex shrink-0 items-center justify-between gap-[2vw] overflow-hidden border-b border-border px-[0.8vw] py-[0.6vw] text-[max(16px,1.25vw)] text-foreground">
            <DitheredSoup fgColor={getComputedStyle(document.documentElement).getPropertyValue('--border').trim()} />
            <p className="relative flex min-w-0 items-baseline gap-[0.6em] whitespace-nowrap"><span className="truncate font-medium">{c!.project}</span><span className="ph-subheadline text-ph-pink">{c!.name}</span></p>
            {open && <p className="ph-headline relative whitespace-nowrap">Join at <span className="text-ph-yellow">{joinHost}</span></p>}
          </div>
          <div className="relative min-h-0 flex-1">
            {/* The frame stays mounted behind the screen, so a share that starts after going live flips to video. */}
            <ViewFrame key={`${c!.streamId}:${c!.shareEpoch}`} streamId={c!.streamId!} className="absolute inset-0 h-full w-full bg-background" muted={!audio || !clicked} />
            {inPerson && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[2vw] bg-background p-[2vw] text-center text-foreground">
                <p className="ph-subheadline text-[2vw]">{c!.project}</p>
                <h1 className="ph-headline text-[3.75vw]">Watch <span className="text-ph-yellow">{c!.name}</span> in person</h1>
                {timer && <div className="text-[5vw]">{timer}</div>}
                {/* Inline size: Icon's base size-4 would tie with a size utility (cn() has no tailwind-merge). */}
                <Icon name="arrow-left" className="text-ph-yellow motion-safe:animate-pulse" style={{ width: '8vw', height: '8vw' }} />
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
            <DitheredSoup fgColor={getComputedStyle(document.documentElement).getPropertyValue('--border').trim()} />
            <div className="relative shrink-0" style={{ width: 989, height: 1080, transform: `scale(${scale})` }}>
              {called ? (
                // The server calls the first in line right away, so this is the usual screen: keep the QR so newcomers can still join.
                // One centered column; the name clamps to 2 lines so a long one can't push into the QR.
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-foreground" style={pixel}>
                  <p className="line-clamp-2 w-full break-words text-[96px] leading-[1.1] text-ph-yellow">{c!.name}</p>
                  <p className="mt-[40px] w-full text-[64px] leading-[normal]">Come to the podium!</p>
                  {open && <>
                    <p className="mt-[72px] w-full text-[40px] leading-[normal]">Join at <span className="text-ph-yellow">phack.rs/checkpoints</span></p>
                    <img alt="QR code: join at phack.rs/checkpoints" src="/host/qr.png" className="mt-[24px] size-[360px] shrink-0" />
                  </>}
                </div>
              ) : (
                <>
                  <div className="absolute inset-x-0 flex flex-col items-center text-center text-foreground" style={{ ...pixel, top: 151, gap: 20 }}>
                    <p className="w-full text-[96px] leading-[normal]">Checkpoints</p>
                    {state && !state.session && <p className="w-full text-[40px]">Waiting for an organizer to start</p>}
                    {state?.session && !open && <p className="w-full text-[40px]">Checkpoints have ended. Thanks for coming!</p>}
                    {open && <p className="w-full text-[64px] leading-[normal]">Join at <span className="text-ph-yellow">phack.rs/checkpoints</span></p>}
                  </div>
                  {open && <img alt="QR code: join at phack.rs/checkpoints" src="/host/qr.png" className="absolute" style={{ left: 236, top: 411, width: 517, height: 517 }} />}
                </>
              )}
            </div>
          </div>
          {wide && (
            <div className="relative shrink-0 overflow-hidden border-l border-border bg-background" style={{ width: 573 * scale }}>
              <div className="absolute left-0 top-0 flex origin-top-left flex-col font-sans text-foreground" style={{ width: 573, height: 1080, transform: `scale(${scale})`, padding: '47px 31px 0' }}>
                <p className="text-[48px] leading-[normal]">In Line</p>
                <ol className="mt-[10px] flex flex-col">
                  {shown.map((e, i) => {
                    const { color, doodle } = looks[i], d = DOODLES[doodle], { rot, x } = SLOTS[i]
                    return (
                      // Earlier cards sit on top of later ones; each tucks 10px under the one above, clear of the '#N' line.
                      <li key={e.id} className={`enter relative h-[200px] w-[501px] shrink-0 overflow-hidden text-ph-black ${color} ${i ? '-mt-[10px]' : ''} ${i < shown.length - 1 ? 'shadow-[0_2px_4px] shadow-ph-black/25' : ''}`}
                        style={{ zIndex: shown.length - i, transform: `translateX(${x}px) rotate(${rot}deg)`, '--i': i } as React.CSSProperties}>
                        <img alt="" src={d.src} className={`absolute right-[6px] top-0 h-[200px] w-[176px] object-contain ${d.className}`} style={{ transform: `rotate(${-rot}deg)` }} />
                        <div className="relative flex w-[277px] flex-col pl-[25px] pt-[27px] leading-[normal]">
                          <p className="text-[32px]">{i ? `${ordinal(i + 1)} in line` : 'Next in line'}</p>
                          <p className="truncate text-[48px]">{e.name}</p>
                          <p className="truncate text-[32px]">{e.project}</p>
                        </div>
                      </li>
                    )
                  })}
                </ol>
                {more && <p className="ph-subheadline mt-[36px] line-clamp-2 text-[32px] leading-[1.2]">{more}</p>}
              </div>
            </div>
          )}
        </div>
      )}
      {audio && !clicked && <Button variant="solid" size="sm" className="absolute bottom-3 right-3 z-40">Click anywhere for sound</Button>}
    </main>
  )
}
