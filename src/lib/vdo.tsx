// Everything VDO.Ninja lives here.
// Sharing: we capture the screen ourselves (so we know exactly when it starts and stops) and the
// VDO.Ninja SDK handles signalling, peer connections and TURN. Viewing: plain vdo.ninja iframes.
// Audio: the picker's "share audio" box adds an audio track that the SDK publishes with the video.
// The track stays disabled (silent) until the hacker is live, and only the projector plays it.
// Quality: the SDK publisher ignores vdo.ninja viewer params like &bitrate/&scale, so the sender
// sets the encoder bitrate from the organizer's preset. The capture is never resized.
import { useEffect, useMemo, useRef, useState } from 'react'
import VDONinjaSDK from '@vdoninja/sdk'
import { QUALITY, type Quality, type ShareState } from '../../shared/types'
import { StatsOverlay, pushSample, statsCollector, type Sample } from './stats'

const AUDIO_KBPS = 128
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const noAudioBrowser = /firefox|^((?!chrome|android).)*safari/i.test(ua)
const linux = /linux/i.test(ua) && !/android/i.test(ua)
const mac = /macintosh/i.test(ua)
// getDisplayMedia failures, in plain words. The raw name stays so a screenshot tells us what broke.
// A plain NotAllowedError is the hacker cancelling; "by system" is the OS refusing.
function captureError(e: unknown): { msg: string; retry: boolean } {
  const name = String((e as Error)?.name ?? 'Error')
  const denied = name === 'NotAllowedError' && /system/i.test(String((e as Error)?.message))
  const tabHint = linux ? ' Try sharing a browser tab instead, which avoids the system picker.' : ''
  // On Linux a broken portal also surfaces as a plain NotAllowedError, so offer the fallbacks there.
  if (name === 'NotAllowedError' && !denied) return { msg: `Sharing was cancelled or blocked.${tabHint} (${name})`, retry: linux }
  const msg = denied && mac ? 'Your Mac blocked screen sharing. Allow your browser in System Settings › Privacy & Security › Screen Recording, then restart it.'
    : denied || name === 'NotReadableError' || name === 'AbortError' ? "Your computer couldn't start the screen capture." + tabHint
    : 'Screen share failed.'
  return { msg: `${msg} (${name})`, retry: true }
}
// Frame rate only. A width/height cap with crop-and-scale re-renders the captured screen at the cap size,
// which left the presenter's own display zoomed in. The organizer's quality is the encoder bitrate alone.
const videoConstraints = (): MediaTrackConstraints => ({ frameRate: { ideal: 30, max: 30 } })

