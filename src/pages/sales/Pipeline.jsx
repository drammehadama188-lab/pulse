import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Card, Pill, Spinner } from '../../components/ui.jsx'
import PeriodSelector, { computePeriod, inPeriod } from '../../components/PeriodSelector.jsx'
import { CUSTOMER_STATUS } from '../../lib/salesOptions.js'
import { dalasi } from '../../lib/format.js'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { PageSkeleton } from '../../components/ui/Skeleton.jsx'

const ACTIVE = (s) => !['Won', 'Lost', 'Not Available'].includes(s)

export default function Pipeline() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState(() => computePeriod('this_month'))

  useEffect(() => {
    Promise.all([api('/customers'), api('/activities'), api('/team'), api('/me')]).then(([c, a, t, meResp]) => {
      // Own commission from /api/me (pay is server-only, not in the /team roster).
      const meRec = t.team.find((x) => x.name === user.name)
      setData({ customers: c.customers, activities: a.activities, me: meRec ? { ...meRec, commission: meResp.pay?.commission || 0 } : meRec })
    })
  }, [user.name])

  const calc = useMemo(() => {
    if (!data) return null
    const { customers, activities } = data
    const won = customers.filter((c) => c.status === 'Won')
    const lost = customers.filter((c) => c.status === 'Lost')
    const active = customers.filter((c) => ACTIVE(c.status))
    const conversion = customers.length ? Math.round((won.length / customers.length) * 100) : 0
    // period-scoped
    const wonInPeriod = won.filter((c) => inPeriod(period, c.wonAt)).length
    const calls = activities.filter((a) => a.type === 'call' && inPeriod(period, a.date || a.createdAt)).length
    const visits = activities.filter((a) => a.type === 'visit' && inPeriod(period, a.date || a.createdAt)).length
    const leads = activities.filter((a) => a.type === 'call' && a.callStatus === 'Interested - Lead' && inPeriod(period, a.date || a.createdAt)).length
    const revenue = won.filter((c) => inPeriod(period, c.wonAt)).reduce((s, c) => s + (Number(c.amountPaid) || 0), 0)
    return { total: customers.length, active: active.length, won: won.length, lost: lost.length, conversion, wonInPeriod, calls, visits, leads, revenue }
  }, [data, period])

  if (!calc) return <PageSkeleton tiles={0} rows={6} />

  const target = (data.me?.target || 5) * (period.months || 1)
  const onTarget = period.months ? calc.wonInPeriod >= target : false
  const counts = countBy(data.customers, CUSTOMER_STATUS)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="t-page">Pipeline</h1>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>

      {/* current pipeline (all-time state) */}
      <Card className="p-5">
        <div className="mb-4 text-[13px] font-semibold text-[var(--color-ink-soft)]">Current pipeline</div>
        <div className="flex items-center justify-between gap-2 text-center">
          <FunnelStep label="Customers" value={calc.total} />
          <Arrow />
          <FunnelStep label="Active" value={calc.active} />
          <Arrow />
          <FunnelStep label="Won" value={calc.won} tone="good" />
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-[13px]">
          <span className="text-[var(--color-ink-faint)]">Conversion</span>
          <Pill tone={calc.conversion >= 20 ? 'good' : 'warn'}>{calc.conversion}%</Pill>
          <span className="text-[var(--color-ink-faint)]">· {calc.lost} lost</span>
        </div>
      </Card>

      {/* period-scoped sales */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-[var(--color-ink-soft)]">Sales · {period.label}</div>
            <div className="mt-1 text-[26px] font-semibold tracking-tight">
              {calc.wonInPeriod} {period.months && <span className="text-[15px] text-[var(--color-ink-faint)]">/ {target}</span>}
            </div>
          </div>
          {period.months ? <Pill tone={onTarget ? 'good' : 'warn'} dot>{onTarget ? 'Target hit' : `${Math.max(0, target - calc.wonInPeriod)} to go`}</Pill> : null}
        </div>
        {period.months ? (
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (calc.wonInPeriod / target) * 100)}%`, background: onTarget ? 'var(--color-good)' : 'var(--color-brand)' }} />
          </div>
        ) : null}
        {data.me?.commission > 0 && period.key === 'this_month' && (
          <div className="mt-3 text-[13px] text-[var(--color-ink-soft)]">
            Commission {onTarget ? 'earned' : 'on hitting target'}: <span className="font-semibold text-[var(--color-ink)]">{dalasi(data.me.commission)}</span>
          </div>
        )}
      </Card>

      {/* period-scoped activity */}
      <Card className="p-5">
        <div className="mb-3 text-[13px] font-semibold text-[var(--color-ink-soft)]">Activity · {period.label}</div>
        <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
          <Activity label="Calls" v={calc.calls} />
          <Activity label="Visits" v={calc.visits} />
          <Activity label="Leads" v={calc.leads} />
          <Activity label="Revenue" v={dalasi(calc.revenue)} />
        </div>
      </Card>

      {/* status breakdown (current) */}
      <Card className="p-5">
        <div className="mb-3 text-[13px] font-semibold text-[var(--color-ink-soft)]">Customers by status</div>
        {counts.length === 0 ? (
          <EmptyState
            title="No customers yet"
            line="Add a customer and their status appears in this breakdown."
          />
        ) : (
          <div className="space-y-2.5">
            {counts.map(([status, n]) => (
              <div key={status} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-[13px] text-[var(--color-ink-soft)]">{status}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
                  <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${calc.total ? (n / calc.total) * 100 : 0}%` }} />
                </div>
                <span className="w-6 text-right text-[13px] font-semibold text-[var(--color-ink)]">{n}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function countBy(rows, order) {
  const c = {}
  for (const r of rows) c[r.status] = (c[r.status] || 0) + 1
  return order.filter((s) => c[s]).map((s) => [s, c[s]])
}
function FunnelStep({ label, value, tone }) {
  return (
    <div className="flex-1">
      <div className={`text-[22px] font-semibold tracking-tight ${tone === 'good' ? 'text-[var(--color-good)]' : 'text-[var(--color-ink)]'}`}>{value}</div>
      <div className="text-[11.5px] text-[var(--color-ink-faint)]">{label}</div>
    </div>
  )
}
function Arrow() {
  return <span className="text-[var(--color-ink-faint)]">→</span>
}
function Activity({ label, v }) {
  return (
    <div>
      <div className="text-[18px] font-semibold tracking-tight text-[var(--color-ink)]">{v}</div>
      <div className="text-[11.5px] text-[var(--color-ink-faint)]">{label}</div>
    </div>
  )
}
