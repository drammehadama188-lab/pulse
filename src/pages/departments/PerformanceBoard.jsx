import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, TrendingUp, TrendingDown, Minus, AlertTriangle, Search, ChevronRight, CheckCircle2, CalendarClock } from 'lucide-react'
import { api } from '../../lib/api.js'
import PeriodPicker from '../../components/PeriodPicker.jsx'
import {
  CUR_PERIOD, slugify, band, defaultPeriod, scoreForPeriod, salesForPeriod, reviewScore, prevMonth, pctChip,
  effectiveScore, salesTrendDelta,
} from '../../lib/performance.js'

// Performance overview — answers "who is performing, who isn't". A clean,
// serious table; clicking a person opens their full-width performance page
// (/performance/:slug), NOT a cramped drawer. Every number is real (manager
// scores, locked reviews, sales from Ya Fatou's sheet). No sampled data.

function Trend({ delta, size = 14 }) {
  if (delta == null) return <Minus size={size} className="text-[var(--color-ink-faint)]" />
  if (delta > 0) return <span className="inline-flex items-center font-semibold text-[var(--color-good)]"><TrendingUp size={size} />+{delta}</span>
  if (delta < 0) return <span className="inline-flex items-center font-semibold text-red-500"><TrendingDown size={size} />{delta}</span>
  return <Minus size={size} className="text-[var(--color-ink-faint)]" />
}

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'Sales', label: 'Sales' }, { id: 'Customer Service', label: 'Customer Service' },
  { id: 'Operations', label: 'Operations' }, { id: 'top', label: 'Above 90' }, { id: 'low', label: 'Below 60' },
  { id: 'review', label: 'Review due' }, { id: 'new', label: 'New / Probation' },
]

