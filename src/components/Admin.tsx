import { useEffect, useState } from 'react'
import { ConnectionBadge, Spinner, aboutMin, api, fmt, signInUrl, signOutUrl, useLive, useTick, useUser, waitMs } from '../lib/live'
import { ViewFrame } from '../lib/vdo'
import { StatsButton, StatsOverlay, useRemoteStats, useStatsToggle } from '../lib/stats'
import { DitheredSoup } from './DitheredSoup'
import { Badge } from './ph/badge'
import { Button } from './ph/button'
import { Card } from './ph/card'
import { Checkbox } from './ph/checkbox'
import { Dialog } from './ph/dialog'
import { Field } from './ph/field'
import { Glider } from './ph/glider'
import { Input } from './ph/input'
import { Link } from './ph/link'
import { SegmentedToggle } from './ph/segmented-toggle'
import { QUALITY, type Quality } from '../../shared/types'

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
            <Button size="lg" variant={open ? 'orange' : 'lime'} className="flex-1" onClick={() => open ? confirm('End checkpoints?') && act('/session/end') : act('/session/start')}>{open ? 'End checkpoint' : 'Start checkpoint'}</Button>
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
          {/* min-h 148 = queue card 418 + gap 24 + session button 52 - preview 322 - gap 24, so the columns end level; grows past that rather than squeezing. */}
          <Card border={c ? 'border-ph-orange' : undefined} className="min-h-[148px] w-full">
            {c ? (
              <div className="flex flex-col gap-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="ph-headline truncate text-[28px] leading-8">{c.name}</p>
                    <p className="mt-1 truncate font-light">{c.project}</p>
                  </div>
                  {/* h-8 matches the name's line height so badge + timer sit centered on the name. */}
                  <div className="flex h-8 shrink-0 items-center gap-3">
                    {c.away ? <Badge color="pink"><span className="dots">disconnected</span></Badge>
                      : c.status === 'live' ? (c.pausedLeft != null ? <Badge color="yellow">Paused</Badge> : <Badge color="lime">Live</Badge>)
                      : <Badge color="orange">Getting ready</Badge>}
                    {left != null && <p className="ph-headline text-[28px] leading-8 tabular-nums">{fmt(left)}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.status === 'called' && <Button onClick={() => act('/ready', { id: c.entryId })}>Start</Button>}
                  {c.status === 'called' && <Button variant="outline" onClick={() => act('/skip', { id: c.entryId })}>Skip</Button>}
                  <Button variant="outline" onClick={() => act('/stop', { id: c.entryId })}>Stop</Button>
                  {c.status === 'live' && <Button onClick={() => act(c.pausedLeft != null ? '/resume' : '/pause', { id: c.entryId })}>{c.pausedLeft != null ? 'Resume' : 'Pause'}</Button>}
                  {/* Shown while getting ready too, so they're findable; the server only adjusts live entries. */}
                  {([15, 30] as const).map((d) => (
                    <Button key={d} variant="outline" disabled={c.status !== 'live'} title={c.status !== 'live' ? 'Available once their time starts' : undefined}
                      onClick={() => act('/adjust', { id: c.entryId, delta: d })}><span className="normal-case">+{d}s</span></Button>
                  ))}
                </div>
                {c.streamId && (
                  <div className="flex items-center justify-between gap-4 border-t border-border pt-4 text-[13px]">
                    <span className="flex items-center gap-2">Screen <Badge color="yellow">{SHARE_LABEL[c.shareState]}</Badge></span>
                    <Button variant="ghost" size="sm" onClick={() => { setPinned(true); setPreview(c.streamId!) }}>Preview</Button>
                  </div>
                )}
              </div>
            ) : (<>
              <p className="ph-headline text-[19px]">Nobody up yet</p>
              <p className="text-sm">{open ? 'The next person in the queue will be called automatically.' : 'Start a checkpoint to open the queue.'}</p>
            </>)}
            {state.previous && (
              <div className="mt-4 border-t border-border pt-4 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>Previous: <b>{state.previous.name}</b> · {state.previous.project}</p>
                  <div className="flex gap-2">
                    {[15, 30].map((d) => <Button key={d} variant="outline" onClick={() => act('/adjust', { id: state.previous!.entryId, delta: d })}><span className="normal-case">+{d}s</span></Button>)}
                  </div>
                </div>
                <p className="mt-1 text-[12px] font-light">Adding time brings them back{c ? `; ${c.name} returns to the front of the line` : ''}.</p>
              </div>
            )}
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
