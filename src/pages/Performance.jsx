import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Download, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api.js'
import PeriodPicker from '../components/PeriodPicker.jsx'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'
import PerformanceBoard from './departments/PerformanceBoard.jsx'
import PerformanceDepartments from './departments/PerformanceDepartments.jsx'
import HRTeam from './departments/HRTeam.jsx'
import {
  CUR_PERIOD, slugify, defaultPeriod, periodLabel, scoreForPeriod, salesForPeriod,
  reviewScore, prevMonth, effectiveScore, salesTrendDelta, PERF_GROUPS, groupOf,
} from '../lib/performance.js'

// Performance — the same page shape as Employees (Adama 29 Aug: "we are
// redesigning the performance page to this and the logic too"). Title + count,
// tabs, a row of tiles that ARE the filters, one filter bar, one paginated
// table, one Pager.
//
// 🔒 Every number on this page is measured over ONE period, chosen in the
// header, and every row is computed HERE — the tabs below only draw. Two
// components fetching the same sales and reviews is how the board and the
// employee record came to disagree.
//
// 🔒 A tile's number is exactly the rows clicking it gives you. The four
// scoring tiles are a partition of the roster: everyone is in one and only one,
// and they add up to the count in the title.

const BLANK_FILTERS = { query: '', dept: '', group: '', source: '', min: '', max: '' }

