import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, MessageSquareText, Palmtree, TrendingUp, Wallet } from 'lucide-react'
import { api } from '../lib/api.js'
import { Card, Pill, SectionTitle, Spinner } from '../components/ui.jsx'
import { attendanceBand } from '../lib/performance.js'

// Reports — the month's story (Adama 3 Jul): who came to work and who didn't
// (with the exact days), coaching word-for-word, who's doing what, leave and
// payroll cost. The SERVER composes sections from the viewer's powers + named
// scopes, so this page can never show more than the Access panel says — and
// it's view-as faithful for free. Numbers are REAL only: sections with no
// data say so instead of pretending.

const MONTH_LABEL = { 1: 'January', 2: 'February', 3: 'March', 4: 'April', 5: 'May', 6: 'June', 7: 'July', 8: 'August', 9: 'September', 10: 'October', 11: 'November', 12: 'December' }
const thisMonth = () => new Date().toISOString().slice(0, 7)
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
const monthTitle = (m) => `${MONTH_LABEL[Number(m.slice(5, 7))]} ${m.slice(0, 4)}`
const prettyDay = (k) => new Date(`${k}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const D = (n) => `D${Number(n || 0).toLocaleString()}`

const th = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-faint)]'
const td = 'px-3 py-2.5 text-sm text-[var(--color-ink)]'

export default function Reports() {
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api(`/reports/month?month=${month}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [month])

  const sections = data ? ['attendance', 'coaching', 'leave', 'performance', 'payroll'].filter((k) => data[k]) : []

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Reports</h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">The month's story — attendance, coaching, performance, leave and pay.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-1 py-1">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="rounded-lg p-1.5 hover:bg-[var(--color-paper)]" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <span className="min-w-[9rem] text-center text-sm font-bold">{monthTitle(month)}</span>
          <button onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= thisMonth()} className="rounded-lg p-1.5 hover:bg-[var(--color-paper)] disabled:opacity-30" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </div>

      {loading ? (
        <Card className="flex justify-center py-16"><Spinner size={26} /></Card>
      ) : !sections.length ? (
        <Card className="px-5 py-12 text-center text-[var(--color-ink-faint)]">Nothing to report with your access.</Card>
      ) : (
        <>
          {data.attendance && <AttendanceReport rows={data.attendance} />}
          {data.coaching && <CoachingReport items={data.coaching} />}
          {data.performance && <PerformanceReport rows={data.performance} />}
          {data.leave && <LeaveReport rows={data.leave} />}
          {data.payroll && <PayrollReport rows={data.payroll} />}
        </>
      )}
    </div>
  )
}