// Hacker's share with its own preview. Unmounting it ends the share.
export function ShareBox({ streamId, label, live, quality, stats, onCloseStats, onState, shareRef, hideShare }: {
  streamId: string; label: string; live: boolean; quality: Quality; stats: boolean; onCloseStats: () => void; onState: (s: ShareState) => void
  shareRef?: { current: (() => void) | null }; hideShare?: boolean // the parent's own button starts the share (one click instead of two)
}) {
  const video = useRef<HTMLVideoElement>(null)
  const sdk = useRef<VDONinjaSDK | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<ShareState>('not_shared')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [backup, setBackup] = useState(false) // backup tab owns the stream ID; don't publish it from here too
  const [history, setHistory] = useState<Sample[]>([])
  const report = (s: ShareState) => { setState(s); onState(s) }
  const liveRef = useRef(live)
  liveRef.current = live
  const muteUnlessLive = () => stream.current?.getAudioTracks().forEach((t) => (t.enabled = liveRef.current))

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    try { sdk.current?.stopPublishing() } catch {}
  }

  // basic: no extra options, for a browser that rejects ours. A button, not an auto-retry: each call needs a fresh click.
  async function share(basic = false) {
    setError('')
    setRetry(false)
    let s: MediaStream
    try {
      // Ask for as little as possible: every extra option is one more way a portal/PipeWire picker can
      // reject or re-prompt.
      // Chromium-only hints (systemAudio, surfaceSwitching, selfBrowserSurface, suppressLocalAudioPlayback)
      // are skipped on Linux, where the xdg-desktop-portal picker has no use for them and they've been flaky,
      // and audio is only asked of browsers that can share it (WebKit bug 259823: {video, audio} can reject outright).
      s = await navigator.mediaDevices.getDisplayMedia(basic ? { video: true, audio: !noAudioBrowser } : {
        video: { displaySurface: 'monitor' }, // preselect "Entire screen" in the picker
        // Raw audio: Chrome's voice processing (echo cancel, denoise, auto gain) mangles music and demos.
        audio: !noAudioBrowser && { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        ...(!linux && !noAudioBrowser && {
          systemAudio: 'include',
          suppressLocalAudioPlayback: true, // a shared tab goes quiet locally; the projector plays it
          monitorTypeSurfaces: 'include',
          selfBrowserSurface: 'exclude', // don't offer this tab
          surfaceSwitching: 'include',
        }),
      } as DisplayMediaStreamOptions)
    } catch (e) {
      const { msg, retry } = captureError(e)
      setRetry(retry && !basic)
      return setError(msg)
    }
    const track = s.getVideoTracks()[0]
    // Wayland/PipeWire can hand back a dead track instead of an error. (Not `muted`: a static screen
    // delivers no frames and reads as muted, so that would reject good shares; the admin preview shows black.)
    if (!track || track.readyState === 'ended') {
      s.getTracks().forEach((t) => t.stop())
      setRetry(!basic)
      return setError(`The screen capture produced no video.${linux ? ' Try sharing a browser tab instead, which avoids the system picker.' : ''} (EmptyCapture)`)
    }
    stop() // "Change window": replace the previous share. Claimed before any await, so a newer share() or stop() makes this one bail below.
    stream.current = s
    muteUnlessLive()
    setHasAudio(s.getAudioTracks().length > 0)
    video.current!.srcObject = s
    // Fires when the hacker clicks the browser's "Stop sharing" or the window closes.
    s.getVideoTracks()[0].onended = () => { if (stream.current === s) { stop(); report('stopped') } }
    try {
      // Cap fps after capture; a refused (or never-settling) cap must never kill the share.
      if (!basic) await Promise.race([track.applyConstraints(videoConstraints()).catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
      if (!sdk.current) {
        // salt 'vdo.ninja' + default host/password: viewable at vdo.ninja/?view=<streamId>
        sdk.current = new VDONinjaSDK({ salt: 'vdo.ninja', label })
        await sdk.current.connect()
      }
      // stop() above finishes asynchronously; publishing again before it does throws "Already publishing".
      const sdkNow = sdk.current
      if (sdkNow.state.publishing) await new Promise((r) => sdkNow.addEventListener('publishingStopped', r, { once: true }))
      if (stream.current !== s) return // replaced or ended while we waited
      // Bitrate only: given a resolution or frameRate, the SDK calls applyConstraints, which wipes our capture caps.
      await sdk.current.publish(s, { streamID: streamId, media: { video: { maxBitrate: QUALITY[quality].kbps }, audio: { maxBitrate: AUDIO_KBPS } } })
      report('sharing')
    } catch (e) {
      stop()
      report('stopped')
      setError('Could not start the stream: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  if (shareRef) shareRef.current = () => { share() }

  useEffect(() => () => { stop(); sdk.current?.disconnect().catch(() => {}) }, [])
  useEffect(muteUnlessLive, [live])

  // Organizer changed the quality: re-set the encoder bitrate without restarting the share.
  useEffect(() => {
    if (!stream.current) return
    sdk.current?.updatePublisherMedia({ media: { video: { maxBitrate: QUALITY[quality].kbps } } }).catch(() => {})
  }, [quality])

  // Once a second while sharing: measure, and pipe the sample to /host and /admin stats listeners.
  useEffect(() => {
    if (state !== 'sharing' || !sdk.current) return
    const collect = statsCollector(sdk.current)
    const i = setInterval(async () => {
      const s = await collect().catch(() => null)
      setHistory((h) => pushSample(h, s))
      if (s) try { sdk.current?.sendData({ cpStats: s }) } catch {}
    }, 1000)
    return () => { clearInterval(i); setHistory([]) }
  }, [state])

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded bg-neutral-900">
        <video ref={video} autoPlay muted playsInline className="h-full w-full object-contain" />
        {state !== 'sharing' && !backup && !hideShare && (
          <button onClick={() => share()} className="absolute inset-0 m-auto h-fit w-fit rounded-lg bg-amber-500 px-6 py-3 text-lg font-semibold text-black">
            {state === 'stopped' ? 'Share again' : 'Share your screen'}
          </button>
        )}
      </div>
      {backup && <p className="mt-2 rounded bg-neutral-800 p-2 text-sm">You’re using the backup share in another tab. Close it before sharing here. <button className="underline" onClick={() => setBackup(false)}>Share here instead</button></p>}
      {state === 'stopped' && !backup && <p className="mt-2 rounded bg-red-900 p-2 text-sm">Your share stopped. Click “Share again”.</p>}
      {state === 'not_shared' && !backup && <p className="mt-2 text-sm text-neutral-400">Pick “Entire screen”. For sound on the projector, share a browser tab instead and tick “Share audio”. Only the organizer sees it until you go live.{linux && ' On Linux, a browser tab is the most reliable choice.'}</p>}
      {state === 'sharing' && (
        <p className="mt-2 text-sm">
          {hasAudio ? <span className="text-green-400">Sharing with sound{live ? '' : ' (plays on the projector once you’re live)'}.</span>
            : noAudioBrowser ? <span className="text-amber-400">This browser can’t share sound. Use Chrome or Edge if your demo needs audio.</span>
            : <span className="text-neutral-400">No sound. To play sound, use “Change window”, share a browser tab and tick “Share audio”.</span>}{' '}
          <button className="underline" onClick={() => share()}>Change window</button>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}{retry && <> <button className="underline" onClick={() => share(true)}>Try basic share</button></>}</p>}
      {/* Fallback: vdo.ninja's own share page, publishing to the same stream the projector watches.
          Stop and disconnect ours first, so the stream ID is free and two publishers don't fight. The server sees "not sharing", so Ready goes through "Present without sharing". */}
      <a className="mt-3 block rounded-lg border border-neutral-600 px-4 py-3 text-center font-medium text-neutral-200 hover:bg-neutral-800" href={`https://vdo.ninja/?push=${streamId}&screenshare`} target="_blank" rel="noopener noreferrer"
        onClick={() => { stop(); sdk.current?.disconnect().catch(() => {}); sdk.current = null; setBackup(true); setError(''); report('not_shared') }}>Having trouble? Use backup share, then press “Present without sharing”.</a>
      {stats && <StatsOverlay history={history} title="Your stream" onClose={onCloseStats} />}
    </div>
  )
}

// Silent (&noaudio) unless `muted` is given (the projector only). Then it loads with &stereo (full-band
// stereo Opus in the viewer's SDP answer, which the sender's encoder honours; bitrate/scale params would
// be ignored) and `muted` is applied via the IFRAME API's { mute } postMessage, so toggling sound never
// reloads the live stream. src doesn't depend on `muted` for that reason.
export function ViewFrame({ streamId, className = '', muted }: { streamId: string; className?: string; muted?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const startMuted = useMemo(() => muted, [streamId]) // &mutespeaker closes the gap before the first postMessage lands; later toggles never touch src
  const send = () => { if (muted !== undefined) ref.current?.contentWindow?.postMessage({ mute: muted }, 'https://vdo.ninja') }
  // Re-sent every 2s: a message that lands before vdo.ninja is listening is dropped, and { mute } is idempotent.
  useEffect(() => { send(); const i = setInterval(send, 2000); return () => clearInterval(i) }, [muted])
  return <iframe ref={ref} onLoad={send} allow="autoplay; fullscreen" className={`border-0 ${className}`} src={`https://vdo.ninja/?view=${streamId}&cleanoutput&autostart${muted === undefined ? '&noaudio' : '&stereo'}${startMuted ? '&mutespeaker' : ''}`} />
}
