import { useEffect, useState } from 'react'
import { Calendar, HelpCircle, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'
import HRTeam from './departments/HRTeam.jsx'
import PerformanceBoard from './departments/PerformanceBoard.jsx'
import { PERF_WEIGHTS } from '../../lib/performance-model.js'
import { SOURCE_TONE } from '../components/performance.jsx'

// Performance — Adama's 29 Aug design. "Track performance, attendance and
// reviews in one place."
//
// 🔒 THE POINT OF THE PAGE: a score here is CALCULATED, never typed. Work KPIs
// from Admin, attendance from Pulse, the manager's assessment — 60 / 15 / 25.
// Every column names the system its number came from, and the legend at the top
// keeps those three colours consistent down the table. The old page showed one
// number a manager had typed in and called it performance.
//
// The numbers all come from /api/performance/board, which is also what one
// person's record page reads, so a row and the page behind it cannot disagree.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m) => { const [y, mo] = String(m).split('-'); return `${MONTHS[Number(mo) - 1] || '?'} ${y}` }
const shortDay = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
// This month back through the last eleven — a period is a MONTH here, because
// attendance, KPI targets and a review are all monthly things.
function monthOptions() {
  const now = new Date()
  const out = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
const CUR_MONTH = monthOptions()[0]


export default function Performance() {
  const [tab, setTab] = useState('team')
  const [month, setMonth] = useState(CUR_MONTH)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [explain, setExplain] = useState(false)

  useEffect(() => {
    setData(null)
    setError(null)
    api(`/performance/board?month=${month}`).then(setData).catch((e) => setError(e.message))
  }, [month])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page text-[var(--color-ink)]">Performance</h1>
          <p className="t-support mt-2">Track performance, attendance and reviews in one place.</p>
        </div>
        <button onClick={() => setExplain(true)}
          className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-brand)] hover:underline">
          <HelpCircle size={15} /> How performance works
        </button>
      </div>

      <div className="mb-6 flex items-center gap-1 border-b border-[var(--color-line)]">
        {[['team', 'Team performance'], ['kpi', 'KPI settings']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium ${tab === k ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'kpi' && <HRTeam only={['kpi']} title="KPI settings" subtitle="Rules and targets per role" />}

      {tab === 'team' && (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-soft)]">
                <Calendar size={15} className="text-[var(--color-ink-faint)]" /> Period
              </span>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="field" aria-label="Month">
                {monthOptions().map((m) => (
                  <option key={m} value={m}>{m === CUR_MONTH ? 'This month' : monthLabel(m)}</option>
                ))}
              </select>
            </span>
            {/* 🔒 The legend is the key to the whole table: these three colours
                mean the same three systems in every column below. */}
            <span className="flex flex-wrap items-center gap-4 text-[12px] text-[var(--color-ink-faint)]">
              <span>Data sources:</span>
              {[['work', 'Admin (work)'], ['attendance', 'Pulse (attendance)'], ['manager', 'Manager (assessment)']].map(([k, label]) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-[var(--color-ink-soft)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: SOURCE_TONE[k] }} /> {label}
                </span>
              ))}
            </span>
          </div>

          {error && <p className="mb-4 text-[13px] text-[var(--color-stage-out)]">{error}</p>}
          {!data && !error && <PageSkeleton tiles={5} rows={6} />}

          {data && <PerformanceBoard data={data} month={month} isCurrentMonth={month === CUR_MONTH} />}
        </>
      )}

      {explain && <HowItWorks weights={data?.weights || PERF_WEIGHTS} onClose={() => setExplain(false)} />}
    </div>
  )
}



// The explanation lives behind a click, not on the page. Anyone judged by this
// score is owed the rule that produced it.
function HowItWorks({ weights, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(11,18,32,0.45)] p-4 sm:p-8" onClick={onClose}>
      <div className="card w-full max-w-[520px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">How performance works</h2>
          <button onClick={onClose} className="rounded-[6px] p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-fill)]"><X size={16} /></button>
        </div>
        <ul className="mt-4 space-y-3">
          {[['work', 'Work KPIs', weights.work, 'Your role’s targets, measured by Admin. Only KPIs Admin can answer for are counted.'],
            ['attendance', 'Attendance', weights.attendance, 'Days present out of days scheduled, from Pulse.'],
            ['manager', 'Manager assessment', weights.manager, 'Your manager’s review for the month. Until it is written, it is not part of the score.']].map(([k, label, w, line]) => (
              <li key={k} className="flex gap-3">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOURCE_TONE[k] }} />
                <span>
                  <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{label} · {w}%</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">{line}</span>
                </span>
              </li>
            ))}
        </ul>
        <p className="mt-5 rounded-[8px] p-3 text-[12.5px] leading-relaxed"
          style={{ background: 'var(--color-stage-new-bg)', color: 'var(--color-stage-new)' }}>
          Scores are calculated automatically from Admin and Pulse data. Managers provide assessment and feedback — they do not override factual results.
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
          A source with no number for the month is left out of the calculation rather than counted as zero, so an unwritten review never lowers anyone&rsquo;s score.
        </p>
      </div>
    </div>
  )
}
