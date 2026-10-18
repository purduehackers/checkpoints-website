import { useEffect, useRef, useState } from 'react'
import { Badge, api, fmt, hackerToken, useLive, useTick } from '../lib/live'
import { ShareBox } from '../lib/vdo'
import { StatsButton, useStatsToggle } from '../lib/stats'
import type { ShareState } from '../../shared/types'

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`
const span = (sec: number) => sec % 60 ? `${sec} seconds` : `${sec / 60} minute${sec === 60 ? '' : 's'}`
// Phones can't screen share from a browser (Android Chrome may still expose getDisplayMedia, so check the device too).
// iPadOS reports itself as a Mac; touch points give it away.
const phone = typeof navigator !== 'undefined' &&
  (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
const canShare = !phone && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

// Phones get a joke instead of the line: they can't share a screen. /host and /admin still work for watching.
function PhoneNote() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
      <h1 className="text-4xl">Phone is too small</h1>
      <a href="https://www.amazon.com/s?k=computer+monitor" target="_blank" rel="noopener noreferrer"
        className="rounded-lg bg-amber-500 px-6 py-3 text-lg font-semibold text-black">Buy a screen</a>
    </div>
  )
}

export default function Hacker() {
  const { state, online, apply, now } = useLive('hacker')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', project: '' })
  const [shareState, setShareState] = useState<ShareState>('not_shared')
  const reported = useRef<ShareState>('not_shared')
  const shareFn = useRef<(() => void) | null>(null) // ShareBox's share(), so Start presenting can open the picker
  const startOnShare = useRef(false) // Start presenting was pressed before sharing: go live as soon as the share connects
  const stats = useStatsToggle()
  useTick()

  const token = hackerToken()
  // One request at a time, in click order: a late share-state must not land after Ready, nor an old reply overwrite a newer one.
  const chain = useRef(Promise.resolve())
  const act = (path: string, body: object = {}) =>
    (chain.current = chain.current.then(() => api(path, { token, ...body }).then(apply).catch((e) => setError(e.message))))

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
  // After the share-state report above (requests run in click order), so the server has seen 'sharing' before Ready.
  useEffect(() => {
    if (me?.status !== 'called') startOnShare.current = false
    else if (shareState === 'sharing' && startOnShare.current) { startOnShare.current = false; act('/ready') }
  }, [shareState, me?.status])
  const start = () => shareState === 'sharing' ? act('/ready') : !canShare ? act('/ready', { noShare: true }) : (startOnShare.current = true, shareFn.current?.())

  // US-4.1 / 4.2 alerts: tab title + the "up next" banner. No browser notifications: the prompt confused people at join.
  const key = me ? `${me.status}:${me.position}` : ''
  useEffect(() => {
    document.title = me?.status === 'called' ? "It's your turn! · Checkpoints" : me?.status === 'waiting' && me.position === 1 ? "You're up next! · Checkpoints" : 'Checkpoints'
  }, [key])

  // Closing the tab takes you out of the line. beforeunload only asks (it also fires on refresh, which is fine);
  // pagehide tells the server, which waits 15s so a refresh (new socket) or a Wi-Fi blip (no pagehide) keeps the spot.
  useEffect(() => {
    if (!active) return
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const bye = () => navigator.sendBeacon?.('/api/bye', new Blob([JSON.stringify({ token })], { type: 'application/json' }))
    addEventListener('beforeunload', ask)
    addEventListener('pagehide', bye)
    return () => { removeEventListener('beforeunload', ask); removeEventListener('pagehide', bye) }
  }, [active, token])

  if (phone) return <Shell><PhoneNote /></Shell>
  if (!state) return <Shell><Badge online={online} /><p>Loading…</p></Shell>

  const msTotal = cur?.pausedLeft ?? (cur?.deadline != null ? cur.deadline - now() : null)

  let body
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
        act('/join', form)
      }}>
        <h1 className="text-2xl font-semibold">Join the checkpoint</h1>
        <ol className="list-decimal space-y-1 rounded bg-neutral-800 p-3 pl-8 text-sm text-neutral-300">
          <li>Join the line.</li>
          <li>Share your screen while you wait. Only the organizer sees it until you're live. (Your browser will ask which screen, window or tab; that's the only permission.)</li>
          <li>When it's your turn, walk up and press Start presenting. Your time ({span(state.session!.limitSec)}) starts then.</li>
        </ol>
        <input required maxLength={60} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded bg-neutral-800 p-3" />
        <input required maxLength={80} placeholder="Project name" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} className="w-full rounded bg-neutral-800 p-3" />
        <button className="w-full rounded bg-amber-500 p-3 font-semibold text-black">Join queue</button>
      </form>
    )
  } else {
    body = (
      <div className="space-y-4">
        {me.status === 'waiting' && (
          <div className={me.position === 1 ? 'rounded-lg bg-amber-400 p-4 text-black' : ''}>
            <h1 className="text-3xl font-semibold">{me.position === 1 ? "You're up next!" : `You're ${ordinal(me.position)} in line`}</h1>
            <p className={me.position === 1 ? '' : 'text-neutral-400'}>{me.position === 1 ? 'Get your screen ready.' : `${me.position - 1} ${me.position === 2 ? 'person' : 'people'} ahead of you`}</p>
          </div>
        )}
        {/* Inline, not a full-page cover: the first in line is called automatically while still at their seat,
            so Change window and Leave queue must stay reachable. Start presenting only once sharing (it starts the clock). */}
        {me.status === 'called' && (
          <div className="space-y-3 rounded-lg bg-green-500 p-4 text-black">
            <h1 className="text-3xl font-semibold">It's your turn!</h1>
            <p>Walk to the podium, then press Start presenting. Your time starts then, not before.</p>
            <button className="w-full rounded-lg bg-black px-6 py-4 text-2xl font-bold text-green-400" onClick={start}>Start presenting</button>
          </div>
        )}
        {me.status === 'live' && (
          <div>
            <h1 className="text-3xl font-semibold">You're live</h1>
            {msTotal !== null && <p className="text-neutral-400">{fmt(msTotal)} left</p>}
          </div>
        )}
        {canShare ? (
          <ShareBox streamId={me.streamId} label={me.name} live={me.status === 'live'} quality={state.session!.quality} stats={stats.on} onCloseStats={stats.toggle} onState={setShareState} shareRef={shareFn} hideShare={me.status === 'called'} />
        ) : (
          <p className="rounded bg-neutral-800 p-3 text-sm">This browser can’t share a screen. Use Chrome or Edge on a laptop. You can still wait here.</p>
        )}
        {/* Take the stage with no share from this page: talk-only, a phone, or the backup share. */}
        {/* Shown while waiting too, so people find it early; Ready only works once called. */}
        {me.status !== 'live' && shareState !== 'sharing' && (
          <button disabled={me.status !== 'called'} className="w-full rounded-lg border border-green-500 px-4 py-3 font-medium text-green-400 disabled:border-neutral-700 disabled:text-neutral-500"
            onClick={() => confirm('Start your time without sharing your screen here?') && act('/ready', { noShare: true })}>
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
      {stats.menu}
      {active && canShare && <StatsButton onClick={stats.toggle} className="fixed bottom-3 left-3" />}
      {me?.status === 'live' && msTotal !== null && <div className={`fixed left-3 top-3 z-40 rounded px-3 py-1 text-xl font-bold tabular-nums ${msTotal <= 30_000 ? 'bg-red-600' : 'bg-neutral-800'}`}>{fmt(msTotal)}</div>}
      {me?.status === 'waiting' && me.position === 1 && <div className="pointer-events-none fixed inset-0 z-20 animate-pulse bg-amber-400/25" />}
      {body}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen p-6"><div className="mx-auto max-w-2xl">{children}</div></main>
}
