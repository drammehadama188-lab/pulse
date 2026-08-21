import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { Card, Spinner } from '../components/ui.jsx'
import { dalasi } from '../lib/format.js'
import { PageSkeleton } from '../components/ui/Skeleton.jsx'

// BUSINESS REPORT — the 1st-of-the-month read (Adama 10 Jul, CEO only). One
// closed month: goals hit or missed, the money, the team, and the flags that
// need a decision. Everything derives live — nothing written by hand.

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default function BusinessReport() {
  const now = new Date()
  const months = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push(d.toISOString().slice(0, 7))
  }
  const [month, setMonth] = useState(months[0])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null)
    api(`/report/business?month=${month}`).then(setData).catch((e) => setError(e.message))
  }, [month])

  if (error) return <Card className="p-8 text-center text-[13px] text-[var(--color-ink-faint)]">Couldn't load — {error}</Card>
  if (!data) return <PageSkeleton tiles={0} rows={6} />

  return (
    <div className="max-w-4xl space-y-7">
      <div>
        <h1 className="t-page">Business report</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{monthLabel(data.month)} — derived live from Admin, Books and Pulse.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {months.map((m) => (
            <button key={m} onClick={() => setMonth(m)} className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${m === month ? 'bg-[var(--color-ink)] text-white' : 'bg-[var(--color-fill)] text-[var(--color-ink-soft)]'}`}>{monthLabel(m)}</button>
          ))}
        </div>
      </div>

      {/* flags first — what needs a decision */}
      {data.flags.length > 0 && (
        <Card className="border-l-4 border-[var(--color-bad)] p-4">
          <h2 className="text-[11.5px] font-medium text-[var(--color-bad)]">Needs your attention</h2>
          <div className="mt-1 space-y-0.5 text-[13px] text-[var(--color-ink)]">
            {data.flags.map((f, i) => <p key={i}>{f}</p>)}
          </div>
        </Card>
      )}

      {/* goals scoreboard */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Goals</h2>
        <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden p-0">
          {data.goals.map((g) => {
            const hit = g.target != null && g.actual != null && g.actual >= g.target
            return (
              <div key={g.title} className="flex items-center gap-4 px-4 py-3 text-[13px]">
                <span className="w-52 font-semibold text-[var(--color-ink)]">{g.title}</span>
                <span className="tabular-nums text-[var(--color-ink-soft)]"><span className="text-[15px] font-semibold text-[var(--color-ink)]">{g.actual ?? '—'}</span>{g.unit === '%' ? '%' : ''} {g.target != null ? `of ${g.target}${g.unit === '%' ? '%' : ''}` : ''} <span className="text-[11.5px]">{g.unit !== '%' ? g.unit : ''}</span></span>
                {g.actual != null && g.target != null && (
                  <span className={`ml-auto text-[11.5px] font-semibold ${hit ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>{hit ? '✓ Hit' : 'Missed'}</span>
                )}
                {g.actual == null && <span className="ml-auto text-[11.5px] font-semibold text-[var(--color-ink-faint)]">no data</span>}
              </div>
            )
          })}
        </Card>
      </section>

      {/* money */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Money</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Payroll paid</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-ink)]">{dalasi(data.money.payrollCost)}</div>
            <div className="text-[11.5px] text-[var(--color-ink-faint)]">{data.money.payrollPeople} payment{data.money.payrollPeople === 1 ? '' : 's'} recorded</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Renewal revenue</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-good)]">{data.money.renewalRevenue != null ? dalasi(data.money.renewalRevenue) : '—'}</div>
            <div className="text-[11.5px] text-[var(--color-ink-faint)]">renewals recorded × D6,500</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Still out there</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-bad)]">{data.money.renewalOutstanding != null ? dalasi(data.money.renewalOutstanding) : '—'}</div>
            <div className="text-[11.5px] text-[var(--color-ink-faint)]">customers due, not yet renewed</div>
          </Card>
        </div>
      </section>

      {/* team */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-medium text-[var(--color-ink-faint)]">Team</h2>
        <Card className="flex flex-wrap gap-x-8 gap-y-2 p-4">
          <div>
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Headcount</div>
            <div className="text-[18px] font-semibold tabular-nums text-[var(--color-ink)]">{data.team.headcount}</div>
          </div>
          <div>
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Attendance</div>
            <div className="text-[18px] font-semibold tabular-nums text-[var(--color-ink)]">{data.team.attendancePct != null ? `${data.team.attendancePct}%` : '—'}</div>
            <div className="text-[11.5px] text-[var(--color-ink-faint)]">{data.team.worked} of {data.team.scheduled} scheduled days worked</div>
          </div>
          <div>
            <div className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Late arrivals</div>
            <div className="text-[18px] font-semibold tabular-nums text-[var(--color-ink)]">{data.team.late}</div>
          </div>
        </Card>
      </section>

      <p className="text-[11px] text-[var(--color-ink-faint)]">Generated {new Date(data.generatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — open it any time; the 1st of the month is when the previous month is complete.</p>
    </div>
  )
}
