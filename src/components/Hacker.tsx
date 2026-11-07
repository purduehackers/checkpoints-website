import { useEffect, useRef, useState } from 'react'
import { Badge, Spinner, aboutMinutes, aheadName, api, fmt, hackerToken, ordinal, span, useLive, useTick, waitMs } from '../lib/live'
import { ShareBox } from '../lib/vdo'
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
  const autoReady = useRef(false) // /ready already sent for this call: a re-render or a share restart must not send it twice
  const stats = useStatsToggle()
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
  // Each publish (incl. Change window / Flip camera, where the state stays 'sharing') bumps the server's share epoch so the
  // projector remounts its viewer. Marks 'sharing' as reported so the effect above doesn't send it twice; still ahead of auto-Ready in the chain.
  const published = () => { reported.current = 'sharing'; act('/share-state', { state: 'sharing' }) }
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

  if (!state) return <Shell><Badge online={online} /><p className="flex items-center justify-center gap-3 text-xl"><Spinner className="size-5" />Loading…</p></Shell>

  // The server keeps a presenter live for a save window (GRACE_MS) past the deadline: say so, keep sharing, end nothing here.
  const timeUp = me?.status === 'live' && cur?.pausedLeft == null && msTotal !== null && msTotal <= 0

  const plain = (text: string) => <h1 className="text-center text-[36px] leading-[normal] [text-shadow:0_1px_2px_rgba(0,0,0,.35)]">{text}</h1>
  const link = 'text-xs text-[#929292] underline'
  let body, fg = '#2e2e2e', green = false, top = 'pt-[155px]'
  if (!state.session) body = plain('No checkpoint is running.')
  else if (!open) body = plain('This checkpoint has ended.')
  else if (me?.status === 'removed') body = plain('You were removed from the queue.')
  else if (me?.status === 'done' && presentedHere.current && !thanked) {
    body = (
      <div className="space-y-6">
        {plain('Thanks for presenting!')}
        <button className={`${BTN} w-full bg-white text-black`} onClick={() => setThanked(true)}>Join again</button>
      </div>
    )
  }
  else if (!active) {
    fg = '#8837ff'; top = 'pt-[210px]'
    body = (
      <form className="flex flex-col gap-6" onSubmit={(e) => {
        e.preventDefault(); setError('')
        act('/join', form)
      }}>
        {plain('Join the Checkpoint')}
        <div className="flex flex-col gap-4">
          <input required maxLength={60} placeholder="Your Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
          <input required maxLength={80} placeholder="Project Name" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} className={INPUT} />
        </div>
        <div className="flex flex-col gap-2.5">
          <button disabled={pending > 0} className={`${BTN} w-full gap-2 bg-white text-black disabled:opacity-70`}>{pending > 0 && <Spinner />}Present</button>
          <p className="text-xs text-[#929292]">Note: You get {span(state.session!.limitSec)} to present</p>
        </div>
      </form>
    )
  } else {
    const sharing = shareState === 'sharing'
    const called = me.status === 'called', live = me.status === 'live'
    if (live) fg = '#8837ff'
    if (called) green = true
    const what = phone ? 'camera' : 'screen'
    const title = live ? 'You’re live' : called ? 'It’s your turn!' : me.position === 1 ? 'You’re up next!' : sharing ? `You’re ${ordinal(me.position)} in line` : `Share your ${what}`
    const ahead = me.status === 'waiting' ? aheadName(state, me.position) : ''
    const sub = live ? (msTotal === null ? '' : timeUp ? 'Time’s up' : `${fmt(msTotal).replace(/^0/, '')} left`)
      : me.status === 'waiting' ? (sharing || me.position === 1 ? `Up in ${aboutMinutes(waitMs(state, me.position - 1, now()))}${ahead ? ` ⊹ You’re after ${ahead}` : ''}` : `Join the queue by sharing your ${what}`) : ''
    const big = called || live
    const btn = `${BTN} w-full ${big ? 'h-[50px] text-[20.971px] tracking-[-1.0486px]' : ''}`
    body = (
      <div className="flex flex-col items-center gap-6">
        <div className="flex w-full flex-col items-center gap-2">
          <h1 className={`w-full text-center text-[36px] leading-[normal] ${live ? '[text-shadow:0_4px_4px_rgba(0,0,0,.5)]' : '[text-shadow:0_1px_2px_rgba(0,0,0,.35)]'}`}>{title}</h1>
          {sub && <p className="text-xl leading-[normal] text-[#a4a4a4]">{sub}</p>}
        </div>
        {canShare ? (
          <ShareBox streamId={me.streamId} label={me.name} live={live} quality={state.session!.quality} stats={stats.on} onCloseStats={stats.toggle} onState={setShareState} onPublished={published} shareRef={shareFn} hideShare={called} camera={phone} />
        ) : (
          <p className="w-full border border-[#4d4d4d] bg-black p-3 text-center text-xs text-[#ff9300]">{phone ? 'No camera access in this browser.' : 'Screen sharing needs Chrome or Edge.'}</p>
        )}
        <div className="flex w-full flex-col items-center gap-3">
          {called && <button disabled={pending > 0} className={`${btn} gap-3 bg-[#a5e209] text-black disabled:opacity-70`} onClick={start}>{pending > 0 && <Spinner className="size-5" />}Start Presenting</button>}
          {/* Take the stage with no share from this page: talk-only, or a browser that can't share. Ready only works once called. */}
          {!live && !sharing && <button disabled={!called} className={`${btn} border ${called ? 'border-[#a5e209] text-[#a5e209]' : 'border-white text-white disabled:opacity-50'}`}
            onClick={() => confirm('Start your time without sharing here?') && act('/ready', { noShare: true })}>Present without sharing</button>}
          {!live && sharing && !called && <button className={`${btn} border border-white text-white`} onClick={() => shareFn.current?.()}>Change {phone ? 'Camera' : 'Screen'}</button>}
          {live && <button className={`${btn} bg-[#ff9300] text-black`} onClick={() => act('/end')}>End checkpoint</button>}
          {!live && <button className={`${link} self-start`} style={sharing || called ? undefined : { alignSelf: 'center' }} onClick={() => confirm('Leave the queue?') && act('/leave')}>{sharing || called ? 'Leave queue' : 'Exit'}</button>}
        </div>
        {me.status === 'waiting' && state.session!.reactions && <div className="w-full"><ReactionPanel react={react} notice={notice} /></div>}
      </div>
    )
  }

  return (
    <Shell fg={fg} green={green} top={top}>
      <Badge online={online} />
      {active && canShare && <StatsButton onClick={stats.toggle} className="fixed bottom-3 left-3" />}
      {pending > 0 && <div className="late fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded bg-neutral-800 px-3 py-1 text-sm"><Spinner />Working…</div>}
      {body}
      {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
    </Shell>
  )
}

