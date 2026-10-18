import { REACTIONS } from '../../shared/types'

// Hacker side: one button per emoji. Every tap is sent; the server owns the cooldown, warning and slow mode.
export function ReactionPanel({ react, notice }: { react: (emoji: string) => void; notice: { text: string; until: number; slowUntil: number } | null }) {
  const now = Date.now(), slow = !!notice && now < notice.slowUntil
  return (
    <div className="space-y-1">
      <div className={`flex justify-between gap-2 rounded-lg bg-neutral-800 p-2 ${slow ? 'opacity-50' : ''}`}>
        {REACTIONS.map((e) => <button key={e} aria-label={`React ${e}`} onClick={() => react(e)} className="grow rounded p-2 text-3xl active:scale-90">{e}</button>)}
      </div>
      {notice && now < Math.max(notice.until, notice.slowUntil) && <p role="status" className="text-sm text-amber-400">{notice.text}</p>}
    </div>
  )
}

const MAX_LIVE = 80 // DOM nodes in flight; the rest of a spike is dropped
// Host side: plain DOM + Web Animations, so a spike never goes through React renders. Each emoji drifts up the
// right edge and fades. Counts arrive as one batch per window; spread them across it so it reads as a stream.
export function FloatingReactions({ box }: { box: React.RefObject<HTMLDivElement | null> }) {
  return <div ref={box} className="pointer-events-none absolute bottom-0 right-0 top-0 z-20 w-40 overflow-hidden" />
}
export function spawn(box: HTMLDivElement | null, counts: Record<string, number>) {
  if (!box) return
  for (const [emoji, n] of Object.entries(counts)) {
    if (!(REACTIONS as readonly string[]).includes(emoji)) continue // never render what the server wouldn't send
    for (let i = 0; i < Math.min(n, 20); i++) setTimeout(() => {
      if (box.childElementCount >= MAX_LIVE) return
      const el = document.createElement('span')
      el.textContent = emoji
      const x = Math.random() * 60, sway = (Math.random() - 0.5) * 60
      el.style.cssText = `position:absolute;bottom:0;right:${x}px;font-size:${32 + Math.random() * 24}px`
      box.append(el)
      el.animate([
        { transform: 'translate(0,0)', opacity: 0 },
        { transform: `translate(${sway / 2}px,-15vh)`, opacity: 1, offset: 0.1 },
        { transform: `translate(${sway}px,-${60 + Math.random() * 25}vh)`, opacity: 0 },
      ], { duration: 2500 + Math.random() * 1500, easing: 'ease-out' }).onfinish = () => el.remove()
    }, Math.random() * 250)
  }
}
