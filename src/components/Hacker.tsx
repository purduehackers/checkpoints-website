import { useEffect, useRef, useState } from 'react'
import { Badge, api, beep, fmt, hackerToken, useLive, useTick } from '../lib/live'
import { ShareBox } from '../lib/vdo'
import type { ShareState } from '../../shared/types'

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`
const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

function alertMe(title: string, body: string, beeps: number) {
  beep(beeps)
  try { if (document.hidden && Notification.permission === 'granted') new Notification(title, { body }) } catch {}
}

export default function Hacker() {
  const { state, online, apply, now } = useLive('hacker')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', project: '' })
  const [shareState, setShareState] = useState<ShareState>('not_shared')
  const reported = useRef<ShareState>('not_shared')
  useTick()

  const token = hackerToken()
  const act = (path: string, body: object = {}) =>
    api(path, { token, ...body }).then(apply).catch((e) => setError(e.message))

  const me = state?.me
  const cur = state?.current?.entryId === me?.entryId ? state?.current : null
  const active = me && ['waiting', 'called', 'live'].includes(me.status)
  const open = state?.session?.status === 'open'

  // Report the share state to the server, only when it changes.
  useEffect(() => {
    if (active && shareState !== reported.current) { reported.current = shareState; act('/share-state', { state: shareState }) }
  }, [shareState, active])
  useEffect(() => { if (!active) { reported.current = 'not_shared'; setShareState('not_shared') } }, [active])

  // US-4.1 / 4.2 alerts
  const key = me ? `${me.status}:${me.position}` : ''
  useEffect(() => {
    if (me?.status === 'waiting' && me.position === 1) alertMe("You're up next!", 'Get your screen ready.', 1)
    if (me?.status === 'called') alertMe("It's your turn!", 'Walk up and press Ready.', 3)
  }, [key])
  useEffect(() => {
    document.title = me?.status === 'called' ? "It's your turn! · Checkpoints" : me?.status === 'waiting' && me.position === 1 ? "You're up next! · Checkpoints" : 'Checkpoints'
  }, [key])

  if (!state) return <Shell><Badge online={online} /><p>Loading…</p></Shell>

  const msTotal = cur?.deadline ? cur.deadline - now() : null
  const countdown = me?.status === 'live' && msTotal !== null && msTotal <= 15_000

  let body
  if (!state.session) body = <p className="text-xl">No checkpoint is running.</p>
  else if (!open) body = <p className="text-xl">This checkpoint has ended.</p>
  else if (me?.status === 'removed') body = <p className="text-xl">You were removed from the queue.</p>
  else if (me?.status === 'done') body = <p className="text-xl">Thanks for presenting!</p>
  else if (!active) {
    body = (
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault(); setError('')
        try { Notification.requestPermission() } catch {}
        act('/join', form)
      }}>
        <h1 className="text-2xl font-semibold">Join the checkpoint</h1>
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
        {me.status === 'live' && (
          <div>
            <h1 className="text-3xl font-semibold">You're live</h1>
            {msTotal !== null && <p className="text-neutral-400">{fmt(msTotal)} left</p>}
          </div>
        )}
        {canShare ? (
          <ShareBox streamId={me.streamId} label={me.name} onState={setShareState} />
        ) : (
          <p className="rounded bg-neutral-800 p-3 text-sm">Use a laptop to share your screen. You can still wait here.</p>
        )}
        {me.status === 'live' && <button className="rounded bg-red-600 px-4 py-2" onClick={() => act('/end')}>End my checkpoint</button>}
        {me.status !== 'live' && <button className="text-sm text-neutral-400 underline" onClick={() => confirm('Leave the queue?') && act('/leave')}>Leave queue</button>}
      </div>
    )
  }

  return (
    <Shell>
      <Badge online={online} />
      {countdown && <div className="fixed left-3 top-3 z-40 rounded bg-red-600 px-3 py-1 text-2xl font-bold tabular-nums">{fmt(msTotal!)}</div>}
      {body}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {me?.status === 'called' && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/95">
          <p className="text-2xl">Walk to the podium</p>
          <button className="rounded-lg bg-green-500 px-12 py-6 text-4xl font-bold text-black" onClick={() => act('/ready')}>Ready</button>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen p-6"><div className="mx-auto max-w-2xl">{children}</div></main>
}