// ── Who came to work — and who didn't, with the exact days ─────────────────
function AttendanceReport({ rows }) {
  const totals = rows.reduce((t, r) => ({ worked: t.worked + r.worked, late: t.late + r.late, absent: t.absent + r.absent }), { worked: 0, late: 0, absent: 0 })
  return (
    <section>
      <SectionTitle>
        <span className="flex items-center gap-2"><Clock size={16} className="text-[var(--color-ink-faint)]" /> Who came to work</span>
      </SectionTitle>
      <Card className="overflow-x-auto p-0">
        <div className="border-b border-[var(--color-line-soft)] px-4 py-2.5 text-xs font-medium text-[var(--color-ink-soft)]">
          {totals.worked} work-days done · {totals.late} late arrival{totals.late === 1 ? '' : 's'} · {totals.absent} unexcused absence{totals.absent === 1 ? '' : 's'}
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-[var(--color-line-soft)]">
            <th className={th}>Staff</th><th className={th}>Scheduled</th><th className={th}>Worked</th><th className={th}>Late</th><th className={th}>On leave</th><th className={th}>Absent</th><th className={th}>Attendance</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const b = attendanceBand(r.pct)
              return (
                <tr key={r.username} className="border-b border-[var(--color-line-soft)] last:border-0 align-top">
                  <td className={td}>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-xs text-[var(--color-ink-faint)]">{r.department}</p>
                    {r.absentDays.length > 0 && (
                      <p className="mt-1 text-xs font-medium text-red-600">Missed: {r.absentDays.map(prettyDay).join(' · ')}</p>
                    )}
                  </td>
                  <td className={`${td} tabular-nums`}>{r.scheduled}</td>
                  <td className={`${td} tabular-nums`}>{r.worked}</td>
                  <td className={`${td} tabular-nums ${r.late ? 'font-semibold text-amber-600' : ''}`}>{r.late}</td>
                  <td className={`${td} tabular-nums`}>{r.onLeave}</td>
                  <td className={`${td} tabular-nums ${r.absent ? 'font-semibold text-red-600' : ''}`}>{r.absent}</td>
                  <td className={td}>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${b.chip}`}>
                      {r.pct == null ? '—' : `${r.pct}%`} <span className="font-medium">{b.label}</span>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </section>
  )
}

// ── Coaching — when and what was said, word for word ───────────────────────
function CoachingReport({ items }) {
  const typeTone = { coaching: 'good', flag: 'bad', meeting: 'neutral' }
  return (
    <section>
      <SectionTitle>
        <span className="flex items-center gap-2"><MessageSquareText size={16} className="text-[var(--color-ink-faint)]" /> Coaching — what was said</span>
      </SectionTitle>
      {!items.length ? (
        <Card className="px-5 py-8 text-center text-sm text-[var(--color-ink-faint)]">No coaching logged this month.</Card>
      ) : (
        <Card className="divide-y divide-[var(--color-line-soft)] p-0">
          {items.map((c, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold tabular-nums text-[var(--color-ink-faint)]">{prettyDay(c.date)}</span>
                <span className="text-sm font-semibold">{c.person}</span>
                <Pill tone={typeTone[c.type] || 'neutral'}>{c.type}</Pill>
                {c.title && <span className="text-sm text-[var(--color-ink-soft)]">{c.title}</span>}
              </div>
              {c.note && <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-ink)]">{c.note}</p>}
              <p className="mt-1 text-xs text-[var(--color-ink-faint)]">by {c.by}</p>
            </div>
          ))}
        </Card>
      )}
    </section>
  )
}

// ── Who's doing what — real columns only (rest arrive with the Admin bridge) ─
function PerformanceReport({ rows }) {
  return (
    <section>
      <SectionTitle>
        <span className="flex items-center gap-2"><TrendingUp size={16} className="text-[var(--color-ink-faint)]" /> Who's doing what</span>
      </SectionTitle>
      {!rows.length ? (
        <Card className="px-5 py-8 text-center text-sm text-[var(--color-ink-faint)]">No one in your performance scope.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full">
            <thead><tr className="border-b border-[var(--color-line-soft)]">
              <th className={th}>Staff</th><th className={th}>Sales</th><th className={th}>Revenue</th><th className={th}>Review</th><th className={th}>Coaching</th><th className={th}>Warnings</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-[var(--color-line-soft)] last:border-0 align-top">
                  <td className={td}>
                    <p className="font-semibold">{r.name}</p>
                    {r.customers.length > 0 && <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{r.customers.join(' · ')}</p>}
                  </td>
                  <td className={`${td} tabular-nums`}>{r.sales ?? '—'}</td>
                  <td className={`${td} tabular-nums`}>{r.revenue != null ? D(r.revenue) : '—'}</td>
                  <td className={td}>{r.reviewScore != null ? <span className="font-semibold">{r.reviewScore}<span className="text-xs text-[var(--color-ink-faint)]"> · {r.reviewStatus || 'locked'}</span></span> : <span className="text-[var(--color-ink-faint)]">not locked</span>}</td>
                  <td className={`${td} tabular-nums`}>{r.coachingCount || '—'}</td>
                  <td className={td}>
                    {!r.warnings.length ? <span className="text-[var(--color-ink-faint)]">none</span> : r.warnings.map((w, i) => (
                      <p key={i} className="text-xs"><span className="font-bold text-red-600">{w.type}</span>{w.reason ? ` — ${w.reason}` : ''} <span className="text-[var(--color-ink-faint)]">({w.date})</span></p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  )
}

// ── Leave ────────────────────────────────────────────────────────────────────
function LeaveReport({ rows }) {
  return (
    <section>
      <SectionTitle>
        <span className="flex items-center gap-2"><Palmtree size={16} className="text-[var(--color-ink-faint)]" /> Leave</span>
      </SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead><tr className="border-b border-[var(--color-line-soft)]">
            <th className={th}>Staff</th><th className={th}>Days this month</th><th className={th}>By type</th><th className={th}>Sick used (year)</th><th className={th}>Upcoming</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.username} className="border-b border-[var(--color-line-soft)] last:border-0 align-top">
                <td className={`${td} font-semibold`}>{r.name}</td>
                <td className={`${td} tabular-nums`}>{r.taken || '—'}</td>
                <td className={td}>{Object.keys(r.byType).length ? Object.entries(r.byType).map(([t, n]) => `${t} ${n}d`).join(' · ') : <span className="text-[var(--color-ink-faint)]">none</span>}</td>
                <td className={`${td} tabular-nums`}>{r.sickUsed} of {r.sickAllowance}</td>
                <td className={td}>{!r.upcoming.length ? <span className="text-[var(--color-ink-faint)]">—</span> : r.upcoming.map((l, i) => <p key={i} className="text-xs">{l.type}: {l.from} → {l.to}</p>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  )
}

// ── Payroll cost — payroll power only (server already gates + scopes) ───────
function PayrollReport({ rows }) {
  const total = rows.reduce((s, r) => s + r.total, 0)
  return (
    <section>
      <SectionTitle>
        <span className="flex items-center gap-2"><Wallet size={16} className="text-[var(--color-ink-faint)]" /> Payroll cost</span>
      </SectionTitle>
      {!rows.length ? (
        <Card className="px-5 py-8 text-center text-sm text-[var(--color-ink-faint)]">No payroll recorded for this month yet.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full">
            <thead><tr className="border-b border-[var(--color-line-soft)]">
              <th className={th}>Staff</th><th className={th}>Base</th><th className={th}>Commission</th><th className={th}>Total</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-[var(--color-line-soft)]">
                  <td className={`${td} font-semibold`}>{r.name}</td>
                  <td className={`${td} tabular-nums`}>{D(r.base)}</td>
                  <td className={`${td} tabular-nums`}>{D(r.commission)}</td>
                  <td className={`${td} font-bold tabular-nums`}>{D(r.total)}</td>
                </tr>
              ))}
              <tr>
                <td className={`${td} font-bold`}>Company total</td><td className={td} /><td className={td} />
                <td className={`${td} font-extrabold tabular-nums`}>{D(total)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </section>
  )
}
