import { PERF_STATUS, scoreGrade } from '../../lib/performance-model.js'

// The pieces the Performance pages draw with. One place, so a ring on the board
// and the ring on someone's record are the same ring.
//
// 🔒 Each of the three sources keeps ONE colour everywhere it appears — the dot
// in the header legend, the bar in its column, the slice of the donut. That
// colour is what tells the reader "this number came from Admin" without a word.
export const SOURCE_TONE = {
  work: 'var(--color-stage-hired)',
  attendance: 'var(--color-stage-new)',
  manager: 'var(--color-stage-interview)',
}
export const GRADE_TONE = {
  excellent: 'var(--color-stage-hired)',
  good: 'var(--color-stage-short)',
  attention: 'var(--color-stage-interview)',
  poor: 'var(--color-stage-out)',
}
export const STATUS_TONE = {
  'on-track': ['var(--color-pill-active-bg)', 'var(--color-pill-active)'],
  'needs-attention': ['var(--color-pill-leave-bg)', 'var(--color-pill-leave)'],
  'not-scored': ['var(--color-pill-inactive-bg)', 'var(--color-pill-inactive)'],
}
export const gradeTone = (pct) => (pct == null ? 'var(--color-ink-faint)' : GRADE_TONE[scoreGrade(pct).id])
export const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export function StatusChip({ status }) {
  const [bg, ink] = STATUS_TONE[status] || STATUS_TONE['not-scored']
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: bg, color: ink }}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {PERF_STATUS[status] || status}
    </span>
  )
}

// A percentage as a bar. 🔒 A missing number draws NOTHING — an empty track
// reads as zero, and zero is a claim we have not earned.
export function Meter({ pct, tone, width = 120 }) {
  if (pct == null) return <span className="text-[13px] text-[var(--color-ink-faint)]">—</span>
  return (
    <span className="flex items-center gap-2.5">
      <span className="text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">{pct}%</span>
      <span className="h-[6px] overflow-hidden rounded-full bg-[var(--color-fill)]" style={{ width }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: tone }} />
      </span>
    </span>
  )
}

// The overall score as a ring. Not decoration: the ring is the only thing on
// the row that shows how far off the whole number is at a glance.
export function Ring({ pct, size = 40, stroke = 4, children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = gradeTone(pct)
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-fill)" strokeWidth={stroke} />
        {pct != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${(Math.min(100, pct) / 100) * c} ${c}`} />
        )}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        {children || (
          <span className="font-semibold tabular-nums" style={{ fontSize: size / 3.6, color: pct == null ? 'var(--color-ink-faint)' : tone }}>
            {pct == null ? '—' : `${pct}%`}
          </span>
        )}
      </span>
    </span>
  )
}

// "vs last month". 🔑 No comparison and no change are different answers: an
// em dash means we have nothing to compare against, +0 means it held steady.
export function Delta({ value, suffix = 'vs last month' }) {
  if (value == null) return <span className="text-[12px] text-[var(--color-ink-faint)]">— {suffix}</span>
  const up = value > 0
  const tone = value === 0 ? 'var(--color-ink-faint)' : up ? 'var(--color-pill-active)' : 'var(--color-stage-out)'
  return (
    <span className="text-[12px] font-medium" style={{ color: tone }}>
      {up ? '↑' : value < 0 ? '↓' : ''}{Math.abs(value)}% <span className="text-[var(--color-ink-faint)]">{suffix}</span>
    </span>
  )
}

export function Stars({ count }) {
  if (count == null) return <span className="text-[var(--color-ink-faint)]">—</span>
  return (
    <span className="inline-flex items-center gap-0.5" style={{ color: 'var(--color-stage-interview)' }} aria-label={`${count} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="text-[12px]" style={{ opacity: n <= count ? 1 : 0.25 }}>★</span>
      ))}
    </span>
  )
}
