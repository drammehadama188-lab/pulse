import { useMemo } from 'react'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { band } from '../../lib/performance.js'

// The Departments tab of Performance — the same rows, grouped. It used to be a
// bar chart wedged above the team table, where it competed with the list for
// the same glance. One job per tab.
//
// 🔒 A department's average is the average of the people in it who HAVE a
// score. Counting an unrated person as zero would mark a whole department down
// for a review nobody has written yet, so "rated" is shown beside it.

const CARD = 'card'

export default function PerformanceDepartments({ rows = [], period = { label: 'this period' } }) {
  const depts = useMemo(() => {
    const groups = {}
    rows.forEach((r) => { (groups[r.dept] = groups[r.dept] || []).push(r) })
    const arr = Object.entries(groups).map(([name, members]) => {
      const rated = members.filter((m) => m.score != null)
      const avg = rated.length ? Math.round(rated.reduce((s, m) => s + m.score, 0) / rated.length) : null
      const sorted = rated.slice().sort((a, b) => b.score - a.score)
      return {
        name,
        people: members.length,
        rated: rated.length,
        avg,
        best: sorted[0] || null,
        lowest: sorted.length > 1 ? sorted[sorted.length - 1] : null,
        attention: members.filter((m) => m.group === 'attention').length,
      }
    })
    const rankable = arr.filter((d) => d.avg != null).sort((a, b) => b.avg - a.avg)
    return arr.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)).map((d) => {
      let standing = 'Stable'
      if (d.avg == null) standing = 'Not rated'
      else if (rankable.length > 1 && d.name === rankable[0].name) standing = 'Best performing'
      else if (rankable.length > 1 && d.name === rankable[rankable.length - 1].name) standing = 'Needs improvement'
      return { ...d, standing }
    })
  }, [rows])

  const tone = (standing) => (
    standing === 'Best performing' ? { background: 'var(--color-pill-active-bg)', color: 'var(--color-pill-active)' }
      : standing === 'Needs improvement' ? { background: 'var(--color-stage-out-bg)', color: 'var(--color-stage-out)' }
        : { background: 'var(--color-pill-inactive-bg)', color: 'var(--color-pill-inactive)' }
  )

  const th = 'h-[46px] px-5 text-[11.5px] font-medium text-[var(--color-ink-faint)]'
  const td = 'h-[72px] px-5 py-4'

  if (!depts.length) {
    return (
      <div className={CARD}>
        <EmptyState title="No departments to compare" line="Nobody on the board has a department yet, so there is nothing to group by." />
      </div>
    )
  }

  return (
    <div className={`${CARD} overflow-x-auto`}>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-line-soft)] bg-[var(--color-table-head)] text-left text-[11.5px] font-medium text-[var(--color-ink-faint)]">
            <th className={`${th} rounded-tl-[10px]`}>Department</th>
            <th className={th}>People</th>
            <th className={th}>Rated</th>
            <th className={`${th} w-[280px]`}>Average · {period.label}</th>
            <th className={th}>Strongest</th>
            <th className={th}>Needs attention</th>
            <th className={th}>Standing</th>
          </tr>
        </thead>
        <tbody>
          {depts.map((d) => {
            const b = band(d.avg)
            return (
              <tr key={d.name} className="border-b border-[var(--color-line-soft)] transition-colors last:border-0 hover:bg-[var(--color-row-hover)]">
                <td className={`${td} text-[13px] font-semibold text-[var(--color-ink)]`}>{d.name}</td>
                <td className={`${td} text-[13px] text-[var(--color-ink-soft)] tabular-nums`}>{d.people}</td>
                <td className={`${td} text-[13px] text-[var(--color-ink-soft)] tabular-nums`}>{d.rated} of {d.people}</td>
                <td className={td}>
                  <span className="flex items-center gap-3">
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--color-fill)]">
                      <span className={`block h-full rounded-full ${b.bar}`} style={{ width: `${d.avg ?? 0}%` }} />
                    </span>
                    <span className={`w-11 shrink-0 text-right text-[13px] font-semibold tabular-nums ${b.text}`}>{d.avg == null ? '—' : `${d.avg}%`}</span>
                  </span>
                </td>
                <td className={`${td} text-[13px] text-[var(--color-ink-soft)]`}>
                  {d.best ? (<>
                    <span className="block">{d.best.name}</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--color-ink-faint)]">{d.best.score}%</span>
                  </>) : <span className="text-[var(--color-ink-faint)]">—</span>}
                </td>
                <td className={`${td} text-[13px] tabular-nums`}>
                  <span className={d.attention ? 'font-semibold text-[var(--color-stage-out)]' : 'text-[var(--color-ink-faint)]'}>{d.attention || '—'}</span>
                </td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={tone(d.standing)}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" /> {d.standing}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