const BTN = "flex items-center justify-center px-3 py-2.5 font-['Inconsolata',ui-monospace,monospace] text-base font-semibold tracking-[-0.8px] disabled:cursor-not-allowed"
const INPUT = 'w-full border border-[#4d4d4d] bg-black px-3 py-2.5 text-base text-white placeholder:text-[#929292] focus:border-white focus:outline-none'

function Shell({ children, fg = '#2e2e2e', green = false, top = 'pt-[155px]' }: { children: React.ReactNode; fg?: string; green?: boolean; top?: string }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <DitheredSoup fgColor={fg} />
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(0deg, #000 50%, rgba(102,102,102,0) 100%)' }} />
        {green && <div className="absolute inset-0 bg-[rgba(165,226,9,0.5)] mix-blend-color-dodge" />}
      </div>
      <div className="absolute left-6 top-6 z-10 flex items-center gap-2.5 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,.35))]">
        <img src="/glider.svg" alt="" width={24} height={24} />
        <p className="font-pixel text-[19px] whitespace-nowrap"><i className="font-sans text-[20px]">H</i>ACK N<i className="font-sans text-[20px]">I</i>GHT Checkpoints</p>
      </div>
      <div className={`relative mx-auto w-[506px] max-w-full px-4 pb-10 sm:px-0 ${top}`}>{children}</div>
    </main>
  )
}
