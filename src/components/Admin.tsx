import { useEffect, useRef, useState } from 'react'
import { ConnectionBadge, Spinner, aboutMin, api, fmt, signInUrl, signOutUrl, useLive, useTick, useUser, waitMs } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { StatsButton, StatsOverlay, useRemoteStats, useStatsToggle } from '../lib/stats'
import { DitheredSoup } from './DitheredSoup'
import { Badge } from './ph/badge'
import { Button } from './ph/button'
import { Card } from './ph/card'
import { Checkbox } from './ph/checkbox'
import { Dialog } from './ph/dialog'
import { DitherButton } from './ph/dither-button'
import { Field } from './ph/field'
import { Glider } from './ph/glider'
import { Input } from './ph/input'
import { Link } from './ph/link'
import { SegmentedToggle } from './ph/segmented-toggle'
import { GRACE_MS, QUALITY, type Quality } from '../../shared/types'

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-sans text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <DitheredSoup fgColor="#897309" />
        {/* Soft fade so the dither melts into the background instead of ending in a hard edge. */}
        <div className="absolute inset-0 bg-linear-to-t from-background from-50% to-transparent" />
      </div>
      <header className="absolute left-6 top-6">
        <a href="/admin" aria-label="Checkpoints Admin" className="block transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none"><Glider className="text-ph-yellow" /></a>
      </header>
      <main className="relative mx-auto flex w-full max-w-[965px] flex-col items-center px-4 pb-16 pt-[142px]">
        {title && <h1 className="ph-headline mb-[19px] w-full text-[36px] leading-9">{title}</h1>}
        {children}
      </main>
    </div>
  )
}

