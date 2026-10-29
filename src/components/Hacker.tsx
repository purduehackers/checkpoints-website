import { useEffect, useRef, useState } from 'react'
import { Badge, Spinner, aboutMin, api, fmt, hackerToken, ordinal, span, useLive, useTick, waitMs } from '../lib/live'
import { ShareBox } from '../lib/vdo'
import { StatsButton, useStatsToggle } from '../lib/stats'
import { ICONS, Tour, seen, type Step } from '../lib/tour'
import { ReactionPanel } from '../lib/reactions'
import type { ShareState } from '../../shared/types'

// Phones can't screen share from a browser (Android Chrome may still expose getDisplayMedia, so check the device too),
// so they share their camera instead.
// iPadOS reports itself as a Mac; touch points give it away.
const phone = typeof navigator !== 'undefined' &&
  (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
const canShare = typeof navigator !== 'undefined' && !!(phone ? navigator.mediaDevices?.getUserMedia : navigator.mediaDevices?.getDisplayMedia)

// "It's your turn": a short, quiet 8-bit arpeggio made in the browser (no audio file). Browsers only let it play
// after the page has been clicked once, which joining already did.
function chime() {
  try {
    const ctx = new AudioContext()
    ;[659.25, 830.61, 987.77, 1318.51].forEach((hz, i) => { // E major, up an octave
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      const t = ctx.currentTime + i * 0.09, len = i === 3 ? 0.35 : 0.1
      osc.type = 'square'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.04, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + len)
    })
    setTimeout(() => ctx.close(), 1500)
  } catch {}
}

// Browser notification for queue changes. Silent on failure: iOS Safari outside a home-screen app has no Notification,
// and some Android browsers throw on `new Notification` (they want a service worker).
const NOTE: Record<number, string> = { 3: "You're 3rd in line", 2: "You're 2nd in line", 1: "You're up next. Get ready!" }
function notify(body: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    // One tag, so each replaces the last instead of stacking.
    const n = new Notification('Checkpoints', { body, tag: 'checkpoints-queue', renotify: true } as NotificationOptions)
    n.onclick = () => { window.focus(); n.close() }
  } catch {}
}

// First-time tour, one part per page state (the elements only exist then).
const SHARE_TEXT = phone ? 'Share your camera early.' : 'Share your screen early.'
const TOUR: Record<'wait' | 'turn', Step[]> = {
  wait: [
    { target: 'status', icon: ICONS.hourglass, text: "Your spot in line." },
    { target: 'share', icon: ICONS.screen, text: SHARE_TEXT },
  ],
  turn: [{ target: 'start', icon: ICONS.play, text: 'Press to go live.' }],
}

