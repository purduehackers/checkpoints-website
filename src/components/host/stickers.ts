// "In Line" sticky notes: color + doodle are picked from the queue entry id, so a card keeps its look as it moves up.
// Purple is left out: black text on it is too dark to read from the back of the room.
export const COLORS = ['bg-ph-orange', 'bg-ph-blue', 'bg-ph-yellow', 'bg-ph-pink', 'bg-ph-lime', 'bg-ph-teal'] as const
export const DOODLES = [
  { src: '/host/avatar-1.png', className: 'mix-blend-color-burn' },
  { src: '/host/avatar-2.png', className: 'mix-blend-color-burn' },
  { src: '/host/avatar-3.png', className: 'opacity-32 object-bottom' },
] as const

const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0 }

// Each card takes its hashed pick, stepping forward only if the card above already has it.
// ponytail: a neighbor clash can shift a card's look when the queue reorders; rare and only by one step.
export const stickers = (ids: string[]) => {
  const out: { color: (typeof COLORS)[number], doodle: number }[] = []
  for (const id of ids) {
    const h = hash(id), prev = out.at(-1)
    let c = h % COLORS.length, d = (h >>> 8) % DOODLES.length
    if (prev && COLORS[c] === prev.color) c = (c + 1) % COLORS.length
    if (prev && d === prev.doodle) d = (d + 1) % DOODLES.length
    out.push({ color: COLORS[c], doodle: d })
  }
  return out
}

// "+3 more: Eve, Finn, Gus" for the people past the shown cards; names after the fifth collapse into "…".
export const moreLine = (names: string[]) =>
  names.length ? `+${names.length} more: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}` : ''
