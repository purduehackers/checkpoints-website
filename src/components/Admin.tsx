import { useEffect, useState } from 'react'
import { Badge, Spinner, aboutMin, api, fmt, signInUrl, signOutUrl, useLive, useTick, useUser, waitMs } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { StatsButton, StatsOverlay, useRemoteStats, useStatsToggle } from '../lib/stats'
import { DitheredSoup } from './DitheredSoup'
import { GRACE_MS, QUALITY, type Quality } from '../../shared/types'

// Brand: square corners, 1px hairlines, buttons press to 0.97 (no animation under reduced motion).
const press = 'transition-transform duration-100 ease-quint active:scale-[0.97] motion-reduce:transition-none'
const btn = `ph-subheadline flex h-9 items-center justify-center px-3 text-sm ${press} disabled:opacity-40`
const solidBtn = `${btn} bg-ph-orange text-black`
const outlineBtn = `${btn} border border-white bg-black text-white`
const toggle = `ph-subheadline border border-border bg-black px-3 py-1 text-xs text-white ${press}`
const box = 'border border-border bg-black px-2 py-1 font-mono text-[13px] text-white'
const link = `text-[12px] underline ${press}`
const bigBtn = `ph-subheadline h-[50px] flex-1 text-xl text-black ${press}`

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black font-sans text-white">
      <DitheredSoup fgColor="#897309" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[40vh] bg-black" />
      <header className="absolute left-6 top-6">
        <a href="/admin" aria-label="Checkpoints Admin" className="block transition-transform active:scale-[0.97]"><img src="/glider.svg" alt="" width={24} height={24} /></a>
      </header>
      <main className="relative flex flex-col items-center px-4 pb-16 pt-[142px]">
        {title && <h1 className="ph-headline mb-[10px] w-full max-w-[933px] text-[36px]">{title}</h1>}
        {children}
      </main>
    </div>
  )
}

const SHARE_LABEL = { sharing: 'sharing', not_shared: 'not sharing', stopped: 'stopped' }

export default function Admin() {
  const auth = useUser()
  const [denied, setDenied] = useState(false)
  if (auth === undefined) return <Shell>Loading…</Shell>
  const { user, authMode } = auth
  if (!user?.organizer || denied) {
    return (
      <Shell>
        <div className="mt-[68px] flex w-[506px] max-w-full flex-col items-center gap-6">
          <h1 className="ph-headline text-[36px]">Sign in</h1>
          {user && !denied ? (
            <>
              <p className="text-center">Signed in as <b>{user.name}</b>, which isn't an organizer account. Ask an ID admin for the organizer role, then sign in again.</p>
              <a href={signOutUrl()} className={`${btn} h-auto w-full bg-white py-[10px] text-base text-black`}>Sign out</a>
            </>
          ) : (
            <>
              {denied && <p>Your session ended. Sign in again.</p>}
              {authMode === 'password' ? <PasswordSignIn /> :
                <a href={signInUrl()} className={`${btn} h-auto w-full bg-white py-[10px] text-base text-black`}>Sign in with Purdue Hackers</a>}
            </>
          )}
        </div>
      </Shell>
    )
  }
  return <Panel name={user.name} onDenied={() => setDenied(true)} />
}

function PasswordSignIn() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form className="w-full space-y-3" onSubmit={async (e) => {
      e.preventDefault()
      setBusy(true)
      setError('')
      try {
        await api('/auth/password', { password })
        location.reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed')
        setBusy(false)
      }
    }}>
      <label className="block space-y-1">
        <span className="ph-subheadline text-xs">Password</span>
        <input type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} className="block w-full border border-border bg-black p-3 font-sans text-white" />
      </label>
      {error && <p role="alert" className="text-ph-pink">{error}</p>}
      <button type="submit" disabled={busy} className={`${btn} h-auto w-full bg-white py-[10px] text-base text-black`}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

