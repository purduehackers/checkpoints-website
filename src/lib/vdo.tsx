// Everything VDO.Ninja lives here.
// Sharing: we capture the screen ourselves (so we know exactly when it starts and stops) and the
// VDO.Ninja SDK handles signalling, peer connections and TURN. Viewing: plain vdo.ninja iframes.
// Audio: the picker's "share audio" box adds an audio track that the SDK publishes with the video.
// The track stays disabled (silent) until the hacker is live, and only the projector plays it.
// Quality: the SDK publisher ignores vdo.ninja viewer params like &bitrate/&scale, so the sender
// sets resolution (capture constraints) and bitrate (encoder) from the organizer's preset.
import { useEffect, useRef, useState } from 'react'
import VDONinjaSDK from '@vdoninja/sdk'
import { QUALITY, type Quality, type ShareState } from '../../shared/types'

const AUDIO_KBPS = 128
const noAudioBrowser = typeof navigator !== 'undefined' && /firefox|^((?!chrome|android).)*safari/i.test(navigator.userAgent)
const videoConstraints = (q: Quality): MediaTrackConstraints => {
  const { width, height } = QUALITY[q]
  // crop-and-scale: without it Chrome won't downscale a capture to meet a max width/height
  return { frameRate: { ideal: 30, max: 30 }, resizeMode: 'crop-and-scale', ...(width && { width: { max: width }, height: { max: height } }) } as MediaTrackConstraints
}

// Hacker's share with its own preview. Unmounting it ends the share.
export function ShareBox({ streamId, label, live, quality, onState }: { streamId: string; label: string; live: boolean; quality: Quality; onState: (s: ShareState) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const sdk = useRef<VDONinjaSDK | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<ShareState>('not_shared')
  const [error, setError] = useState('')
  const [hasAudio, setHasAudio] = useState(false)
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

  async function share() {
    setError('')
    let s: MediaStream
    try {
      // systemAudio is a Chromium hint; other browsers ignore it and just give video.
      s = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints(quality),
        // Raw audio: Chrome's voice processing (echo cancel, denoise, auto gain) mangles music and demos.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        suppressLocalAudioPlayback: true, // a shared tab goes quiet locally; the projector plays it
        selfBrowserSurface: 'exclude', // don't offer this tab
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions)
    } catch {
      return setError('Screen share was cancelled or blocked.')
    }
    stop() // "Change window": replace the previous share
    stream.current = s
    muteUnlessLive()
    setHasAudio(s.getAudioTracks().length > 0)
    video.current!.srcObject = s
    // Fires when the hacker clicks the browser's "Stop sharing" or the window closes.
    s.getVideoTracks()[0].onended = () => { if (stream.current === s) { stop(); report('stopped') } }
    try {
      if (!sdk.current) {
        // salt 'vdo.ninja' + default host/password: viewable at vdo.ninja/?view=<streamId>
        sdk.current = new VDONinjaSDK({ salt: 'vdo.ninja', label })
        await sdk.current.connect()
      }
      // Bitrate only: given a resolution or frameRate, the SDK calls applyConstraints, which wipes our capture caps.
      await sdk.current.publish(s, { streamID: streamId, media: { video: { maxBitrate: QUALITY[quality].kbps }, audio: { maxBitrate: AUDIO_KBPS } } })
      report('sharing')
    } catch (e) {
      stop()
      report('stopped')
      setError('Could not start the stream: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  useEffect(() => () => { stop(); sdk.current?.disconnect().catch(() => {}) }, [])
  useEffect(muteUnlessLive, [live])

  // Organizer changed the quality: re-cap the capture and the encoder without restarting the share.
  useEffect(() => {
    const track = stream.current?.getVideoTracks()[0]
    if (!track) return
    track.applyConstraints(videoConstraints(quality)).catch(() => {})
    sdk.current?.updatePublisherMedia({ media: { video: { maxBitrate: QUALITY[quality].kbps } } }).catch(() => {})
  }, [quality])

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded bg-neutral-900">
        <video ref={video} autoPlay muted playsInline className="h-full w-full object-contain" />
        {state !== 'sharing' && (
          <button onClick={share} className="absolute inset-0 m-auto h-fit w-fit rounded-lg bg-amber-500 px-6 py-3 text-lg font-semibold text-black">
            {state === 'stopped' ? 'Share again' : 'Share your screen'}
          </button>
        )}
      </div>
      {state === 'stopped' && <p className="mt-2 rounded bg-red-900 p-2 text-sm">Your share stopped. Click “Share again”.</p>}
      {state === 'not_shared' && <p className="mt-2 text-sm text-neutral-400">Pick a screen, window or tab and tick “Share audio” to play sound on the projector. Only the organizer sees it until you go live.</p>}
      {state === 'sharing' && (
        <p className="mt-2 text-sm">
          {hasAudio ? <span className="text-green-400">Sharing with sound{live ? '' : ' (plays on the projector once you’re live)'}.</span>
            : noAudioBrowser ? <span className="text-amber-400">This browser can’t share sound. Use Chrome or Edge if your demo needs audio.</span>
            : <span className="text-neutral-400">No sound. Use “Change window” and tick “Share audio”.</span>}{' '}
          <button className="underline" onClick={share}>Change window</button>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}

// Silent unless `audio` is set (the projector only).
export function ViewFrame({ streamId, className = '', audio = false }: { streamId: string; className?: string; audio?: boolean }) {
  return <iframe allow="autoplay; fullscreen" className={`border-0 ${className}`} src={`https://vdo.ninja/?view=${streamId}&cleanoutput&autostart${audio ? '' : '&noaudio'}`} />
}
