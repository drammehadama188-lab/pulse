import { useState } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import { Button } from './ui.jsx'

const PRESETS = [
  ['this_month', 'This Month'],
  ['last_month', 'Last Month'],
  ['this_quarter', 'This Quarter'],
  ['this_year', 'This Year'],
  ['all', 'All Time'],
]

const startOfMonth = (y, m) => new Date(y, m, 1, 0, 0, 0, 0)
const endOfMonth = (y, m) => new Date(y, m + 1, 0, 23, 59, 59, 999)

export function computePeriod(key, from, to) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (key) {
    case 'this_month':
      return { key, label: 'This Month', from: startOfMonth(y, m), to: now, months: 1 }
    case 'last_month':
      return { key, label: 'Last Month', from: startOfMonth(y, m - 1), to: endOfMonth(y, m - 1), months: 1 }
    case 'this_quarter': {
      const q = Math.floor(m / 3)
      return { key, label: 'This Quarter', from: startOfMonth(y, q * 3), to: now, months: m - q * 3 + 1 }
    }
    case 'this_year':
      return { key, label: 'This Year', from: startOfMonth(y, 0), to: now, months: m + 1 }
    case 'custom': {
      const f = from ? new Date(from + 'T00:00:00') : null
      const t = to ? new Date(to + 'T23:59:59') : null
      const months = f && t ? Math.max(1, (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1) : null
      return { key, label: 'Custom', from: f, to: t, months }
    }
    case 'all':
    default:
      return { key: 'all', label: 'All Time', from: null, to: null, months: null }
  }
}

// keep only records whose date falls within the period
export function inPeriod(period, iso) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (period.from && t < period.from.getTime()) return false
  if (period.to && t > period.to.getTime()) return false
  return true
}

export default function PeriodSelector({ period, onChange }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  function choose(key) {
    setOpen(false)
    onChange(computePeriod(key))
  }
  function applyCustom() {
    if (!from || !to) return
    setOpen(false)
    onChange(computePeriod('custom', from, to))
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)] shadow-[var(--shadow-soft)]"
      >
        <Calendar size={16} className="text-[var(--color-ink-faint)]" />
        {period.label}
        <ChevronDown size={16} className="text-[var(--color-ink-faint)]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-lift)]">
            <div className="py-1">
              {PRESETS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => choose(k)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-[var(--color-line-soft)] ${period.key === k ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink)]'}`}
                >
                  <Calendar size={16} className={period.key === k ? 'text-[var(--color-brand)]' : 'text-[var(--color-ink-faint)]'} />
                  {label}
                </button>
              ))}
            </div>
            <div className="border-t border-[var(--color-line-soft)] p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">Custom range</div>
              <div className="space-y-2">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="focus-ring w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none" />
                <Button size="sm" className="w-full" onClick={applyCustom} disabled={!from || !to}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
