// First-time guided tour: a spotlight on the real element plus a pixel speech bubble. No library.
// The spotlight is one box whose huge shadow dims the rest; it never blocks clicks, so the page stays usable.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type Step = { target: string; text: string; icon: string[] }
type Rect = { top: number; left: number; width: number; height: number }

const BUBBLE_W = 280, GAP = 12, EDGE = 8, PAD = 6

// Under the target if it fits, else above, else pinned to the bottom (target taller than the screen). Always on screen.
export function place(t: Rect, bubbleH: number, vw: number, vh: number) {
  const width = Math.min(BUBBLE_W, vw - 2 * EDGE)
  const left = Math.min(Math.max(EDGE, t.left), vw - width - EDGE)
  const below = t.top + t.height + GAP, above = t.top - GAP - bubbleH
  const top = below + bubbleH <= vh - EDGE ? below : above >= EDGE ? above : vh - bubbleH - EDGE
  return { top: Math.max(EDGE, top), left, width }
}

// Parts already shown. Storage can be missing or throw (blocked site data): then it lasts for this page load.
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const KEY = 'cp-tour'
export function seenStore(storage: Store | null) {
  let mem: string[] = []
  const read = (): string[] => { try { return JSON.parse(storage?.getItem(KEY) ?? 'null') ?? mem } catch { return mem } }
  return {
    has: (part: string) => read().includes(part),
    add: (part: string) => { mem = [...new Set([...read(), part])]; try { storage?.setItem(KEY, JSON.stringify(mem)) } catch {} },
    clear: () => { mem = []; try { storage?.removeItem(KEY) } catch {} },
  }
}
export const seen = seenStore((() => { try { return localStorage } catch { return null } })())

// 8x8 pixel icons, '#' = lit.
export const ICONS = {
  person: ['...##...', '..####..', '..####..', '...##...', '.######.', '########', '########', '##....##'],
  plus: ['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'],
  hourglass: ['########', '.######.', '..####..', '...##...', '...##...', '..#..#..', '.#....#.', '########'],
  screen: ['########', '#......#', '#......#', '#......#', '########', '...##...', '..####..', '........'],
  play: ['##......', '####....', '######..', '########', '########', '######..', '####....', '##......'],
}
function Pixel({ rows }: { rows: string[] }) {
  return (
    <svg viewBox="0 0 8 8" className="size-8 shrink-0 text-amber-400" shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((c, x) => c === '#' && <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />))}
    </svg>
  )
}

// Shows `steps` once per `part`. Marked seen as soon as it opens, so a refresh mid-tour doesn't repeat it.
export function Tour({ part, steps }: { part: string; steps: Step[] }) {
  const [open, setOpen] = useState(() => !seen.has(part))
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [bubbleH, setBubbleH] = useState(120)
  const bubble = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const step = steps[i]
  const close = () => setOpen(false)

  useEffect(() => { if (open) seen.add(part) }, [])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [])

  // Follow the target: scroll it into view, then track resizes, scrolling and its own size changes.
  useLayoutEffect(() => {
    if (!open || !step) return
    const el = document.querySelector(`[data-tour="${step.target}"]`)
    if (!el) return i + 1 < steps.length ? setI(i + 1) : close() // not on the page (e.g. no share box): skip it
    el.scrollIntoView({ block: 'nearest' })
    const update = () => setRect(el.getBoundingClientRect())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    addEventListener('resize', update)
    addEventListener('scroll', update, true)
    next.current?.focus({ preventScroll: true })
    return () => { ro.disconnect(); removeEventListener('resize', update); removeEventListener('scroll', update, true) }
  }, [open, i])
  useLayoutEffect(() => { if (bubble.current) setBubbleH(bubble.current.offsetHeight) }, [rect, i])

  if (!open || !step || !rect) return null
  const last = i + 1 === steps.length
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed z-[60] outline-2 outline-amber-400 transition-all duration-200 motion-reduce:transition-none"
        style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.7)' }} />
      <div ref={bubble} role="dialog" aria-live="polite" aria-label={`Tip ${i + 1} of ${steps.length}`}
        className="fixed z-[61] border-2 border-amber-400 bg-neutral-900 p-3 font-pixel text-sm shadow-[4px_4px_0_#000]"
        style={place(rect, bubbleH, innerWidth, innerHeight)}>
        <div className="flex items-start gap-3"><Pixel rows={step.icon} /><p className="leading-snug">{step.text}</p></div>
        <div className="mt-3 flex items-center gap-3 text-xs">
          {steps.length > 1 && <span className="text-neutral-500">{i + 1}/{steps.length}</span>}
          {!last && <button className="ml-auto text-neutral-400 underline" onClick={close}>Skip</button>}
          <button ref={next} className={`${last ? 'ml-auto' : ''} bg-amber-500 px-3 py-1 text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`}
            onClick={() => (last ? close() : setI(i + 1))}>{last ? 'Got it' : 'Next'}</button>
        </div>
      </div>
    </>
  )
}
