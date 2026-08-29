import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Search, Trophy, ArrowUp, ChevronRight } from 'lucide-react'
import Pager, { usePager } from '../../components/ui/Pager.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { PERF_WEIGHTS, PERF_STATUS } from '../../../lib/performance-model.js'
import { SOURCE_TONE, StatusChip, Meter, Ring, Delta, Stars, initials, gradeTone } from '../../components/performance.jsx'

// The Team performance tab: the five figures, the status filter, and one row per
// person. Everything it draws arrives in `data` from /api/performance/board — it
// fetches nothing and scores nothing itself, so this file cannot become a second
// opinion about anybody's number.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m) => { const [y, mo] = String(m).split('-'); return `${MONTHS[Number(mo) - 1] || '?'} ${y}` }
const shortDay = (iso) => {
  const d = new Date(iso || '')
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const toneOf = (id) => (id === 'on-track' ? 'var(--color-pill-active)' : id === 'needs-attention' ? 'var(--color-pill-leave)' : 'var(--color-ink-soft)')
const tint = (id) => (id === 'on-track' ? 'var(--color-pill-active-bg)' : id === 'needs-attention' ? 'var(--color-pill-leave-bg)' : 'var(--color-pill-inactive-bg)')
const Dot = ({ k }) => <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: SOURCE_TONE[k] }} />

const FILTERS = [
  { id: 'all', label: 'All', count: (s) => s.employees },
  { id: 'on-track', label: PERF_STATUS['on-track'], count: (s) => s.onTrack },
  { id: 'needs-attention', label: PERF_STATUS['needs-attention'], count: (s) => s.needsAttention },
  { id: 'not-scored', label: PERF_STATUS['not-scored'], count: (s) => s.notScored },
]

function Figure({ label, value, tone, foot }) {
  return (
    <div className="card p-5">
      <p className="text-[12px] font-medium text-[var(--color-ink-faint)]">{label}</p>
      <p className="mt-2.5 text-[30px] font-semibold leading-none tracking-[-0.5px] tabular-nums" style={{ color: tone }}>{value}</p>
      <p className="mt-2.5">{foot}</p>
    </div>
  )
}

// A cold render (the render test, or a failed load) must still paint.
const NO_DATA = { people: [], summary: { employees: 0, onTrack: 0, needsAttention: 0, notScored: 0, averagePerformance: null, performanceDelta: null, attendanceAverage: null, attendanceDelta: null, reviewsDue: 0, reviewsTotal: 0, topPerformer: null } }