function Panel({ name, onDenied }: { name: string; onDenied: () => void }) {
  const { state, online, denied, apply, now } = useLive('admin')
  useEffect(() => { if (denied) onDenied() }, [denied])
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false) // true once the organizer picks a preview by hand
  const [busy, setBusy] = useState(false) // disables every control while a request is in flight (no double-clicks)
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null) // last Remove, undoable for 10s
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 10_000); return () => clearTimeout(t) }, [undo])
  useTick(1000)

  const act = (path: string, body?: object) => {
    setBusy(true)
    return api('/admin' + path, body)
      .then((s) => { setError(''); apply(s) })
      .catch((e) => (e.message === 'Not authorized' ? onDenied() : setError(e.message)))
      .finally(() => setBusy(false))
  }

  // US-5.3: preview the next person automatically unless the organizer chose someone else.
  const first = state?.queue[0]?.streamId ?? null
  useEffect(() => { if (!pinned) setPreview(first) }, [first, pinned])
  const [cog, setCog] = useState(false)
  const stats = useStatsToggle()
  const statsStream = preview ?? state?.current?.streamId ?? null // nobody previewed: show the presenter
  const history = useRemoteStats(statsStream, stats.on)

  if (!state) return <Shell><Badge online={online} /><Spinner className="size-5" />Loading…</Shell>
  const open = state.session?.status === 'open'
  const c = state.current

  const s = state.session
  const left = c ? c.pausedLeft ?? (c.deadline != null ? c.deadline - now() : null) : null
  const preview_ = [state.current, ...state.queue].find((e) => e?.streamId === preview)

  return (
    <Shell title="Hack Night 7.1">
      <Badge online={online} />
      {stats.on && <StatsOverlay history={history} title={statsStream && statsStream === c?.streamId ? `On stage: ${c.name}` : 'Previewed stream'} onClose={stats.toggle} />}
      <fieldset disabled={busy} className="flex w-[933px] max-w-full min-w-0 flex-wrap gap-6 border-0 p-0">
        <div className="flex w-[403px] max-w-full flex-col gap-6">
          <div className="relative h-[418px] overflow-y-auto border border-border bg-black p-[15px]">
            <h2 className="ph-headline text-[19px]">Queue</h2>
            <p className="mt-2 text-[13px]">{open && state.queue.length > 0 ? `${state.queue.length} waiting · through the line in ${aboutMin(waitMs(state, state.queue.length, now()))}` : !s ? 'No session yet.' : !open ? 'Session ended.' : 'Queue is empty.'}</p>
            <ol className="mt-5 space-y-1">
              {state.queue.map((e, i) => (
                <li key={e.id} className="flex items-center justify-between gap-2 border border-border p-2">
                  <div className="min-w-0 whitespace-nowrap">
                    <div className="flex items-center gap-[6px] text-[13px]"><b className="font-semibold">{e.name}</b><span className="truncate font-light">{e.project}</span></div>
                    <div className="ph-subheadline text-[11px]">{e.connected ? SHARE_LABEL[e.shareState] : <span className="dots text-ph-yellow">disconnected</span>}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-[10px]">
                    <button className={link} onClick={() => { setPinned(true); setPreview(e.streamId!) }}>Preview</button>
                    <button className={link} onClick={() => act('/skip', { id: e.id })}>Skip</button>
                    <button className={`${link} text-ph-pink`} onClick={() => act('/remove', { id: e.id }).then(() => setUndo({ id: e.id, name: e.name }))}>Remove</button>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button disabled={i === 0} aria-label="Move up" className={`${press} disabled:opacity-30`} onClick={() => act('/move', { id: e.id, dir: -1 })}><img src="/arrow-up.svg" alt="" width={16} height={16} /></button>
                    <button disabled={i === state.queue.length - 1} aria-label="Move down" className={`${press} disabled:opacity-30`} onClick={() => act('/move', { id: e.id, dir: 1 })}><img src="/arrow-down.svg" alt="" width={16} height={16} /></button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex items-center gap-4">
            {open ? <button className={`${bigBtn} bg-ph-orange`} onClick={() => confirm('End checkpoints?') && act('/session/end')}>End checkpoint</button>
                  : <button className={`${bigBtn} bg-ph-lime`} onClick={() => act('/session/start')}>Start checkpoint</button>}
            <button aria-label="Settings" aria-expanded={cog} className={`grid size-[50px] place-items-center border border-white bg-white ${press}`} onClick={() => setCog(!cog)}><img src="/cog.svg" alt="" width={36} height={36} /></button>
          </div>
        </div>
        <div className="flex w-[506px] max-w-full flex-col gap-6">
          <div className="relative h-[322px] border border-border bg-black">
            {preview ? <ViewFrame key={`${preview}:${preview_?.shareEpoch ?? 0}`} streamId={preview} className="absolute inset-0 size-full bg-black" /> : null}
            <StatsButton onClick={stats.toggle} className="absolute bottom-[15px] right-[15px]" />
            {busy && <span className="absolute left-[15px] top-[15px] text-white"><Spinner /></span>}
            <span className="ph-subheadline pointer-events-none absolute right-[15px] top-[15px] bg-black px-1 text-xs">Preview{pinned && ' · pinned'}</span>
            {pinned && <button className={`${link} absolute right-[15px] top-[40px] bg-black px-1`} onClick={() => setPinned(false)}>follow next</button>}
          </div>
          {/* Current presenter. Flow layout (no absolute positioning), so nothing overlaps at any width. */}
          <section aria-label="Current presenter" className={`flex min-h-[146px] flex-col gap-3 border bg-black p-[15px] ${c ? 'border-ph-orange' : 'border-border'}`}>
            {c && (<>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="ph-headline truncate text-[19px]">{c.name}</p>
                  <p className="mt-1 truncate font-light">{c.project}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="ph-subheadline text-sm text-ph-orange">{c.away ? <span className="dots">disconnected</span> : c.status === 'live' ? (c.pausedLeft != null ? 'Paused' : 'Live') : 'Getting ready'}</p>
                  {left != null && <p className="ph-headline mt-1 text-[24px] tabular-nums">{fmt(left)}</p>}
                </div>
              </div>
              {/* Save window: time ran out but the server keeps them live for GRACE_MS. Add time to bring them back. */}
              {c.pausedLeft == null && c.deadline != null && c.deadline <= now() && <p role="status" className="border border-ph-pink px-2 py-1 text-xs font-semibold text-ph-pink">Time's up · ends in {Math.max(0, Math.ceil((c.deadline + GRACE_MS - now()) / 1000))}s. Add time to keep them</p>}
              <div className="flex flex-wrap items-center gap-2">
                {c.status === 'called' && <button className={solidBtn} onClick={() => act('/ready', { id: c.entryId })}>Start</button>}
                {c.status === 'called' && <button className={outlineBtn} onClick={() => act('/skip', { id: c.entryId })}>Skip</button>}
                <button className={solidBtn} onClick={() => act('/stop', { id: c.entryId })}>Stop</button>
                {c.status === 'live' && <button className={`${btn} bg-white text-black`} onClick={() => act(c.pausedLeft != null ? '/resume' : '/pause', { id: c.entryId })}>{c.pausedLeft != null ? 'Resume' : 'Pause'}</button>}
                {/* Shown while getting ready too, so they're findable; the server only adjusts live entries. */}
                {([15, 30] as const).map((d) => (
                  <button key={d} disabled={c.status !== 'live'} title={c.status !== 'live' ? 'Available once their time starts' : undefined}
                    className={`${outlineBtn} normal-case`} onClick={() => act('/adjust', { id: c.entryId, delta: d })}>+{d}s</button>
                ))}
                {c.streamId && <button className={`ph-subheadline ml-auto border border-border px-2 py-1 text-[11px] text-ph-yellow ${press}`} onClick={() => { setPinned(true); setPreview(c.streamId!) }}>Preview · {SHARE_LABEL[c.shareState]}</button>}
              </div>
            </>)}
          </section>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-4 w-[933px] max-w-full text-ph-pink">{error}</p>}
      {cog && (
        <fieldset disabled={busy} className="mt-6 flex w-[933px] max-w-full flex-col items-start gap-4 border border-border bg-black p-[15px] font-sans">
          <p className="flex items-center gap-1 text-[13px]">Hello, <b>{name}</b> · <a href={signOutUrl()} className={link}>Sign out</a></p>
          {open && <>
            <div className="flex flex-wrap items-center gap-4">
              <button className={`${btn} border border-ph-pink bg-black text-ph-pink`} onClick={() => confirm('End checkpoints?') && act('/session/end')}>End checkpoints</button>
              <label className="ph-subheadline flex items-center gap-2 text-xs">Limit (s) <input type="number" key={s!.limitSec} defaultValue={s!.limitSec} min={10} className={`${box} w-20`} onBlur={(e) => Number(e.target.value) !== s!.limitSec && act('/limit', { seconds: Number(e.target.value) })} /></label>
              <label className="ph-subheadline flex items-center gap-2 text-xs">Quality <select value={s!.quality} onChange={(e) => act('/quality', { quality: e.target.value as Quality })} className={box}>
                {Object.keys(QUALITY).map((q) => <option key={q} value={q}>{q === 'source' ? 'Source' : q}</option>)}
              </select></label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className={`${toggle} ${s!.audio ? '' : 'border-ph-pink text-ph-pink'}`} onClick={() => act('/audio', { on: !s!.audio })}>Projector sound: {s!.audio ? 'On' : 'Off'}</button>
              <button className={`${toggle} ${s!.reactions ? '' : 'border-ph-pink text-ph-pink'}`} onClick={() => act('/reactions', { on: !s!.reactions })}>Reactions: {s!.reactions ? 'On' : 'Off'}</button>
            </div>
            <p className="text-[12px] font-light">Ends by itself after 10 minutes with nothing happening, or 5 minutes with no organizer page open.</p>
          </>}
        </fieldset>
      )}
      {undo && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 border border-border bg-black px-4 py-2 text-[13px]">
          Removed {undo.name}.
          <button className={`${link} font-semibold text-ph-yellow`} onClick={() => { act('/unremove', { id: undo.id }); setUndo(null) }}>Undo</button>
        </div>
      )}
    </Shell>
  )
}
