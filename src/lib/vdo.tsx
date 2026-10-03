// Everything VDO.Ninja lives here. Swap this file to switch to direct WebRTC.
import { useEffect, useRef } from 'react'
import type { ShareState } from '../../shared/types'

const ORIGIN = 'https://vdo.ninja'
const ALLOW = 'display-capture; autoplay; fullscreen'

// Hacker's own share. The iframe is also their preview. The hacker clicks VDO.Ninja's own
// "share screen" button inside it (getDisplayMedia needs a click in that frame).
// Unmounting it ends the share. `label` pre-fills VDO.Ninja's display name so it doesn't ask again.
export function PushFrame({ streamId, label, onState }: { streamId: string; label: string; onState: (s: ShareState) => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== ORIGIN || e.source !== ref.current?.contentWindow) return
      console.debug('[vdo]', e.data) // ?? event names unverified; check this log when testing
      const d = e.data
      if (d?.action === 'seeding') onState(d.value === false ? 'stopped' : 'sharing')
    }
    window.addEventListener('message', onMsg)
    return () => {
      window.removeEventListener('message', onMsg)
      ref.current?.contentWindow?.postMessage({ close: true }, '*')
    }
  }, [onState])
  return <iframe ref={ref} allow={ALLOW} className="h-full w-full border-0" src={`${ORIGIN}/?push=${streamId}&label=${encodeURIComponent(label)}&screenshare&audiodevice=0&cleanoutput`} />
}

// No audio in the MVP: the presenter talks to the room. Push sends no mic (&audiodevice=0) and viewers never play sound.
export function ViewFrame({ streamId, className = '' }: { streamId: string; className?: string }) {
  return <iframe allow={ALLOW} className={`border-0 ${className}`} src={`${ORIGIN}/?view=${streamId}&cleanoutput&autostart&noaudio`} />
}
