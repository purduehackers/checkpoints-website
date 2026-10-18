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
// right edge and fades. Counts arrive as one batch per window (allowlisted by the server); spread them across it so it reads as a stream.
export function spawn(box: HTMLDivElement | null, counts: Record<string, number>) {
  if (!box) return
  for (const [emoji, n] of Object.entries(counts)) {
    for (let i = 0; i < Math.min(n, 20); i++) setTimeout(() => {
      if (box.childElementCount >= MAX_LIVE) return
      const el = document.createElement('span')
      el.textContent = emoji
      el.style.cssText = `position:absolute;bottom:0;right:${Math.random() * 60}px;font-size:${32 + Math.random() * 24}px`
      box.append(el)
      // Rise while swaying side to side on a sine, like a feather: random amplitude, phase and number of swings.
      const rise = 60 + Math.random() * 25, amp = 10 + Math.random() * 14, phase = Math.random() * 6.28, swings = 1.5 + Math.random()
      const frames = Array.from({ length: 13 }, (_, i) => {
        const t = i / 12
        return { transform: `translate(${amp * Math.sin(phase + t * swings * 6.28)}px,-${t * rise}vh)`, opacity: t < 0.1 ? t * 10 : 1 - Math.max(0, t - 0.6) / 0.4 }
      })
      el.animate(frames, { duration: 2500 + Math.random() * 1500, easing: 'ease-out' }).onfinish = () => el.remove()
    }, Math.random() * 250)
  }
}
