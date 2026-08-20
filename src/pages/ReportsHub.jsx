import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'

// REPORTING CENTRE (Adama 10 Jul): every report answers ONE question, and the
// period is separate from the report type. One structure for all — summary,
// key metrics, detail, recent activity, notes. Unmeasured things are named,
// never invented.

const REPORTS = [
  ['overview', 'Overview', 'all'],
  ['sales', 'Sales', 'all'],
  ['cs', 'Customer Service', 'all'],
  ['operations', 'Operations', 'all'],
  ['finance', 'Finance', 'hr'],
  ['people', 'People', 'hr'],
  ['managers', 'Managers', 'all'],
]
const PERIODS = [
  ['today', 'Today'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['last_month', 'Last Month'],
  ['quarter', 'Quarter'],
  ['year', 'Year'],
]
const STATUS_TONE = { 'On target': 'text-[var(--color-good)]', 'Needs attention': 'text-amber-600', Behind: 'text-[var(--color-bad)]', 'no data': 'text-[var(--color-ink-faint)]' }

export default function ReportsHub() {
  const { hasPower } = useAuth()
  const isHr = hasPower('hr')
  const navigate = useNavigate()
  const location = useLocation()
  const reports = REPORTS.filter(([, , gate]) => gate === 'all' || isHr)

  const q = new URLSearchParams(location.search)
  const [report, setReport] = useState(reports.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'overview')
  const [period, setPeriod] = useState(PERIODS.some(([k]) => k === q.get('period')) ? q.get('period') : 'month')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null); setError('')
    navigate(`/reports?tab=${report}&period=${period}`, { replace: true })
    api(`/reportx?report=${report}&period=${period}`).then(setData).catch((e) => setError(e.message))
  }, [report, period])

  return (
    <div className="max-w-4xl space-y-6">
      {/* selector 1: which question */}
      <div className="flex flex-wrap gap-1.5">
        {reports.map(([k, label]) => (
          <button key={k} onClick={() => setReport(k)} className={`rounded-xl px-3.5 py-2 text-sm font-bold ${report === k ? 'bg-[var(--color-ink)] text-white' : 'border border-[var(--color-line-soft)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>{label}</button>
        ))}
      </div>
      {/* selector 2: which period */}
      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map(([k, label]) => (
          <button key={k} onClick={() => setPeriod(k)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${period === k ? 'bg-[var(--color-brand)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>{label}</button>
        ))}
      </div>

      {error && <Card className="p-8 text-center text-sm text-[var(--color-ink-faint)]">Couldn't load — {error}</Card>}
      {!data && !error && <div className="flex justify-center py-24"><Spinner size={28} /></div>}
      {data && (
        <div className="space-y-6">
          {/* 1 · title */}
          <div>
            <h1 className="text-[27px] font-semibold tracking-tight text-[var(--color-ink)]">{reports.find(([k]) => k === report)?.[1]} report</h1>
            <p className="mt-0.5 text-[var(--color-ink-soft)]">{data.period.label} · <span className="italic">{data.question}</span></p>
          </div>

          {/* 2 · summary */}
          <Card className="border-l-4 border-[var(--color-brand)] p-4">
            <p className="text-sm leading-relaxed text-[var(--color-ink)]">{data.summary}</p>
          </Card>

          {/* 3 · key metrics */}
          {data.metrics.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {data.metrics.map((m) => (
                <Card key={m.label} className="min-w-[9rem] p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">{m.label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-ink)]">{m.value}</div>
                  {m.sub && <div className="text-xs text-[var(--color-ink-faint)]">{m.sub}</div>}
                </Card>
              ))}
            </div>
          )}

          {/* 4 · detail */}
          {data.sections.map((sec) => (
            <section key={sec.title}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{sec.title}</h2>
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  {sec.head && (
                    <thead><tr className="border-b border-[var(--color-line-soft)] text-left text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]">
                      {sec.head.map((h) => <th key={h} className="px-4 py-2.5">{h}</th>)}
                    </tr></thead>
                  )}
                  <tbody className="divide-y divide-[var(--color-line-soft)]">
                    {sec.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((c, j) => <td key={j} className={`px-4 py-2.5 ${j === 0 ? 'font-semibold text-[var(--color-ink)]' : STATUS_TONE[c] || 'text-[var(--color-ink-soft)]'}`}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          ))}

          {/* 5 · recent activity */}
          {data.activity.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Recent activity</h2>
              <Card className="space-y-1 p-4">
                {data.activity.map((a, i) => <p key={i} className="text-sm text-[var(--color-ink-soft)]">{a}</p>)}
              </Card>
            </section>
          )}

          {/* 6 · notes */}
          {data.notes.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Notes</h2>
              <Card className="space-y-1 p-4">
                {data.notes.map((n, i) => <p key={i} className="text-xs text-[var(--color-ink-faint)]">{n}</p>)}
              </Card>
            </section>
          )}

          <p className="text-[11px] text-[var(--color-ink-faint)]">Generated {new Date(data.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — derived live, nothing hand-written.</p>
        </div>
      )}
    </div>
  )
}
