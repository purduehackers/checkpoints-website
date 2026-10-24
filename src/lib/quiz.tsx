// Device fingerprint + the first-time quiz. A device that passes is remembered by the server (by fingerprint),
// so clearing storage or getting a new hacker token doesn't bring the quiz back.
import { useEffect, useRef, useState } from 'react'

// Small 53-bit string hash, for when crypto.subtle is missing (insecure context). Not secure, just stable.
function cyrb53(s: string) {
  let a = 0xdeadbeef, b = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677) }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(16).padStart(14, '0')
}

// How this browser draws text differs a little by GPU, fonts and OS; one more stable trait.
function canvasTrait() {
  try {
    const c = document.createElement('canvas'), g = c.getContext('2d')
    if (!g) return ''
    c.width = 160; c.height = 30
    g.font = '16px Arial'
    g.fillStyle = '#f60'; g.fillRect(10, 5, 60, 20)
    g.fillStyle = '#069'; g.fillText('Checkpoints \u{1F434}', 4, 20)
    return c.toDataURL()
  } catch { return '' }
}

async function compute() {
  const n = navigator as any
  const traits = [
    n.userAgent, n.platform, (n.languages ?? [n.language]).join(','),
    screen.width, screen.height, screen.colorDepth, devicePixelRatio,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    n.hardwareConcurrency, n.deviceMemory, n.maxTouchPoints,
    canvasTrait(),
  ].join('|')
  if (!crypto?.subtle) return cyrb53(traits) + cyrb53(traits.split('').reverse().join('')) // 28 hex
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits))
  return [...new Uint8Array(buf)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('') // 32 hex
}

// Computed once per page. If anything throws, the hacker token stands in: stable per browser, so nothing breaks.
let memo: Promise<string> | undefined
export const deviceFp = (token: string) => (memo ??= compute().catch(() => cyrb53(token) + cyrb53(token + token)))

const QUESTIONS = [
  { q: 'Do I use the HDMI cord to share my screen?', why: 'No, you click Share screen on this website.' },
  { q: 'When it’s your turn, does your screen share automatically?', why: 'No, you have to press Start presenting.' },
]
const BRIEF_MS = 1500 // how long a right answer's explanation shows before the next question

// Both answers are "No". A wrong answer stays on the question; the last right answer calls onPass from its click
// handler, so the share it starts is still inside the user gesture.
export function QuizModal({ onPass, onCancel }: { onPass: () => void; onCancel: () => void }) {
  const [i, setI] = useState(0)
  const [result, setResult] = useState<boolean | null>(null) // null: unanswered; true/false: right/wrong for this question
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const answer = (yes: boolean) => {
    if (result === true) return // already right, moving on
    if (yes) return setResult(false)
    if (i === QUESTIONS.length - 1) return onPass()
    setResult(true)
    timer.current = setTimeout(() => { setI(i + 1); setResult(null) }, BRIEF_MS)
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-label="Quick quiz" className="w-full max-w-sm space-y-4 rounded-lg bg-neutral-900 p-5">
        <p className="text-xs text-neutral-400">Quick quiz before you share · {i + 1} of {QUESTIONS.length}</p>
        <h2 className="text-xl font-semibold">{QUESTIONS[i].q}</h2>
        <div className="flex gap-3">
          {['Yes', 'No'].map((label) => (
            <button key={label} disabled={result === true} onClick={() => answer(label === 'Yes')} className="flex-1 rounded-lg bg-amber-500 px-4 py-3 text-lg font-semibold text-black disabled:opacity-50">{label}</button>
          ))}
        </div>
        {result !== null && <p className={result ? 'text-green-400' : 'text-red-400'}>{QUESTIONS[i].why}{!result && ' Try again.'}</p>}
        <button className="text-sm text-neutral-400 underline" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
