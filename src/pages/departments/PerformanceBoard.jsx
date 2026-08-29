import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, Trophy, Gauge, AlertTriangle, HelpCircle, Search, Filter, Download,
  TrendingUp, TrendingDown, Minus, MoreVertical,
} from 'lucide-react'
import Pager, { usePager } from '../../components/ui/Pager.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { band, pctChip, periodLabel, PERF_GROUPS, SCORE_SOURCES, sourceLabel } from '../../lib/performance.js'

// The Team tab of Performance — a list page in the Employees shape: five tiles
// that filter, one filter bar, one table, one Pager. Rows arrive already
// computed and ranked from Performance.jsx; nothing is fetched or scored here.

const CARD = 'card'
const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

function Tile({ icon: Icon, value, label, sub, tint, ink, onClick, on }) {
  return (
    <button type="button" onClick={onClick}
      className={`${CARD} flex min-h-[122px] w-full items-start gap-4 p-5 text-left transition-colors hover:border-[var(--color-line-control)] ${on ? 'border-[var(--color-brand-soft)]' : ''}`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]" style={{ background: tint, color: ink }}>
        <Icon size={20} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[28px] font-semibold leading-none tracking-[-0.4px] text-[var(--color-ink)]">{value}</span>
        <span className="mt-2.5 block text-[13.5px] font-medium text-[var(--color-ink-soft)]">{label}</span>
        <span className="mt-1 block text-[12px] text-[var(--color-ink-faint)]">{sub}</span>
      </span>
    </button>
  )
}

function Trend({ delta }) {
  if (delta == null) return <Minus size={14} className="text-[var(--color-ink-faint)]" />
  if (delta > 0) return <span className="inline-flex items-center gap-0.5 font-semibold text-[var(--color-pill-active)]"><TrendingUp size={14} />+{delta}</span>
  if (delta < 0) return <span className="inline-flex items-center gap-0.5 font-semibold text-[var(--color-stage-out)]"><TrendingDown size={14} />{delta}</span>
  return <Minus size={14} className="text-[var(--color-ink-faint)]" />
}

// Defaults so the component is renderable on its own: the render test mounts
// every page cold, and a board with no rows is also what a failed roster load
// looks like.
const BLANK = { query: '', dept: '', group: '', source: '', min: '', max: '' }
const NO_COUNTS = { total: 0, rated: 0, average: null, performing: 0, 'on-track': 0, attention: 0, unrated: 0 }

