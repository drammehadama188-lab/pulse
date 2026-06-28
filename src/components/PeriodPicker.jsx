import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import { buildStandardPeriods, monthsBetween, CUR_PERIOD } from '../lib/performance.js'

// Standard Pulse period picker (Adama 27 Jun): This Month / Last Month / This
// Quarter / This Year / All Time, plus a custom date range. Emits a period
// object the performance helpers understand ({ id, label, kind, period?, months? }).
const fmtShort = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }

export default function PeriodPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const ref = useRef(null)
  const presets = buildStandardPeriods()

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function pick(p) { onChange(p); setOpen(false) }
  function applyCustom() {
    const months = monthsBetween(from, to)
    if (!months.length) return
    const kind = months.length === 1 && months[0] === CUR_PERIOD ? 'current' : 'range'
    onChange({ id: 'custom', label: `${fmtShort(from)} – ${fmtShort(to)}`, kind, period: months[0], months })
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:border-gray-300 focus:outline-none">
        <Calendar size={15} className="text-gray-400" />
        {value?.label || 'This Month'}
        <ChevronDown size={15} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white p-1.5 shadow-xl">
          {presets.map((p) => {
            const active = value?.id === p.id
            return (
              <button key={p.id} onClick={() => pick(p)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${active ? 'bg-blue-50 font-semibold text-blue-600' : 'text-gray-700 hover:bg-gray-50'}`}>
                <Calendar size={15} className={active ? 'text-blue-500' : 'text-gray-400'} />
                {p.label}
              </button>
            )
          })}

          <div className="my-1.5 border-t border-[var(--color-line-soft)]" />

          <div className="px-2 pb-1.5 pt-1">
            <p className="mb-2 px-1 text-sm font-bold text-gray-800">Custom Range</p>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none" />
            <button onClick={applyCustom} disabled={!from || !to} className={`w-full rounded-xl py-2.5 text-sm font-bold transition-colors ${from && to ? 'bg-[var(--color-brand)] text-white hover:brightness-95' : 'bg-gray-200 text-white'}`}>Apply</button>
          </div>
        </div>
      )}
    </div>
  )
}