// Dither pixels are square (aspect-ratio 1) and fill the width, so cols must track the button's
// aspect or the pixels overflow the 52px height and the hover smears. 4 rows of ~13px pixels.
const DITHER_ROWS = 4
function SessionButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(26) // ~340x52, the desktop width, until measured
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      if (height) setCols(Math.max(1, Math.round((width / height) * DITHER_ROWS)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="flex flex-1">
      {/* Inline width: the registry CSS sets width: fit-content outside Tailwind's layers. */}
      <DitherButton cols={cols} rows={DITHER_ROWS} style={{ width: '100%' }} onClick={onClick}>{open ? 'End checkpoint' : 'Start checkpoint'}</DitherButton>
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
              <Button href={signOutUrl()} className="w-full">Sign out</Button>
            </>
          ) : (
            <>
              {denied && <p>Your session ended. Sign in again.</p>}
              {authMode === 'password' ? <PasswordSignIn /> :
                <Button href={signInUrl()} className="w-full">Sign in with Purdue Hackers</Button>}
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
      <Field label="Password" htmlFor="admin-password">
        <Input id="admin-password" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p role="alert" className="text-ph-pink">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
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

  if (!state) return <Shell><ConnectionBadge online={online} /><Spinner className="size-5" />Loading…</Shell>
  const open = state.session?.status === 'open'
  const c = state.current

  const s = state.session
  const left = c ? c.pausedLeft ?? (c.deadline != null ? c.deadline - now() : null) : null
  const preview_ = [state.current, ...state.queue].find((e) => e?.streamId === preview)

  return (
    <Shell title="Hack Night 7.1">
      <ConnectionBadge online={online} />
      {stats.on && <StatsOverlay history={history} title={statsStream && statsStream === c?.streamId ? `On stage: ${c.name}` : 'Previewed stream'} onClose={stats.toggle} />}
      <fieldset disabled={busy} className="grid w-full min-w-0 grid-cols-1 gap-6 border-0 p-0 min-[965px]:grid-cols-[403px_506px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="h-[418px] overflow-y-auto">
            <h2 className="ph-headline text-[19px]">Queue</h2>
            <p className="text-[13px]">{open && state.queue.length > 0 ? `${state.queue.length} waiting · through the line in ${aboutMin(waitMs(state, state.queue.length, now()))}` : !s ? 'No session yet.' : !open ? 'Session ended.' : 'Queue is empty.'}</p>
            <ol className="mt-1 space-y-1">
              {state.queue.map((e, i) => (
                <li key={e.id} className="flex min-h-[46px] flex-wrap items-center justify-between gap-2 border border-border p-2 leading-[14px]">
                  <div className="min-w-0 flex-1 whitespace-nowrap">
                    <div className="flex items-center gap-[6px] text-[13px]"><b className="truncate font-semibold">{e.name}</b><span className="truncate font-light">{e.project}</span></div>
                    <div className="mt-1">{e.connected ? <Badge color="outline">{SHARE_LABEL[e.shareState]}</Badge> : <Badge color="yellow"><span className="dots">disconnected</span></Badge>}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[13px]">
                    <Button variant="link" onClick={() => { setPinned(true); setPreview(e.streamId!) }}>Preview</Button>
                    <Button variant="link" onClick={() => act('/skip', { id: e.id })}>Skip</Button>
                    <Button variant="link" onClick={() => act('/remove', { id: e.id }).then(() => setUndo({ id: e.id, name: e.name }))}>Remove</Button>
                  </div>
                  <div className="flex shrink-0">
                    <Button variant="ghost" icon="arrow-up" size="icon" disabled={i === 0} aria-label="Move up" onClick={() => act('/move', { id: e.id, dir: -1 })} />
                    <Button variant="ghost" icon="arrow-down" size="icon" disabled={i === state.queue.length - 1} aria-label="Move down" onClick={() => act('/move', { id: e.id, dir: 1 })} />
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <div className="flex items-center gap-4">
            <SessionButton open={open} onClick={() => open ? confirm('End checkpoints?') && act('/session/end') : act('/session/start')} />
            <Button size="icon-lg" variant="outline" icon="cog" aria-label="Settings" aria-haspopup="dialog" aria-expanded={cog} onClick={() => setCog(!cog)} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <div className="relative h-[322px] border border-border bg-background">
            {preview ? <ViewFrame key={`${preview}:${preview_?.shareEpoch ?? 0}`} streamId={preview} className="absolute inset-0 size-full bg-background" /> : null}
            <StatsButton onClick={stats.toggle} className="absolute bottom-[15px] right-[15px]" />
            {busy && <span className="absolute left-[15px] top-4 text-foreground"><Spinner /></span>}
            <Badge className="pointer-events-none absolute right-[15px] top-4">Preview{pinned && ' · pinned'}</Badge>
            {pinned && <div className="absolute right-[15px] top-[36px] bg-background"><Button variant="ghost" size="sm" onClick={() => setPinned(false)}>follow next</Button></div>}
          </div>
          {/* Current presenter. Flow layout (no absolute positioning), so nothing overlaps at any width. */}
          <section aria-label="Current presenter" className="flex">
          <Card border={c ? 'border-ph-orange' : undefined} className="min-h-[146px] w-full">
            {c ? (<>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="ph-headline truncate text-[19px]">{c.name}</p>
                  <p className="mt-1 truncate font-light">{c.project}</p>
                </div>
                <div className="shrink-0 text-right">
                  {c.away ? <Badge color="pink" className="ml-auto"><span className="dots">disconnected</span></Badge>
                    : c.status === 'live' ? (c.pausedLeft != null ? <Badge color="yellow" className="ml-auto">Paused</Badge> : <Badge color="lime" className="ml-auto">Live</Badge>)
                    : <Badge color="orange" className="ml-auto">Getting ready</Badge>}
                  {left != null && <p className="ph-headline mt-1 text-[24px] tabular-nums">{fmt(left)}</p>}
                </div>
              </div>
              {/* Save window: time ran out but the server keeps them live for GRACE_MS. Add time to bring them back. */}
              {c.pausedLeft == null && c.deadline != null && c.deadline <= now() && <p role="status" className="border border-ph-pink px-2 py-1 text-xs font-semibold text-ph-pink">Time's up · ends in {Math.max(0, Math.ceil((c.deadline + GRACE_MS - now()) / 1000))}s. Add time to keep them</p>}
              <div className="mt-auto flex flex-wrap items-center gap-2.5">
                {c.status === 'called' && <Button onClick={() => act('/ready', { id: c.entryId })}>Start</Button>}
                {c.status === 'called' && <Button variant="outline" onClick={() => act('/skip', { id: c.entryId })}>Skip</Button>}
                <Button variant="outline" onClick={() => act('/stop', { id: c.entryId })}>Stop</Button>
                {c.status === 'live' && <Button onClick={() => act(c.pausedLeft != null ? '/resume' : '/pause', { id: c.entryId })}>{c.pausedLeft != null ? 'Resume' : 'Pause'}</Button>}
                {/* Shown while getting ready too, so they're findable; the server only adjusts live entries. */}
                {([15, 30] as const).map((d) => (
                  <Button key={d} variant="outline" disabled={c.status !== 'live'} title={c.status !== 'live' ? 'Available once their time starts' : undefined}
                    onClick={() => act('/adjust', { id: c.entryId, delta: d })}><span className="normal-case">+{d}s</span></Button>
                ))}
                {c.streamId && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setPinned(true); setPreview(c.streamId!) }}>Preview <Badge color="yellow">{SHARE_LABEL[c.shareState]}</Badge></Button>}
              </div>
            </>) : (<>
              <p className="ph-headline text-[19px]">Nobody up yet</p>
              <p className="text-sm">{open ? 'The next person in the queue will be called automatically.' : 'Start a checkpoint to open the queue.'}</p>
            </>)}
          </Card>
          </section>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-4 w-[933px] max-w-full text-ph-pink">{error}</p>}
      <Dialog open={cog} onOpenChange={setCog} title="Settings">
        <fieldset disabled={busy} className="flex min-w-0 flex-col items-start gap-4 border-0 p-0">
          <p className="text-[13px]">Hello, <b>{name}</b> · <Link href={typeof location === 'undefined' ? '/api/auth/logout' : signOutUrl()}>Sign out</Link></p>
          {open && <>
            <Field label="Limit (s)" htmlFor="admin-limit">
              <div className="w-24"><Input id="admin-limit" type="number" key={s!.limitSec} defaultValue={s!.limitSec} min={10} onBlur={(e) => Number(e.target.value) !== s!.limitSec && act('/limit', { seconds: Number(e.target.value) })} /></div>
            </Field>
            {/* SegmentedToggle names its group via aria-label; the visible caption is aria-hidden so it isn't read twice. */}
            <div className="flex flex-col gap-1.5">
              <span aria-hidden className="ph-subheadline text-[12px]">Quality</span>
              <SegmentedToggle label="Quality" value={s!.quality} onValueChange={(q) => act('/quality', { quality: q as Quality })}
                options={Object.keys(QUALITY).map((q) => ({ value: q, label: q === 'source' ? 'Source' : q }))} />
            </div>
            <Checkbox checked={s!.audio} onChange={() => act('/audio', { on: !s!.audio })}>Projector sound</Checkbox>
            <Checkbox checked={s!.reactions} onChange={() => act('/reactions', { on: !s!.reactions })}>Reactions</Checkbox>
            <p className="text-[12px] font-light">Ends by itself after 10 minutes with nothing happening, or 5 minutes with no organizer page open.</p>
            <Button variant="pink-outline" onClick={() => confirm('End checkpoints?') && act('/session/end')}>End checkpoints</Button>
          </>}
        </fieldset>
      </Dialog>
      {undo && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 border border-border bg-background px-4 py-2 text-[13px]">
          Removed {undo.name}.
          <Button variant="link" onClick={() => { act('/unremove', { id: undo.id }); setUndo(null) }}>Undo</Button>
        </div>
      )}
    </Shell>
  )
}