export default function PerformanceBoard({
  rows = [], counts = NO_COUNTS, period = { label: 'this period' }, departments = [],
  filters = BLANK, onFilter = () => {}, onClearFilters = () => {}, onExport = () => {},
}) {
  const [moreFilters, setMoreFilters] = useState(false)
  const [menu, setMenu] = useState(null)
  const [picked, setPicked] = useState(() => new Set())

  const { query, dept, group, source, min, max } = filters

  // `rows` arrive already filtered — the filters live on the page beside the
  // export, so what you see, what you export and what the Pager counts are one
  // list.
  const pager = usePager(rows)
  const shown = pager.slice
  useEffect(() => { pager.reset() }, [query, dept, group, source, min, max])

  // The five tiles are five views of ONE list, so only one is ever on, and the
  // first one — whose number is the whole board — has to give back the whole
  // board: every filter goes, not just the tile ones.
  const filtered = !!(group || dept || source || query || min !== '' || max !== '')
  const pickGroup = (g) => onFilter({ group: group === g ? '' : g })

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.key))
  const togglePage = () => setPicked((p) => {
    const n = new Set(p)
    shown.forEach((r) => (allShownPicked ? n.delete(r.key) : n.add(r.key)))
    return n
  })
  const toggleOne = (k) => setPicked((p) => {
    const n = new Set(p)
    n.has(k) ? n.delete(k) : n.add(k)
    return n
  })

  const field = 'field'
  const btn = 'inline-flex items-center gap-2 transition-colors'
  const light = `${btn} btn-secondary hover:bg-[var(--color-soft)]`
  const th = 'h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]'
  const td = 'h-[72px] px-5 py-4'

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Tile icon={Users} value={counts.total} label="On the board"
          sub={counts.average == null ? 'No scores yet' : `Team average ${counts.average}%`}
          tint="var(--color-stage-new-bg)" ink="var(--color-stage-new)" on={!filtered} onClick={onClearFilters} />
        <Tile icon={Trophy} value={counts.performing} label="Performing" sub="Scoring 85% or more"
          tint="var(--color-stage-hired-bg)" ink="var(--color-stage-hired)" on={group === 'performing'} onClick={() => pickGroup('performing')} />
        <Tile icon={Gauge} value={counts['on-track']} label="On track" sub="Between 70% and 84%"
          tint="var(--color-stage-offer-bg)" ink="var(--color-stage-offer)" on={group === 'on-track'} onClick={() => pickGroup('on-track')} />
        <Tile icon={AlertTriangle} value={counts.attention} label="Needs attention" sub="Under 70%"
          tint="var(--color-stage-out-bg)" ink="var(--color-stage-out)" on={group === 'attention'} onClick={() => pickGroup('attention')} />
        <Tile icon={HelpCircle} value={counts.unrated} label="Not rated"
          sub={counts.unrated ? 'No review and no target' : 'Everybody has a score'}
          tint="var(--color-pill-inactive-bg)" ink="var(--color-pill-inactive)" on={group === 'unrated'} onClick={() => pickGroup('unrated')} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="relative min-w-[260px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input value={query} onChange={(e) => onFilter({ query: e.target.value })} placeholder="Search by name or role…" className={`${field} w-full pl-10`} />
        </span>
        <select value={dept} onChange={(e) => onFilter({ dept: e.target.value })} className={field}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={group} onChange={(e) => onFilter({ group: e.target.value })} className={field}>
          <option value="">All performance</option>
          {PERF_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <select value={source} onChange={(e) => onFilter({ source: e.target.value })} className={field}>
          <option value="">Scored any way</option>
          {SCORE_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button onClick={() => setMoreFilters((v) => !v)}
          className={`${light} ${min !== '' || max !== '' ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : ''}`}>
          <Filter size={15} /> Filters{min !== '' || max !== '' ? ' · 1' : ''}
        </button>
      </div>

      {moreFilters && (
        <div className={`${CARD} mt-3 flex flex-wrap items-end gap-3 p-3.5`}>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-[var(--color-ink-faint)]">Score at least</span>
            <input type="number" min="0" max="100" value={min} onChange={(e) => onFilter({ min: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-[var(--color-ink-faint)]">Score at most</span>
            <input type="number" min="0" max="100" value={max} onChange={(e) => onFilter({ max: e.target.value })} className={field} />
          </label>
          {(min !== '' || max !== '') && (
            <button onClick={() => onFilter({ min: '', max: '' })} className="pb-2.5 text-[12.5px] font-semibold text-[var(--color-brand)]">Clear</button>
          )}
        </div>
      )}

      <div className={`${CARD} mt-5 overflow-x-auto`}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
              <th className={`${th} w-12 rounded-tl-[10px]`}>
                <input type="checkbox" checked={allShownPicked} onChange={togglePage} className="accent-[var(--color-brand)]" />
              </th>
              <th className={th}>Employee</th>
              <th className={th}>Department</th>
              <th className={th}>Score</th>
              <th className={th}>Sales vs target</th>
              <th className={th}>Trend</th>
              <th className={th}>Last review</th>
              <th className={th}>Status</th>
              <th className={`${th} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const b = band(r.score)
              const pct = r.sales && r.sales.target ? Math.round((r.sales.sales / r.sales.target) * 100) : null
              return (
                <tr key={r.key} className="border-b border-[var(--color-line-soft)] transition-colors last:border-0 hover:bg-[var(--color-row-hover)]">
                  <td className={td}>
                    <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggleOne(r.key)} className="accent-[var(--color-brand)]" />
                  </td>
                  <td className={td}>
                    <Link to={r.href} className="flex items-center gap-2.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-fill)] text-[12.5px] font-semibold text-[var(--color-ink-soft)]">{initials(r.name)}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-[var(--color-ink)]">{r.name}</span>
                          {r.warnings > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-[11px] font-medium" style={{ background: 'var(--color-stage-out-bg)', color: 'var(--color-stage-out)' }}>
                              <AlertTriangle size={9} />{r.warnings}
                            </span>
                          )}
                          {r.reviewDue && (
                            <span className="inline-flex items-center rounded-full px-1.5 text-[11px] font-medium" style={{ background: 'var(--color-pill-leave-bg)', color: 'var(--color-pill-leave)' }}>Review due</span>
                          )}
                        </span>
                        <span className="mt-1 block truncate text-[12px] text-[var(--color-ink-faint)]">{r.role || '—'}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={`${td} text-[13px] text-[var(--color-ink-soft)]`}>{r.dept}</td>
                  <td className={td}>
                    <span className={`block text-[17px] font-semibold ${b.text}`}>{r.score == null ? '—' : `${r.score}%`}</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--color-ink-faint)]">{sourceLabel(r.source)}</span>
                  </td>
                  <td className={td}>
                    {r.sales && r.sales.target != null
                      ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${pctChip(pct)}`}>{r.sales.sales}/{r.sales.target}</span>
                      : <span className="text-[var(--color-ink-faint)]">—</span>}
                  </td>
                  <td className={`${td} text-[12.5px]`}><Trend delta={r.trend} /></td>
                  <td className={`${td} whitespace-nowrap`}>
                    {r.lastReview
                      ? (<>
                          <span className="block text-[13px] text-[var(--color-ink-soft)]">{periodLabel(r.lastReview.period)}</span>
                          <span className="mt-0.5 block text-[12px] text-[var(--color-ink-faint)]">{r.lastReview.score}%</span>
                        </>)
                      : <span className="text-[var(--color-ink-faint)]">None yet</span>}
                  </td>
                  <td className={td}>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${b.chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${b.bar}`} /> {b.label}
                    </span>
                  </td>
                  <td className="relative px-4 py-2.5 text-right">
                    <button onClick={() => setMenu(menu === r.key ? null : r.key)}
                      className="rounded-[6px] p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)]">
                      <MoreVertical size={15} />
                    </button>
                    {menu === r.key && (
                      <div onMouseLeave={() => setMenu(null)}
                        className="absolute right-4 top-10 z-30 w-52 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-left shadow-[var(--shadow-lift)]">
                        {[['Open performance page', r.href],
                          ['Employee record', `/people/${r.person.username || ''}`],
                          ['Reviews & coaching', '/reviews'],
                          ['Attendance', '/attendance']].map(([label, to]) => (
                            <Link key={label} to={to} className="block rounded-[6px] px-3 py-2 text-[12.5px] font-medium text-[var(--color-ink-soft)] hover:bg-[var(--color-fill)] hover:text-[var(--color-ink)]">{label}</Link>
                          ))}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr><td colSpan={9}>
                <EmptyState
                  title="Nobody matches those filters"
                  line={`Nobody on the board fits this slice of ${period.label}. Try a different search, or widen the department and performance filters.`}
                />
              </td></tr>
            )}
          </tbody>
        </table>

        <Pager {...pager.props} noun="people" />
      </div>

      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur md:pl-[228px]">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-2.5 md:px-8">
            <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">{picked.size} selected</span>
            <button onClick={() => setPicked(new Set())} className="text-[12.5px] font-semibold text-[var(--color-brand)]">Clear</button>
            <span className="flex-1" />
            <button onClick={() => onExport(rows.filter((r) => picked.has(r.key)))} className={light}>
              <Download size={15} /> Export selected
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