export default function Hacker() {
  const { state, online, apply, now, react, notice } = useLive('hacker')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', project: '' })
  const [shareState, setShareState] = useState<ShareState>('not_shared')
  const reported = useRef<ShareState>('not_shared')
  const shareFn = useRef<(() => void) | null>(null) // ShareBox's share(), so Start presenting can open the picker (or camera)
  const autoReady = useRef(false) // /ready already sent for this call: a re-render or a share restart must not send it twice
  const stats = useStatsToggle()
  const [replay, setReplay] = useState(0) // "How it works" remounts the tour
  useTick()

  const token = hackerToken()
  // One request at a time, in click order: a late share-state must not land after Ready, nor an old reply overwrite a newer one.
  const chain = useRef(Promise.resolve())
  const [pending, setPending] = useState(0) // requests in flight, for the spinner
  const act = (path: string, body: object = {}) => {
    setPending((n) => n + 1)
    return (chain.current = chain.current.then(() => api(path, { token, ...body }).then(apply).catch((e) => setError(e.message)).finally(() => setPending((n) => n - 1))))
  }

  const me = state?.me
  const cur = state?.current?.entryId === me?.entryId ? state?.current : null
  const active = me && ['waiting', 'called', 'live'].includes(me.status)
  const open = state?.session?.status === 'open'
  // "Thanks for presenting" only right after presenting on this page; a refresh (or Join again) goes back to the form.
  const presentedHere = useRef(false)
  if (active) presentedHere.current = true
  const [thanked, setThanked] = useState(false)
  // Returning hackers get their name and project back.
  useEffect(() => { if (me && !form.name && !form.project) setForm({ name: me.name, project: me.project }) }, [me?.entryId])

  // Report the share state to the server, only when it changes.
  useEffect(() => {
    if (active && shareState !== reported.current) { reported.current = shareState; act('/share-state', { state: shareState }) }
  }, [shareState, active])
  useEffect(() => { if (!active) { reported.current = 'not_shared'; setShareState('not_shared') } }, [active])
  // Called while sharing (or the moment the share connects after the big button): go live, no extra click.
  // After the share-state report above (requests run in click order), so the server has seen 'sharing' before Ready.
  // The ref clears when the share stops or the call ends, so nothing stale is left waiting.
  useEffect(() => {
    if (me?.status !== 'called' || shareState !== 'sharing') autoReady.current = false
    else if (!autoReady.current) { autoReady.current = true; act('/ready') }
  }, [shareState, me?.status])
  const start = () => {
    if (shareState === 'sharing') return act('/ready') // retry, if the automatic one failed
    // Opens the picker (or camera); the effect above goes live once it connects.
    // No share possible here (unsupported browser): start without one.
    if (!canShare) act('/ready', { noShare: true })
    else shareFn.current?.()
  }

  // Chime + notification on transitions only, not on a refresh that lands already in that state (prev is null until the first state).
  const prevStatus = useRef<string | null>(null)
  const prevPos = useRef<number | null>(null)
  useEffect(() => {
    if (!state) return
    if (prevStatus.current !== null) {
      if (me?.status === 'called' && prevStatus.current !== 'called') { chime(); notify("It's your turn! Go up now.") }
      else if (me?.status === 'waiting' && prevStatus.current === 'waiting' && me.position !== prevPos.current && NOTE[me.position]) notify(NOTE[me.position])
    }
    prevStatus.current = me?.status ?? ''
    prevPos.current = me?.status === 'waiting' ? me.position : null
  }, [!!state, me?.status, me?.position])

  // Time warnings while live: "15 seconds left" and "Time's up!", once per crossing (adding time re-arms them).
  // Compared with the last reading for this entry, so a load or refresh already past a line stays quiet; paused fires nothing.
  const msTotal = cur?.pausedLeft ?? (cur?.deadline != null ? cur.deadline - now() : null)
  const prevMs = useRef<{ id: string; ms: number } | null>(null)
  useEffect(() => {
    const live = me?.status === 'live' && cur?.pausedLeft == null && msTotal !== null
    const prev = prevMs.current
    if (live && prev?.id === me.entryId) {
      if (prev.ms > 15_000 && msTotal <= 15_000 && msTotal > 0) notify('15 seconds left')
      else if (prev.ms > 0 && msTotal <= 0) notify("Time's up!")
    }
    prevMs.current = live ? { id: me.entryId, ms: msTotal } : null
  }, [msTotal !== null && Math.floor(msTotal / 250), me?.status, me?.entryId, cur?.pausedLeft])

  // US-4.1 / 4.2 alerts: tab title + the "up next" banner (browser notifications are above).
  const key = me ? `${me.status}:${me.position}` : ''
  useEffect(() => {
    document.title = me?.status === 'called' ? "It's your turn! · Checkpoints" : me?.status === 'waiting' && me.position === 1 ? "You're up next! · Checkpoints" : 'Checkpoints'
  }, [key])

  // Closing the tab takes you out of the line. beforeunload only asks (it also fires on refresh, which is fine);
  // pagehide tells the server, which waits 5s so a refresh (new socket) or a Wi-Fi blip (no pagehide) keeps the spot.
  useEffect(() => {
    if (!active) return
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const bye = () => navigator.sendBeacon?.('/api/bye', new Blob([JSON.stringify({ token })], { type: 'application/json' }))
    addEventListener('beforeunload', ask)
    addEventListener('pagehide', bye)
    return () => { removeEventListener('beforeunload', ask); removeEventListener('pagehide', bye) }
  }, [active, token])

  if (!state) return <Shell><Badge online={online} /><p className="flex items-center gap-3"><Spinner className="size-5" />Loading…</p></Shell>

  // The server keeps a presenter live for a save window (GRACE_MS) past the deadline: say so, keep sharing, end nothing here.
  const timeUp = me?.status === 'live' && cur?.pausedLeft == null && msTotal !== null && msTotal <= 0

  let body, tour: keyof typeof TOUR | null = null
  if (!state.session) body = <p className="text-xl">No checkpoint is running.</p>
  else if (!open) body = <p className="text-xl">This checkpoint has ended.</p>
  else if (me?.status === 'removed') body = <p className="text-xl">You were removed from the queue.</p>
  else if (me?.status === 'done' && presentedHere.current && !thanked) {
    body = (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Thanks for presenting!</h1>
        <button className="rounded bg-amber-500 px-4 py-2 font-semibold text-black" onClick={() => setThanked(true)}>Join again</button>
      </div>
    )
  }
  else if (!active) {
    body = (
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault(); setError('')
        // Ask from this click (a user gesture), but never make joining wait on the answer.
        try { if ('Notification' in window && Notification.permission === 'default') Promise.resolve(Notification.requestPermission()).catch(() => {}) } catch {}
        act('/join', form)
      }}>
        <h1 className="text-2xl font-semibold">Join the checkpoint</h1>
        <p className="text-sm text-neutral-400">You get {span(state.session!.limitSec)}.</p>
        <input required maxLength={60} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded bg-neutral-800 p-3" />
        <input required maxLength={80} placeholder="Project name" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} className="w-full rounded bg-neutral-800 p-3" />
        <button disabled={pending > 0} className="flex w-full items-center justify-center gap-2 rounded bg-amber-500 p-3 font-semibold text-black disabled:opacity-70">{pending > 0 && <Spinner />}Join queue</button>
      </form>
    )
  } else {
    tour = me.status === 'waiting' ? 'wait' : me.status === 'called' ? 'turn' : null
    body = (
      <div className="space-y-4">
        {me.status === 'waiting' && (
          <div data-tour="status" className={me.position === 1 ? 'rounded-lg bg-amber-400 p-4 text-black' : ''}>
            <h1 className="text-3xl font-semibold">{me.position === 1 ? "You're up next!" : `You're ${ordinal(me.position)} in line`}</h1>
            <p className={me.position === 1 ? '' : 'text-neutral-400'}>{shareState === 'sharing' ? "You're all set." : `Up in ${aboutMin(waitMs(state, me.position - 1, now()))}.`}</p>
          </div>
        )}
        {/* Inline, not a full-page cover: the first in line is called automatically while still at their seat,
            so Change window and Leave queue must stay reachable. Already sharing: goes live by itself. Otherwise one button shares and goes live. */}
        {me.status === 'called' && (
          <div className="space-y-3 rounded-lg bg-green-500 p-4 text-black">
            <h1 className="text-3xl font-semibold">It's your turn!</h1>
            <button data-tour="start" disabled={pending > 0} className="flex w-full items-center justify-center gap-3 rounded-lg bg-black px-6 py-4 text-2xl font-bold text-green-400 disabled:opacity-70" onClick={start}>{pending > 0 && <Spinner className="size-5" />}{shareState === 'sharing' || !canShare ? 'Start presenting' : phone ? 'Share camera & start' : 'Share screen & start'}</button>
          </div>
        )}
        {me.status === 'live' && (
          <div>
            <h1 className="text-3xl font-semibold">You're live</h1>
            {msTotal !== null && <p className="text-neutral-400">{timeUp ? "Time's up" : `${fmt(msTotal)} left`}</p>}
          </div>
        )}
        {me.status === 'waiting' && state.session!.reactions && <ReactionPanel react={react} notice={notice} />}
        {canShare ? (
          <div data-tour="share"><ShareBox streamId={me.streamId} label={me.name} live={me.status === 'live'} quality={state.session!.quality} stats={stats.on} onCloseStats={stats.toggle} onState={setShareState} shareRef={shareFn} hideShare={me.status === 'called'} camera={phone} /></div>
        ) : (
          <p className="rounded bg-neutral-800 p-3 text-sm">{phone ? 'No camera access in this browser.' : 'Screen sharing needs Chrome or Edge.'}</p>
        )}
        {/* Take the stage with no share from this page: talk-only, or a browser that can't share. */}
        {/* Shown while waiting too, so people find it early; Ready only works once called. */}
        {me.status !== 'live' && shareState !== 'sharing' && (
          <button disabled={me.status !== 'called'} className="w-full rounded-lg border border-green-500 px-4 py-3 font-medium text-green-400 disabled:border-neutral-700 disabled:text-neutral-500"
            onClick={() => confirm('Start your time without sharing here?') && act('/ready', { noShare: true })}>
            Present without sharing{me.status !== 'called' && ' (when it’s your turn)'}
          </button>
        )}
        {me.status === 'live' && <button className="rounded bg-red-600 px-4 py-2" onClick={() => act('/end')}>End my checkpoint</button>}
        {me.status !== 'live' && <button className="text-sm text-neutral-400 underline" onClick={() => confirm('Leave the queue?') && act('/leave')}>Leave queue</button>}
      </div>
    )
  }

  return (
    <Shell>
      <Badge online={online} />
      {active && canShare && <StatsButton onClick={stats.toggle} className="fixed bottom-3 left-3" />}
      {me?.status === 'live' && msTotal !== null && <div className={`fixed left-3 top-3 z-40 rounded px-3 py-1 text-xl font-bold tabular-nums ${cur?.pausedLeft != null ? 'bg-neutral-800 text-neutral-500' : msTotal <= 30_000 ? 'bg-red-600' : 'bg-neutral-800'}`}>{cur?.pausedLeft != null && '⏸ '}{timeUp ? "Time's up" : fmt(msTotal)}</div>}
      {me?.status === 'waiting' && me.position === 1 && <div className="pointer-events-none fixed inset-0 z-20 animate-pulse bg-amber-400/25" />}
      {me?.status === 'called' && <div className="pointer-events-none fixed inset-0 z-20 animate-pulse bg-green-400/25" />}
      {pending > 0 && <div className="late fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded bg-neutral-800 px-3 py-1 text-sm"><Spinner />Working…</div>}
      {body}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {tour && <Tour key={tour + replay} part={tour} steps={TOUR[tour]} />}
      {tour && <button className="mt-6 text-xs text-neutral-500 underline" onClick={() => { seen.clear(); setReplay((n) => n + 1) }}>How it works</button>}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen p-6"><div className="mx-auto max-w-2xl">{children}</div></main>
}
