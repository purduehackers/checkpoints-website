// Everything VDO.Ninja lives here.
// Sharing: we capture the screen ourselves (so we know exactly when it starts and stops) and the
// VDO.Ninja SDK handles signalling, peer connections and TURN. Viewing: plain vdo.ninja iframes.
import { useEffect, useRef, useState } from 'react'
import VDONinjaSDK from '@vdoninja/sdk'
import type { ShareState } from '../../shared/types'

// Hacker's share with its own preview. Unmounting it ends the share.
export function ShareBox({ streamId, label, onState }: { streamId: string; label: string; onState: (s: ShareState) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const sdk = useRef<VDONinjaSDK | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<ShareState>('not_shared')
  const [error, setError] = useState('')
  const report = (s: ShareState) => { setState(s); onState(s) }

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
      s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }) // no audio in the MVP
    } catch {
      return setError('Screen share was cancelled or blocked.')
    }
    stop() // "Change window": replace the previous share
    stream.current = s
    video.current!.srcObject = s
    // Fires when the hacker clicks the browser's "Stop sharing" or the window closes.
    s.getVideoTracks()[0].onended = () => { if (stream.current === s) { stop(); report('stopped') } }
    try {
      if (!sdk.current) {
        // salt 'vdo.ninja' + default host/password: viewable at vdo.ninja/?view=<streamId>
        sdk.current = new VDONinjaSDK({ salt: 'vdo.ninja', label })
        await sdk.current.connect()
      }
      await sdk.current.publish(s, { streamID: streamId })
      report('sharing')
    } catch (e) {
      stop()
      report('stopped')
      setError('Could not start the stream: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  useEffect(() => () => { stop(); sdk.current?.disconnect().catch(() => {}) }, [])

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
      {state === 'not_shared' && <p className="mt-2 text-sm text-neutral-400">Pick a screen, window or tab. Only the organizer sees it until you go live.</p>}
      {state === 'sharing' && <button className="mt-2 text-sm underline" onClick={share}>Change window</button>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  )
}

// No audio in the MVP: the presenter talks to the room. We capture no audio and viewers never play sound.
export function ViewFrame({ streamId, className = '' }: { streamId: string; className?: string }) {
  return <iframe allow="autoplay; fullscreen" className={`border-0 ${className}`} src={`https://vdo.ninja/?view=${streamId}&cleanoutput&autostart&noaudio`} />
}