export default function PerformanceBoard({ data = NO_DATA, month = '', isCurrentMonth = true }) {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const people = data?.people || []
    const q = query.trim().toLowerCase()
    return people
      .slice()
      .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
      .filter((p) => (filter === 'all' || p.status === filter)
        && (!q || `${p.name} ${p.title} ${p.department}`.toLowerCase().includes(q)))
  }, [data, filter, query])

  const pager = usePager(rows)
  useEffect(() => { pager.reset() }, [filter, query, month])

  function exportCsv() {
    const head = ['Employee', 'Role', 'Department', 'Month', 'Work KPIs %', 'Targets met', 'Attendance %', 'Late days', 'Manager review', 'Overall %', 'Status']
    const body = rows.map((p) => [
      p.name, p.title, p.department, month,
      p.work?.pct ?? '', p.work?.measured ? `${p.work.met} of ${p.work.measured}` : '',
      p.attendance.pct ?? '', p.attendance.late ?? '',
      p.manager.reviewed ? `${p.manager.pct}%` : 'Not reviewed',
      p.overall ?? '', PERF_STATUS[p.status],
    ])
    const csv = [head, ...body].map((line) => line.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `pulse-performance-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const s = data.summary || NO_DATA.summary
  // Only somebody actually on track earns the word "top".
  const leading = s.topPerformer?.status === 'on-track'
  const field = 'field'
  const th = 'h-[46px] whitespace-nowrap px-3.5 text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]'
  const td = 'h-[72px] px-3.5 py-3 align-middle'

  return (
    <>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
      {/* Four counts of the same list, and a person's whole name, each earn
          twice the width the single figures beside them get. A tile that has to
          hyphenate a name is too narrow, not the name's problem. */}
      <div className="card p-5 md:col-span-2">
        <p className="text-[12px] font-medium text-[var(--color-ink-faint)]">Team overview</p>
        <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-3.5">
          {[[s.employees, 'Employees', 'var(--color-ink)'],
            [s.onTrack, 'On track', 'var(--color-pill-active)'],
            [s.needsAttention, 'Needs attention', 'var(--color-pill-leave)'],
            [s.notScored, 'Not yet scored', 'var(--color-ink-faint)']].map(([n, label, tone]) => (
              <span key={label} className="min-w-0 whitespace-nowrap">
                <span className="block text-[24px] font-semibold leading-none tabular-nums" style={{ color: tone }}>{n}</span>
                <span className="mt-2 block text-[11.5px] leading-tight text-[var(--color-ink-faint)]">{label}</span>
              </span>
            ))}
        </div>
      </div>

      <Figure label="Average performance" value={s.averagePerformance == null ? '—' : `${s.averagePerformance}%`}
        tone={gradeTone(s.averagePerformance)} foot={<Delta value={s.performanceDelta} />} />
      <Figure label="Attendance average" value={s.attendanceAverage == null ? '—' : `${s.attendanceAverage}%`}
        tone={SOURCE_TONE.attendance} foot={<Delta value={s.attendanceDelta} />} />
      <Figure label="Reviews due" value={`${s.reviewsDue}/${s.reviewsTotal}`}
        tone={s.reviewsDue ? 'var(--color-stage-interview)' : 'var(--color-pill-active)'}
        foot={<span className="text-[12px] text-[var(--color-ink-faint)]">{isCurrentMonth ? 'This month' : monthLabel(month)}</span>} />

      {/* 🔒 "Top performer" is a claim, and it is only true when the best score
          is actually a good one. With nobody on track the tile was putting a
          trophy over somebody who needs attention and calling her the top
          performer (Adama 29 Aug). Then it says what it really is: the highest
          score this month. */}
      <div className="card flex items-start gap-3 p-5 md:col-span-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={leading
            ? { background: 'var(--color-pill-active-bg)', color: 'var(--color-pill-active)' }
            : { background: 'var(--color-fill)', color: 'var(--color-ink-faint)' }}>
          {leading ? <Trophy size={17} strokeWidth={1.8} /> : <ArrowUp size={17} strokeWidth={1.8} />}
        </span>
        <span className="min-w-0">
          <span className="block text-[12px] font-medium text-[var(--color-ink-faint)]">
            {leading ? 'Top performer' : 'Highest this month'}
          </span>
          {s.topPerformer ? (
            <>
              <button onClick={() => navigate(`/performance/${s.topPerformer.username}`)}
                className="mt-1 block truncate text-[15px] font-semibold text-[var(--color-ink)] hover:underline">
                {s.topPerformer.name}
              </button>
              <span className="mt-1 block truncate text-[12px] text-[var(--color-ink-faint)]">
                <span className="font-semibold" style={{ color: gradeTone(s.topPerformer.overall) }}>{s.topPerformer.overall}%</span>
                {' · '}{PERF_STATUS[s.topPerformer.status]}
              </span>
            </>
          ) : (
            <span className="mt-1 block text-[13px] text-[var(--color-ink-faint)]">Nobody is scored yet</span>
          )}
        </span>
      </div>
    </div>

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = filter === f.id
          const [bg, ink] = f.id === 'all'
            ? ['var(--color-ink)', '#ffffff']
            : (on ? [tint(f.id), toneOf(f.id)] : ['var(--color-fill)', 'var(--color-ink-soft)'])
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
              style={on
                ? { background: bg, color: ink }
                : { background: 'var(--color-fill)', color: f.id === 'all' ? 'var(--color-ink-soft)' : toneOf(f.id) }}>
              {f.label} ({f.count(s)})
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employee…" className={`${field} w-[240px] pl-10`} />
        </span>
        <button onClick={exportCsv} className="inline-flex items-center gap-2 btn-secondary hover:bg-[var(--color-soft)]">
          <Download size={15} /> Export
        </button>
      </div>
    </div>

    {/* 🔒 The table SCROLLS rather than squeezing. Without a floor it kept
        compressing until the Status chip was cut in half and Review fell off
        the card entirely, with nothing to tell the reader more was there. */}
    <div className="card mt-4 overflow-x-auto">
      <table className="w-full min-w-[1160px] text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)]">
            <th className={`${th} w-12 rounded-tl-[10px] text-center`}>#</th>
            <th className={th}>Employee</th>
            <th className={th}>Department</th>
            <th className={th} title="Role KPIs, measured by Admin. Only KPIs Admin can answer for are counted.">
              <Dot k="work" /> Work KPIs (from Admin)
            </th>
            <th className={th} title="Days present out of days scheduled, from Pulse attendance.">
              <Dot k="attendance" /> Attendance (from Pulse)
            </th>
            <th className={th} title="The manager's assessment for this month. Only a locked review counts.">
              <Dot k="manager" /> Manager review
            </th>
            <th className={th} title={`Work KPIs ${PERF_WEIGHTS.work}% + attendance ${PERF_WEIGHTS.attendance}% + manager ${PERF_WEIGHTS.manager}%, over the sources that have a number.`}>
              Overall performance
            </th>
            <th className={th}>Status</th>
            <th className={th}>Review</th>
            <th className={`${th} w-10`}></th>
          </tr>
        </thead>
        <tbody>
          {pager.slice.map((p, i) => (
            <tr key={p.username} onClick={() => navigate(`/performance/${p.username}`)}
              className="cursor-pointer border-b border-[var(--color-line-soft)] transition-colors last:border-0 hover:bg-[var(--color-row-hover)]">
              <td className={`${td} text-center text-[13px] font-semibold tabular-nums text-[var(--color-ink-faint)]`}>
                {pager.props.size * (pager.props.page - 1) + i + 1}
              </td>
              <td className={td}>
                <span className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold text-white"
                    style={{ background: p.overall == null ? 'var(--color-pill-inactive)' : gradeTone(p.overall) }}>
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-[var(--color-ink)]">{p.name}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-[var(--color-ink-faint)]">{p.title || '—'}</span>
                  </span>
                </span>
              </td>
              <td className={`${td} whitespace-nowrap text-[13px] text-[var(--color-ink-soft)]`}>{p.department || '—'}</td>
              <td className={td}>
                <Meter pct={p.work?.pct ?? null} tone={SOURCE_TONE.work} width={96} />
                <span className="mt-1 block text-[12px] text-[var(--color-ink-faint)]">
                  {p.work?.measured ? `${p.work.met}/${p.work.measured} targets` : 'No targets yet'}
                </span>
              </td>
              <td className={td}>
                <Meter pct={p.attendance.pct} tone={SOURCE_TONE.attendance} width={96} />
                <span className="mt-1 block text-[12px] text-[var(--color-ink-faint)]">
                  {p.attendance.pct == null
                    ? (p.attendance.keepsSchedule ? 'No data yet' : 'No schedule')
                    : p.attendance.late ? `${p.attendance.late} late` : 'On time'}
                </span>
              </td>
              <td className={td}>
                {p.manager.reviewed
                  ? (<><Stars count={p.manager.stars} /><span className="mt-1 block text-[12px] text-[var(--color-ink-faint)]">Reviewed</span></>)
                  : (<>
                      <span className="flex items-center gap-1.5 text-[13px] text-[var(--color-ink-soft)]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: SOURCE_TONE.manager }} /> Not reviewed
                      </span>
                      <span className="mt-1 block text-[12px] text-[var(--color-ink-faint)]">
                        {p.overall == null ? 'Not due' : 'Due'}
                      </span>
                    </>)}
              </td>
              <td className={td}><Ring pct={p.overall} size={38} /></td>
              <td className={td}><StatusChip status={p.status} /></td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>
                {p.manager.reviewed
                  ? <span className="text-[var(--color-ink-soft)]">{shortDay(p.manager.at)}</span>
                  : p.overall == null
                    ? <span className="text-[var(--color-ink-faint)]">—</span>
                    : <span className="font-semibold" style={{ color: 'var(--color-pill-leave)' }}>Due</span>}
              </td>
              <td className={`${td} text-right`}><ChevronRight size={16} className="text-[var(--color-ink-faint)]" /></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={10}>
              <EmptyState
                title="Nobody matches this view"
                line={`No one in ${monthLabel(month)} fits that filter. Clear the search, or choose All.`}
              />
            </td></tr>
          )}
        </tbody>
      </table>
      <Pager {...pager.props} noun="employees" />
    </div>
    </>
  )
}
