import { useEffect, useState } from 'react'
import { Badge, Spinner, aboutMin, api, fmt, signInUrl, signOutUrl, useLive, useTick, useUser, waitMs } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { StatsButton, StatsOverlay, useRemoteStats, useStatsToggle } from '../lib/stats'
import { DitheredSoup } from './DitheredSoup'
import { GRACE_MS, QUALITY, type Quality } from '../../shared/types'

const pill = 'border border-[#555] bg-[#2a2a2a] px-[10px] py-[5px] text-[12px] text-[#ddd] rounded-[4px]'
const box = 'rounded-[3px] border border-[#444] bg-[#222] px-2 py-1 font-mono text-[13px] text-white'
const orangeBtn = 'flex h-[36px] w-[67.636px] items-center justify-center bg-[#ff9300] font-mono text-[17.455px] font-semibold tracking-[-0.8727px] text-black disabled:opacity-40'
const outlineBtn = 'flex h-[36px] w-[67.636px] items-center justify-center border-[1.2px] border-white bg-black font-mono text-[17.455px] font-semibold tracking-[-0.8727px] text-white'
const link = 'text-[12px] underline'

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black font-sans text-white">
      <DitheredSoup fgColor="#897309" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,#000_50%,rgba(0,0,0,.9)_65%,rgba(40,40,40,.6)_82%,rgba(102,102,102,0)_100%)]" />
      <header className="absolute left-6 top-6 flex items-center gap-[10px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
        <img src="/glider.svg" alt="" width={24} height={24} />
        <span className="font-pixel text-[19px]"><i className="font-sans text-[20.188px]">H</i>ACK N<i className="font-sans text-[20.188px]">I</i>GHT Checkpoints Admin</span>
      </header>
      <main className="relative flex flex-col items-center px-4 pb-16 pt-[142px]">
        {title && <h1 className="mb-[10px] w-full max-w-[933px] text-[36px] [text-shadow:0_4px_4px_rgba(0,0,0,0.46)]">{title}</h1>}
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
          <h1 className="text-[36px] [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">Sign in</h1>
          {user && !denied ? (
            <>
              <p className="text-center text-[#ccc]">Signed in as <b>{user.name}</b>, which isn't an organizer account. Ask an ID admin for the organizer role, then sign in again.</p>
              <a href={signOutUrl()} className="block w-full bg-white px-3 py-[10px] text-center font-mono text-base font-semibold tracking-[-0.8px] text-black">Sign out</a>
            </>
          ) : (
            <>
              {denied && <p className="text-[#ccc]">Your session ended. Sign in again.</p>}
              {authMode === 'password' ? <PasswordSignIn /> :
                <a href={signInUrl()} className="block w-full bg-white px-3 py-[10px] text-center font-mono text-base font-semibold tracking-[-0.8px] text-black">Sign in with Purdue Hackers</a>}
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
        <span>Password</span>
        <input type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} className="block w-full border border-[#555] bg-black p-3 font-sans text-white" />
      </label>
      {error && <p role="alert" className="text-ph-pink">{error}</p>}
      <button type="submit" disabled={busy} className="w-full bg-white px-3 py-[10px] text-center font-mono text-base font-semibold tracking-[-0.8px] text-black active:scale-[0.97] disabled:opacity-50">
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
          <div className="relative h-[418px] overflow-y-auto border border-[#4d4d4d] bg-black p-[15px]">
            <p className="font-pixel text-[19px]">Queue</p>
            <p className="mt-1 text-[13px] text-[#888]">{open && state.queue.length > 0 ? `${state.queue.length} waiting · through the line in ${aboutMin(waitMs(state, state.queue.length, now()))}` : !s ? 'No session yet.' : !open ? 'Session ended.' : 'Queue is empty.'}</p>
            <ol className="mt-5 space-y-1">
              {state.queue.map((e, i) => (
                <li key={e.id} className="flex items-center justify-between gap-2 bg-[#202020] p-2">
                  <div className="min-w-0 whitespace-nowrap">
                    <div className="flex items-center gap-[6px] text-[13px]"><b className="font-medium">{e.name}</b><span className="truncate text-[#aaa]">{e.project}</span></div>
                    <div className="text-[11px] text-[#777]">{e.connected ? SHARE_LABEL[e.shareState] : <span className="dots text-amber-400">disconnected</span>}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-[10px]">
                    <button className={`${link} text-[#aaa]`} onClick={() => { setPinned(true); setPreview(e.streamId!) }}>Preview</button>
                    <button className={`${link} text-[#aaa]`} onClick={() => act('/skip', { id: e.id })}>Skip</button>
                    <button className={`${link} text-[#c0392b]`} onClick={() => act('/remove', { id: e.id }).then(() => setUndo({ id: e.id, name: e.name }))}>Remove</button>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button disabled={i === 0} aria-label="Move up" className="disabled:opacity-30" onClick={() => act('/move', { id: e.id, dir: -1 })}><img src="/arrow-up.svg" alt="" width={16} height={16} /></button>
                    <button disabled={i === state.queue.length - 1} aria-label="Move down" className="disabled:opacity-30" onClick={() => act('/move', { id: e.id, dir: 1 })}><img src="/arrow-down.svg" alt="" width={16} height={16} /></button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex items-center gap-4">
            {open ? <button className="h-[50px] flex-1 bg-[#ff9300] font-mono text-[20.971px] font-semibold tracking-[-1.0486px] text-black" onClick={() => confirm('End checkpoints?') && act('/session/end')}>End checkpoint</button>
                  : <button className="h-[50px] flex-1 bg-[#a5e209] font-mono text-[20.971px] font-semibold tracking-[-1.0486px] text-black" onClick={() => act('/session/start')}>Start checkpoint</button>}
            <button aria-label="Settings" className="grid size-[50px] place-items-center border border-white bg-white" onClick={() => setCog(!cog)}><img src="/cog.svg" alt="" width={36} height={36} /></button>
          </div>
        </div>
        <div className="flex w-[506px] max-w-full flex-col gap-6">
          <div className="relative h-[322px] border border-[#4d4d4d] bg-black">
            {preview ? <ViewFrame key={`${preview}:${preview_?.shareEpoch ?? 0}`} streamId={preview} className="absolute inset-0 size-full bg-black" /> : null}
            <StatsButton onClick={stats.toggle} className="ph-subheadline absolute bottom-[15px] right-[15px] border border-border bg-black text-white transition-transform duration-150 active:scale-[0.97]" />
            {busy && <span className="absolute left-[15px] top-[15px] text-white"><Spinner /></span>}
            <span className="pointer-events-none absolute right-[15px] top-[15px] font-pixel text-[19px] text-[#757575]">Preview{pinned && ' · '}</span>
            {pinned && <button className="absolute right-[15px] top-[40px] text-[12px] text-[#aaa] underline" onClick={() => setPinned(false)}>follow next</button>}
          </div>
          <div className={`relative h-[146px] border bg-black ${c ? 'border-[#ff9300]' : 'border-[#4d4d4d]'}`}>
            {c && (<>
              <div className="absolute left-[15px] top-[15px] w-[260px] font-pixel text-[19px]">
                <p className="truncate">{c.name}</p>
                <p className="mt-1 truncate text-[#ababab]">{c.project}</p>
                {c.streamId && <button className="ph-subheadline mt-1 border border-border px-2 text-[11px] text-ph-yellow transition-transform duration-150 active:scale-[0.97]" onClick={() => { setPinned(true); setPreview(c.streamId!) }}>Preview · {SHARE_LABEL[c.shareState]}</button>}
              </div>
              <div className="absolute right-[15px] top-[15px] text-right font-pixel text-[19px] text-[#ff9300]">
                {c.away ? <span className="dots">disconnected</span> : c.status === 'live' ? 'Live' : 'Getting ready'}
                {left != null && <div className={`tabular-nums ${c.pausedLeft != null ? 'text-[#757575]' : ''}`}>{c.pausedLeft != null && '⏸ '}{fmt(left)}</div>}
              </div>
              <div className="absolute bottom-[15px] left-[15px] flex items-center gap-[9.6px]">
                {c.status === 'called' && <button className={orangeBtn} onClick={() => act('/ready', { id: c.entryId })}>Start</button>}
                {c.status === 'called' && <button className={outlineBtn} onClick={() => act('/skip', { id: c.entryId })}>Skip</button>}
                <button className={orangeBtn} onClick={() => act('/stop', { id: c.entryId })}>Stop</button>
                {c.status === 'live' && <>
                  <button className="flex h-[36px] w-[67.636px] items-center justify-center bg-white font-mono text-[17.455px] font-semibold tracking-[-0.8727px] text-black" onClick={() => act(c.pausedLeft != null ? '/resume' : '/pause', { id: c.entryId })}>{c.pausedLeft != null ? 'Resume' : 'Pause'}</button>
                  <button className={outlineBtn} onClick={() => act('/adjust', { id: c.entryId, delta: 15 })}>+15s</button>
                  <button className={outlineBtn} onClick={() => act('/adjust', { id: c.entryId, delta: 30 })}>+30s</button>
                </>}
              </div>
              {/* Save window: time ran out but the server keeps them live for GRACE_MS. Add time to bring them back. */}
              {c.pausedLeft == null && c.deadline != null && c.deadline <= now() && <span className="absolute bottom-[15px] right-[15px] bg-red-600 px-2 py-1 text-xs font-semibold">Time's up · ends in {Math.max(0, Math.ceil((c.deadline + GRACE_MS - now()) / 1000))}s. Add time to keep them</span>}
            </>)}
          </div>
        </div>
      </fieldset>
      {error && <p className="mt-4 w-[933px] max-w-full text-[#c0392b]">{error}</p>}
      {cog && (
        <fieldset disabled={busy} className="mt-6 flex w-[933px] max-w-full flex-col items-start gap-4 border-0 bg-black/60 p-0 font-sans">
          <p className="flex items-center gap-1 text-[13px] text-[#ccc]">Hello, <b>{name}</b><span className="text-[#666]"> · </span><a href={signOutUrl()} className="underline">Sign out</a></p>
          {open && <>
            <div className="flex flex-wrap items-center gap-4">
              <button className="rounded-[4px] bg-[#c0392b] px-[14px] py-2 font-mono text-[13px] font-semibold tracking-[-0.65px] text-white" onClick={() => confirm('End checkpoints?') && act('/session/end')}>End checkpoints</button>
              <label className="flex items-center gap-2 text-[13px] text-[#aaa]">Limit (s) <input type="number" key={s!.limitSec} defaultValue={s!.limitSec} min={10} className={`${box} w-20`} onBlur={(e) => Number(e.target.value) !== s!.limitSec && act('/limit', { seconds: Number(e.target.value) })} /></label>
              <label className="flex items-center gap-2 text-[13px] text-[#aaa]">Quality <select value={s!.quality} onChange={(e) => act('/quality', { quality: e.target.value as Quality })} className={box}>
                {Object.keys(QUALITY).map((q) => <option key={q} value={q}>{q === 'source' ? 'Source' : q}</option>)}
              </select></label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className={`${pill} ${s!.audio ? '' : 'border-[#c0392b]'}`} onClick={() => act('/audio', { on: !s!.audio })}>Projector sound: {s!.audio ? 'On' : 'Off'}</button>
              <button className={`${pill} ${s!.reactions ? '' : 'border-[#c0392b]'}`} onClick={() => act('/reactions', { on: !s!.reactions })}>Reactions: {s!.reactions ? 'On' : 'Off'}</button>
            </div>
            <p className="text-[13px] text-[#777]">Ends by itself after 10 minutes with nothing happening, or 5 minutes with no organizer page open.</p>
          </>}
        </fieldset>
      )}
      {undo && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 bg-[#202020] px-4 py-2 text-[13px] shadow-lg">
          Removed {undo.name}.
          <button className="font-semibold text-[#ff9300] underline" onClick={() => { act('/unremove', { id: undo.id }); setUndo(null) }}>Undo</button>
        </div>
      )}
    </Shell>
  )
}