export default function PerformanceBoard({ team = [], warningsByAgent = {} }) {
  const navigate = useNavigate()
  // Exclude the office cleaner — not a performance-scored role (Adama 27 Jun).
  const roster = useMemo(() => team.filter((t) => t.status !== 'maternity' && !/cleaner/i.test(`${t.role || ''} ${t.name || ''}`)), [team])
  const [period, setPeriod] = useState(defaultPeriod)

  const [live, setLive] = useState({})
  const [reviewsByName, setReviewsByName] = useState({})
  const [salesByAgent, setSalesByAgent] = useState({})
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    api('/agent-sales').then((d) => setSalesByAgent(d.sales || {})).catch(() => setSalesByAgent({}))
    api('/reviews').then((d) => setReviewsByName(d.reviews || {})).catch(() => setReviewsByName({}))
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all(roster.map((t) =>
      api(`/employee-profile?name=${encodeURIComponent(t.name)}`).then((d) => ({ name: t.name, p: d.profile || {} })).catch(() => ({ name: t.name, p: {} }))
    )).then((rows) => {
      if (!alive) return
      const next = {}
      for (const { name, p } of rows) { const raw = p.performanceScore; next[name] = { score: raw === '' || raw == null ? null : Number(raw), note: p.performanceNote || '', nextReview: p.nextReview || '' } }
      setLive(next)
    })
    return () => { alive = false }
  }, [roster])

  const open = (name) => navigate(`/performance/${slugify(name)}`)
  const personOf = (name) => roster.find((r) => r.name === name)
  // Headline score = manual review/live score, else real sales attainment for sales roles.
  const scoreOf = (name) => effectiveScore(scoreForPeriod(name, period, live, reviewsByName), personOf(name), salesByAgent[name], period).score
  const trendOf = (name) => {
    const eff = effectiveScore(scoreForPeriod(name, period, live, reviewsByName), personOf(name), salesByAgent[name], period)
    if (eff.source === 'sales') return salesTrendDelta(salesByAgent[name], period)
    if (eff.score == null) return null
    const basePeriod = period.kind === 'range' ? (period.months?.[0] ? prevMonth(period.months[0]) : null) : prevMonth(period.period)
    if (!basePeriod) return null
    const prev = reviewScore(reviewsByName, name, basePeriod)
    return prev == null ? null : eff.score - prev
  }
  const reviewDue = (name) => period.kind === 'current' && reviewScore(reviewsByName, name, CUR_PERIOD) == null

  const ranked = useMemo(() => roster.map((t) => ({ t, score: scoreOf(t.name) })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), [roster, period, live, reviewsByName, salesByAgent])
  const rated = ranked.filter((r) => r.score != null)
  const avg = rated.length ? Math.round(rated.reduce((s, r) => s + r.score, 0) / rated.length) : null
  const top = rated[0]
  const needs = rated.length ? rated[rated.length - 1] : null
  const reviewedCount = period.kind === 'current'
    ? roster.filter((t) => reviewScore(reviewsByName, t.name, CUR_PERIOD) != null).length
    : rated.length

  const depts = useMemo(() => {
    const groups = {}
    roster.forEach((t) => { const k = t.type || 'Other'; (groups[k] = groups[k] || []).push(scoreOf(t.name)) })
    const arr = Object.entries(groups).map(([name, vals]) => { const r = vals.filter((x) => x != null); return { name, avg: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null, n: vals.length } })
    const rankable = arr.filter((d) => d.avg != null).sort((a, b) => b.avg - a.avg)
    return arr.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)).map((d) => {
      let status = 'Stable'
      if (d.avg == null) status = 'Not rated'
      else if (rankable.length > 1 && d.name === rankable[0].name) status = 'Best performing'
      else if (rankable.length > 1 && d.name === rankable[rankable.length - 1].name) status = 'Needs improvement'
      return { ...d, status }
    })
  }, [roster, period, live, reviewsByName, salesByAgent])

  const filtered = ranked.filter(({ t, score }) => {
    if (q && !t.name.toLowerCase().includes(q.toLowerCase())) return false
    switch (filter) {
      case 'all': return true
      case 'top': return score != null && score >= 90
      case 'low': return score != null && score < 60
      case 'review': return reviewDue(t.name) || (warningsByAgent[t.name]?.length || 0) > 0
      case 'new': return t.status === 'probation' || t.status === 'training'
      default: return t.type === filter
    }
  })

  return (
    <div className="space-y-4">
      {/* Period switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-[var(--color-ink-faint)]" />
          <span className="text-[13px] font-semibold text-[var(--color-ink-soft)]">Period</span>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        <p className="text-[11.5px] text-[var(--color-ink-faint)]">{period.kind === 'current' ? 'Live scores — change until the month is reviewed and locked.' : period.kind === 'month' ? 'Locked monthly review scores.' : 'Average of locked reviews in this period.'}</p>
      </div>

      {/* Summary tiles — performance only */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Performance health" value={avg == null ? '—' : `${avg}%`} sub={`${rated.length}/${roster.length} rated`} accent={band(avg).text} />
        <Tile label="Top performer" value={top ? top.t.name.split(' ')[0] : '—'} sub={top ? `${top.score}%` : 'no scores yet'} accent="text-[var(--color-good)]" icon={Trophy} onClick={top && (() => open(top.t.name))} />
        <Tile label="Needs coaching" value={needs ? needs.t.name.split(' ')[0] : '—'} sub={needs ? `${needs.score}%` : '—'} accent="text-red-600" icon={AlertTriangle} onClick={needs && (() => open(needs.t.name))} />
        <Tile label="Reviewed" value={`${reviewedCount}/${roster.length}`} sub={period.kind === 'current' ? 'this month' : 'in period'} accent="text-blue-600" icon={CheckCircle2} />
      </div>

      {/* Department performance */}
      <div className="rounded-lg border border-[var(--color-line)] bg-white p-5">
        <h3 className="mb-3 text-[11.5px] font-medium text-[var(--color-ink-soft)]">Department performance · {period.label}</h3>
        <div className="space-y-2.5">
          {depts.map((d) => {
            const b = band(d.avg)
            const sb = d.status === 'Best performing' ? 'bg-[var(--color-good-bg)] text-[var(--color-good)]' : d.status === 'Needs improvement' ? 'bg-red-100 text-red-700' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'
            return (
              <div key={d.name} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-[13px] font-medium text-[var(--color-ink-soft)]">{d.name} <span className="text-[var(--color-ink-faint)]">· {d.n}</span></span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--color-fill)]"><div className={`h-full rounded-full ${b.bar}`} style={{ width: `${d.avg ?? 0}%` }} /></div>
                <span className={`w-11 text-right text-[13px] font-semibold ${b.text}`}>{d.avg == null ? '—' : `${d.avg}%`}</span>
                <span className={`hidden w-32 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium sm:inline-block ${sb}`}>{d.status}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Team table */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${filter === f.id ? 'bg-[var(--color-ink)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'}`}>{f.label}</button>)}
          </div>
          <div className="relative w-full sm:w-56"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full rounded-full border border-[var(--color-line)] bg-white py-2 pl-9 pr-3 text-[13px] focus:border-[var(--color-ink-faint)] focus:outline-none" /></div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-[var(--color-line)] bg-white">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
                <th className="w-10 px-4 py-3 text-center font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Employee</th>
                <th className="hidden px-3 py-3 font-semibold md:table-cell">Department</th>
                <th className="hidden px-3 py-3 font-semibold sm:table-cell">KPI</th>
                <th className="px-3 py-3 text-right font-semibold">Score</th>
                <th className="hidden px-3 py-3 text-center font-semibold sm:table-cell">Trend</th>
                <th className="hidden px-3 py-3 font-semibold lg:table-cell">Status</th>
                <th className="w-8 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">No one matches this filter.</td></tr>}
              {filtered.map(({ t, score }, i) => {
                const b = band(score)
                const w = warningsByAgent[t.name]?.length || 0
                const ls = salesForPeriod(salesByAgent[t.name], period)
                const lsPct = ls && ls.target ? Math.round((ls.sales / ls.target) * 100) : null
                const due = reviewDue(t.name)
                const initials = t.name.split(' ').map((x) => x[0]).slice(0, 2).join('')
                return (
                  <tr key={t.name} onClick={() => open(t.name)} className="cursor-pointer border-b border-[var(--color-line-soft)] transition-colors last:border-0 hover:bg-[var(--color-fill)]">
                    <td className="px-4 py-3 text-center text-[13px] font-semibold text-[var(--color-ink-faint)]">{score == null ? '·' : i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold text-white ${b.bar}`}>{initials}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-[var(--color-ink)]">{t.name}</span>
                            {w > 0 && <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 text-[10px] font-medium text-red-600"><AlertTriangle size={9} />{w}</span>}
                            {due && <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 text-[10px] font-medium text-amber-600">Review due</span>}
                          </div>
                          <div className="truncate text-[11.5px] text-[var(--color-ink-soft)]">{t.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 text-[13px] text-[var(--color-ink-soft)] md:table-cell">{t.type}</td>
                    <td className="hidden px-3 py-3 sm:table-cell">{ls && ls.target != null ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${pctChip(lsPct)}`}>{ls.sales}/{ls.target}</span> : <span className="text-[var(--color-ink-faint)]">—</span>}</td>
                    <td className={`px-3 py-3 text-right text-[15px] font-semibold ${b.text}`}>{score == null ? '—' : `${score}%`}</td>
                    <td className="hidden px-3 py-3 text-center text-[12px] sm:table-cell"><Trend delta={trendOf(t.name)} /></td>
                    <td className="hidden px-3 py-3 lg:table-cell"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${b.chip}`}>{b.label}</span></td>
                    <td className="px-2 py-3 text-right"><ChevronRight size={16} className="text-[var(--color-ink-faint)]" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">Click a row to open the full performance page. Trend = change vs the previous month's locked review.</p>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, accent = 'text-[var(--color-ink)]', icon: Icon, onClick }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp onClick={onClick || undefined} className={`rounded-lg border border-[var(--color-line)] bg-white p-4 text-left ${onClick ? 'hover:border-[var(--color-line)]' : ''}`}>
      <div className="mb-1 flex items-center gap-1.5">{Icon && <Icon size={13} className="text-[var(--color-ink-faint)]" />}<p className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">{label}</p></div>
      <p className={`truncate text-[22px] font-semibold ${accent}`}>{value}</p>
      <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{sub}</p>
    </Cmp>
  )
}
