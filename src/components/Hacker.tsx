import { Button } from './ph/button'
import { DitherButton } from './ph/dither-button'
import { Input } from './ph/input'
import { Field } from './ph/field'
import { Badge } from './ph/badge'
import { Glider } from './ph/glider'
import { useEffect, useRef, useState } from 'react'
import { ConnectionBadge, Spinner, aboutMinutes, aheadName, api, fmt, hackerToken, span, useLive, useTick, waitMs } from '../lib/live'
import { ShareBox } from '../lib/vdo'
import { loadNoShare, saveNoShare, waitingCopy } from './waiting'
import { StatsButton, useStatsToggle } from '../lib/stats'
import { DitheredSoup } from './DitheredSoup'
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

export default function Hacker() {
  const { state, online, apply, now, react, notice } = useLive('hacker')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', project: '' })
  const [shareState, setShareState] = useState<ShareState>('not_shared')
  const reported = useRef<ShareState>('not_shared')
  const shareFn = useRef<(() => void) | null>(null) // ShareBox's share(), so Start presenting can open the picker (or camera)
  const wantReady = useRef(false) // Start Presenting opened the picker: go live once that share connects. Never set by sharing alone.
  const stats = useStatsToggle()
  useTick()

  const token = hackerToken()
  // Chose to join the line without sharing (the server queues them either way). Kept per token across refreshes.
  const [noShare, setNoShareState] = useState(() => loadNoShare(token))
  const setNoShare = (on: boolean) => { saveNoShare(token, on); setNoShareState(on) }
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
  // Each publish (incl. Change window / Flip camera, where the state stays 'sharing') bumps the server's share epoch so the
  // projector remounts its viewer. Marks 'sharing' as reported so the effect above doesn't send it twice; still ahead of Ready in the chain.
  const published = () => { reported.current = 'sharing'; act('/share-state', { state: 'sharing' }) }
  useEffect(() => { if (!active) { reported.current = 'not_shared'; setShareState('not_shared') } }, [active])
  // Cleared once out of the line (leave, end, removed; not before the first state arrives) or once sharing.
  useEffect(() => { if ((state && !active) || shareState === 'sharing') setNoShare(false) }, [!!state, active, shareState])
  // Being called never starts the clock by itself: walking up takes a while, so the presenter presses Start Presenting.
  // Only when that press opened the picker do we go live as the share connects, after the share-state report above
  // (requests run in click order), so the server has seen 'sharing' before Ready. Cleared when the call ends.
  useEffect(() => {
    if (me?.status !== 'called') wantReady.current = false
    else if (wantReady.current && shareState === 'sharing') { wantReady.current = false; act('/ready') }
  }, [shareState, me?.status])
  const start = () => {
    if (shareState === 'sharing') return act('/ready')
    // Opens the picker (or camera); the effect above goes live once it connects.
    // No share possible here (unsupported browser): start without one.
    if (noShare || !canShare) act('/ready', { noShare: true })
    else { wantReady.current = true; shareFn.current?.() }
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

  if (!state) return <Shell><ConnectionBadge online={online} /><p className="flex items-center justify-center gap-3 text-xl"><Spinner className="size-5" />Loading…</p></Shell>

  // The server keeps a presenter live for a save window (GRACE_MS) past the deadline: say so, keep sharing, end nothing here.
  const timeUp = me?.status === 'live' && cur?.pausedLeft == null && msTotal !== null && msTotal <= 0

  const plain = (text: string) => <h1 className="ph-headline text-center text-[36px] leading-9">{text}</h1>
  let body, fg = '--border', green = false, top = 'pt-[155px]'
  if (!state.session) body = plain('No checkpoint is running.')
  else if (!open) body = plain('This checkpoint has ended.')
  else if (me?.status === 'removed') body = plain('You were removed from the queue.')
  else if (me?.status === 'done' && presentedHere.current && !thanked) {
    body = (
      <div className="space-y-6">
        {plain('Thanks for presenting!')}
        <Button className="w-full" onClick={() => setThanked(true)}>Join again</Button>
      </div>
    )
  }
  else if (!active) {
    fg = '--ph-purple'; top = 'pt-[210px]'
    body = (
      <form className="flex flex-col gap-6" onSubmit={(e) => {
        e.preventDefault(); setError('')
        act('/join', form)
      }}>
        {plain('Join the Checkpoint')}
        <div className="flex flex-col gap-4">
          <Field label="Your Name" htmlFor="hacker-name"><Input id="hacker-name" required maxLength={60} placeholder="Ada Lovelace" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Project Name" htmlFor="hacker-project"><Input id="hacker-project" required maxLength={80} placeholder="Pixel garden" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} /></Field>
        </div>
        <div className="flex flex-col gap-2.5">
          <Button variant="solid" size="lg" className="w-full" type="submit" disabled={pending > 0}>{pending > 0 && <Spinner />}Present</Button>
          <p className="text-xs text-foreground">Note: You get {span(state.session!.limitSec)} to present</p>
        </div>
      </form>
    )
  } else {
    const sharing = shareState === 'sharing'
    const called = me.status === 'called', live = me.status === 'live'
    if (live) fg = '--ph-purple'
    if (called) green = true
    const what = phone ? 'camera' : 'screen'
    const inLine = sharing || noShare
    const waiting = me.status === 'waiting'
      ? waitingCopy({ position: me.position, sharing, noShare, what, wait: aboutMinutes(waitMs(state, me.position - 1, now())), ahead: aheadName(state, me.position) })
      : null
    const title = live ? 'You’re live' : called ? 'It’s your turn!' : waiting?.title ?? ''
    const sub = live ? (msTotal === null ? '' : timeUp ? 'Time’s up' : `${fmt(msTotal).replace(/^0/, '')} left`) : waiting?.sub ?? ''
    const size = called || live ? 'lg' : 'md'
    body = (
      <div className="flex flex-col items-center gap-6">
        <div className="flex w-full flex-col items-center gap-2">
          <h1 className="ph-headline w-full text-center text-[36px] leading-9">{title}</h1>
          {sub && <p className="text-center text-xl leading-normal text-foreground">{sub}</p>}
        </div>
        {called && noShare && !sharing ? null : canShare ? (
          <ShareBox streamId={me.streamId} label={me.name} live={live} quality={state.session!.quality} stats={stats.on} onCloseStats={stats.toggle} onState={setShareState} onPublished={published} shareRef={shareFn} hideShare={called} camera={phone} />
        ) : (
          <p className="w-full border border-border bg-background p-3 text-center text-xs text-ph-yellow">{phone ? 'No camera access in this browser.' : 'Screen sharing needs Chrome or Edge.'}</p>
        )}
        <div className="flex w-full flex-col items-center gap-3">
          {called && <DitherButton disabled={pending > 0} style={{ width: '100%' }} onClick={start}>{pending > 0 && <Spinner className="size-5" />}Start Presenting</DitherButton>}
          {/* Join the line without sharing (talk-only, or a browser that can't share); Start Presenting then goes straight live. */}
          {!live && !sharing && (!called || noShare) && <Button variant="outline" size={size} className="w-full" aria-pressed={noShare} icon={noShare ? 'check' : undefined}
            onClick={() => setNoShare(!noShare)}>{noShare ? 'Presenting without sharing' : 'Present without sharing'}</Button>}
          {/* Called without having chosen: take the stage with no share from this page. */}
          {called && !sharing && !noShare && <Button variant="lime-outline" size={size} className="w-full"
            onClick={() => confirm('Start your time without sharing here?') && act('/ready', { noShare: true })}>Present without sharing</Button>}
          {!live && sharing && !called && <Button variant="outline" size={size} className="w-full" onClick={() => shareFn.current?.()}>Change {phone ? 'Camera' : 'Screen'}</Button>}
          {live && <Button variant="orange" size={size} className="w-full" onClick={() => act('/end')}>End checkpoint</Button>}
          {!live && <Button variant="link" className="self-start" style={inLine || called ? undefined : { alignSelf: 'center' }} onClick={() => confirm('Leave the queue?') && act('/leave')}>{inLine || called ? 'Leave queue' : 'Exit'}</Button>}
        </div>
        {me.status === 'waiting' && state.session!.reactions && <div className="w-full"><ReactionPanel react={react} notice={notice} /></div>}
      </div>
    )
  }

  return (
    <Shell fg={fg} green={green} top={top}>
      <ConnectionBadge online={online} />
      {active && canShare && <StatsButton onClick={stats.toggle} className="fixed bottom-3 left-3" />}
      {pending > 0 && <Badge color="outline" className="late fixed bottom-3 right-3 z-50 bg-background"><Spinner />Working…</Badge>}
      {body}
      {error && <p className="mt-3 text-center text-sm text-ph-pink">{error}</p>}
    </Shell>
  )
}

function Shell({ children, fg = '--border', green = false, top = 'pt-[155px]' }: { children: React.ReactNode; fg?: string; green?: boolean; top?: string }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background font-sans text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <DitheredSoup fgColor={getComputedStyle(document.documentElement).getPropertyValue(fg).trim()} />
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(0deg, var(--background) 50%, transparent 100%)' }} />
        {green && <div className="absolute inset-0 bg-ph-lime/50 mix-blend-color-dodge" />}
      </div>
      <a href="/" aria-label="Checkpoints home" className="absolute left-6 top-6 z-10 block transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none"><Glider className="text-ph-yellow" /></a>
      <div className={`relative mx-auto w-full max-w-[538px] px-4 pb-10 ${top}`}>{children}</div>
    </main>
  )
}