export default function Performance() {
  const [tab, setTab] = useState('team')
  const [period, setPeriod] = useState(defaultPeriod)

  const [roster, setRoster] = useState(null)
  const [rosterFailed, setRosterFailed] = useState(false)
  const [warnings, setWarnings] = useState([])
  const [reviewsByName, setReviewsByName] = useState({})
  const [salesByAgent, setSalesByAgent] = useState({})
  const [live, setLive] = useState({})

  // 🔒 The people scored here are the LIVE roster — the same list Employees
  // shows. It used to be the static src/data/team.js seed file, so anyone hired
  // or moved in Pulse never appeared on the board at all.
  useEffect(() => {
    api('/hr/employees')
      .then((d) => setRoster((d.employees || []).map((e) => ({
        username: e.username, name: e.name, role: e.title || '', type: e.department || 'Other', status: e.status,
      }))))
      .catch(() => { setRoster([]); setRosterFailed(true) })
    api('/warnings').then((d) => setWarnings(d.warnings || [])).catch(() => setWarnings([]))
    api('/agent-sales').then((d) => setSalesByAgent(d.sales || {})).catch(() => setSalesByAgent({}))
    api('/reviews').then((d) => setReviewsByName(d.reviews || {})).catch(() => setReviewsByName({}))
  }, [])

  // Exclude the office cleaner — not a performance-scored role (Adama 27 Jun).
  const team = useMemo(
    () => (roster || []).filter((t) => t.status !== 'maternity' && !/cleaner/i.test(`${t.role || ''} ${t.name || ''}`)),
    [roster],
  )

  useEffect(() => {
    if (!team.length) return undefined
    let alive = true
    Promise.all(team.map((t) =>
      api(`/employee-profile?name=${encodeURIComponent(t.name)}`)
        .then((d) => ({ name: t.name, p: d.profile || {} }))
        .catch(() => ({ name: t.name, p: {} })),
    )).then((got) => {
      if (!alive) return
      const next = {}
      for (const { name, p } of got) {
        const raw = p.performanceScore
        next[name] = { score: raw === '' || raw == null ? null : Number(raw), note: p.performanceNote || '', nextReview: p.nextReview || '' }
      }
      setLive(next)
    })
    return () => { alive = false }
  }, [team])

  const warningsByAgent = useMemo(() => {
    const map = {}
    warnings.forEach((w) => { (map[w.agent] = map[w.agent] || []).push(w) })
    return map
  }, [warnings])

  // ONE row per person, computed once, ranked. Everything below reads this.
  const rows = useMemo(() => team.map((t) => {
    const manual = scoreForPeriod(t.name, period, live, reviewsByName)
    const sales = salesByAgent[t.name]
    const eff = effectiveScore(manual, t, sales, period)
    const revs = (reviewsByName[t.name] || []).filter((r) => r.score != null)
      .slice().sort((a, b) => b.period.localeCompare(a.period))
    const lastReview = revs[0] ? { period: revs[0].period, score: Number(revs[0].score) } : null
    let trend = null
    if (eff.source === 'sales') trend = salesTrendDelta(sales, period)
    else if (eff.score != null) {
      const base = period.kind === 'range' ? (period.months?.[0] ? prevMonth(period.months[0]) : null) : period.period ? prevMonth(period.period) : null
      const prev = base ? reviewScore(reviewsByName, t.name, base) : null
      trend = prev == null ? null : eff.score - prev
    }
    return {
      key: t.username || t.name,
      person: t,
      name: t.name,
      role: t.role,
      dept: t.type || 'Other',
      href: `/performance/${slugify(t.name)}`,
      score: eff.score,
      source: eff.source,
      group: groupOf(eff.score),
      trend,
      sales: salesForPeriod(sales, period),
      lastReview,
      warnings: warningsByAgent[t.name]?.length || 0,
      reviewDue: period.kind === 'current' && reviewScore(reviewsByName, t.name, CUR_PERIOD) == null,
    }
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), [team, period, live, reviewsByName, salesByAgent, warningsByAgent])

  // 🔒 The filters live HERE, beside the rows they cut, so the tiles, the
  // table and Export are looking at the same list. Export used to sit in the
  // header with the filters in the table below it, so filtering to "Needs
  // attention" and pressing Export handed you the whole board.
  const [filters, setFilters] = useState(BLANK_FILTERS)
  const patch = (p) => setFilters((f) => ({ ...f, ...p }))

  const visible = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.dept && r.dept !== filters.dept) return false
      if (filters.group && r.group !== filters.group) return false
      if (filters.source && (r.source || 'none') !== filters.source) return false
      if (filters.min !== '' && (r.score == null || r.score < Number(filters.min))) return false
      if (filters.max !== '' && (r.score == null || r.score > Number(filters.max))) return false
      if (q && !`${r.name} ${r.role} ${r.dept}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filters])

  const departments = useMemo(() => [...new Set(rows.map((r) => r.dept))].sort(), [rows])

  const counts = useMemo(() => {
    const c = { total: rows.length, rated: 0, sum: 0 }
    PERF_GROUPS.forEach((g) => { c[g.id] = 0 })
    rows.forEach((r) => { c[r.group] += 1; if (r.score != null) { c.rated += 1; c.sum += r.score } })
    c.average = c.rated ? Math.round(c.sum / c.rated) : null
    return c
  }, [rows])

  function exportCsv(list) {
    const head = ['Name', 'Role', 'Department', 'Period', 'Score', 'Scored from', 'Sales', 'Target', 'Trend', 'Last review', 'Warnings']
    const body = list.map((r) => [
      r.name, r.role, r.dept, period.label,
      r.score == null ? '' : r.score,
      r.source === 'manual' ? 'Manager review' : r.source === 'sales' ? 'Sales attainment' : 'Not scored',
      r.sales ? r.sales.sales : '', r.sales?.target ?? '',
      r.trend == null ? '' : r.trend,
      r.lastReview ? `${periodLabel(r.lastReview.period)} · ${r.lastReview.score}%` : '',
      r.warnings || '',
    ])
    const csv = [head, ...body].map((line) => line.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `pulse-performance-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const btn = 'inline-flex items-center gap-2 transition-colors'
  const light = `${btn} btn-secondary hover:bg-[var(--color-soft)]`

  if (!roster) return <PageSkeleton tiles={5} rows={8} />

  const TABS = [['team', 'Team'], ['departments', 'Departments'], ['kpi', 'KPI settings']]

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-page flex items-center gap-3 text-[var(--color-ink)]">
            Performance
            <span className="rounded-full bg-[var(--color-fill)] px-3 py-1 text-[15px] font-semibold text-[var(--color-ink-soft)]">{counts.total}</span>
          </h1>
          <p className="t-support mt-2">How everyone is performing against their targets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker value={period} onChange={setPeriod} />
          {tab !== 'kpi' && (
            <button onClick={() => exportCsv(tab === 'team' ? visible : rows)} className={light}><Download size={15} /> Export</button>
          )}
          <Link to="/reviews" className={`${btn} btn-primary hover:bg-[var(--color-brand-600)]`}>
            <ShieldAlert size={15} /> Reviews &amp; coaching
          </Link>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-1 border-b border-[var(--color-line)]">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-medium ${tab === k ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {rosterFailed && (
        <p className="mb-4 text-[13px] text-[var(--color-stage-out)]">
          Could not load the team. The board is empty rather than out of date.
        </p>
      )}

      {tab === 'team' && (
        <PerformanceBoard
          rows={visible} counts={counts} period={period}
          departments={departments} filters={filters} onFilter={patch}
          onClearFilters={() => setFilters(BLANK_FILTERS)} onExport={exportCsv}
        />
      )}
      {tab === 'departments' && <PerformanceDepartments rows={rows} period={period} />}
      {tab === 'kpi' && <HRTeam only={['kpi']} title="KPI settings" subtitle="Rules and targets per role" />}
    </div>
  )
}
