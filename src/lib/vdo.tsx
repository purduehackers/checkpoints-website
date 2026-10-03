// Everything VDO.Ninja lives here. Swap this file to switch to direct WebRTC.
import { useEffect, useRef } from 'react'
import type { ShareState } from '../../shared/types'

const ORIGIN = 'https://vdo.ninja'
const ALLOW = 'display-capture; autoplay; microphone; camera; fullscreen'

// Hacker's own share. The iframe is also their preview. The hacker clicks VDO.Ninja's own
// "share screen" button inside it (getDisplayMedia needs a click in that frame).
// Unmounting it ends the share.
export function PushFrame({ streamId, onState }: { streamId: string; onState: (s: ShareState) => void }) {
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
  return <iframe ref={ref} allow={ALLOW} className="h-full w-full border-0" src={`${ORIGIN}/?push=${streamId}&screenshare&cleanoutput&label=`} />
}

export function ViewFrame({ streamId, sound = false, className = '' }: { streamId: string; sound?: boolean; className?: string }) {
  return <iframe key={String(sound)} allow={ALLOW} className={`border-0 ${className}`} src={`${ORIGIN}/?view=${streamId}&cleanoutput&autostart${sound ? '' : '&noaudio'}`} />
}
