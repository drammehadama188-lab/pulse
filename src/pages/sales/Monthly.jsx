import { useEffect, useMemo, useState } from 'react'
import { Trophy, Phone, MapPin, Target, Wallet } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Card, Pill, Spinner, StatCard } from '../../components/ui.jsx'
import PeriodSelector, { computePeriod, inPeriod } from '../../components/PeriodSelector.jsx'
import { dalasi, dateShort } from '../../lib/format.js'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthsSince(joined) {
  const start = new Date(joined)
  if (isNaN(start.getTime())) return []
  const now = new Date()
  const out = []
  let y = start.getFullYear()
  let m = start.getMonth()
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`)
    m++
    if (m > 11) { m = 0; y++ }
  }
  return out.slice(-12)
}

export default function Monthly() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState(() => computePeriod('this_month'))

  useEffect(() => {
    Promise.all([api('/customers'), api('/activities'), api('/team'), api('/sales-history')]).then(
      ([c, a, t, h]) => {
        setData({ customers: c.customers, activities: a.activities, me: t.team.find((x) => x.name === user.name), history: h.history })
      },
    )
  }, [user.name])

  const perMonthTarget = data?.me?.target || 5

  // selected-period summary
  const r = useMemo(() => {
    if (!data) return null
    const closedCustomers = data.customers.filter((c) => c.status === 'Won' && inPeriod(period, c.wonAt)).sort((a, b) => (a.wonAt < b.wonAt ? 1 : -1))
    const revenue = closedCustomers.reduce((s, c) => s + (Number(c.amountPaid) || Number(c.amountExpected) || 0), 0)
    const calls = data.activities.filter((a) => a.type === 'call' && inPeriod(period, a.date || a.createdAt)).length
    const visits = data.activities.filter((a) => a.type === 'visit' && inPeriod(period, a.date || a.createdAt)).length
    const leads = data.activities.filter((a) => a.type === 'call' && a.callStatus === 'Interested - Lead' && inPeriod(period, a.date || a.createdAt)).length
    const target = period.months ? perMonthTarget * period.months : null
    return { closed: closedCustomers.length, closedCustomers, revenue, calls, visits, leads, target }
  }, [data, period, perMonthTarget])

  // monthly trend since joining (live Won, falling back to seeded history)
  const trend = useMemo(() => {
    if (!data) return []
    const live = {}
    data.customers.filter((c) => c.status === 'Won' && c.wonAt).forEach((c) => {
      const k = c.wonAt.slice(0, 7)
      ;(live[k] ||= { sales: 0, revenue: 0 })
      live[k].sales += 1
      live[k].revenue += Number(c.amountPaid) || Number(c.amountExpected) || 0
    })
    const hist = Object.fromEntries((data.history || []).map((h) => [h.month, h]))
    return monthsSince(data.me?.joined).map((k) => {
      const l = live[k]
      const h = hist[k]
      const sales = l ? l.sales : h ? h.sales : 0
      const revenue = l ? l.revenue : h ? h.revenue : 0
      const [y, mm] = k.split('-')
      return { key: k, label: MON[+mm - 1], year: y, sales, revenue }
    })
  }, [data])

  if (!data) return <div className="flex justify-center py-16"><Spinner size={26} /></div>

  const met = r.target != null && r.closed >= r.target
  const pct = r.target ? Math.min(1, r.closed / r.target) : 0
  const tone = met ? 'good' : period.key === 'this_month' ? 'brand' : 'bad'
  const ringColor = met ? 'var(--color-good)' : 'var(--color-brand)'

  const maxScale = Math.max(perMonthTarget, ...trend.map((t) => t.sales), 1)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Report</h1>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>

      {/* hero: ring + numbers */}
      <Card className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:p-7">
        <Ring pct={pct} value={r.closed} color={ringColor} />
        <div className="flex-1 text-center sm:text-left">
          <div className="text-sm font-semibold text-[var(--color-ink-soft)]">Sales closed · {period.label}</div>
          <div className="mt-1 flex items-end justify-center gap-2 sm:justify-start">
            <span className="text-4xl font-extrabold tracking-tight text-[var(--color-ink)]">{r.closed}</span>
            {r.target != null && <span className="pb-1 text-lg text-[var(--color-ink-faint)]">/ {r.target} target</span>}
            {r.target != null && <span className="pb-1.5"><Pill tone={tone} dot>{met ? 'KPI met' : period.key === 'this_month' ? 'In progress' : 'Below KPI'}</Pill></span>}
          </div>
          <div className="mt-2 text-2xl font-extrabold text-[var(--color-good)]">{dalasi(r.revenue)}</div>
          <div className="text-sm text-[var(--color-ink-faint)]">revenue this period</div>
        </div>
      </Card>

      {/* metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} tone="good" label="Revenue" value={dalasi(r.revenue)} />
        <StatCard icon={Phone} tone="brand" label="Calls" value={r.calls} />
        <StatCard icon={MapPin} tone="rest" label="Visits" value={r.visits} />
        <StatCard icon={Target} tone="warn" label="Leads" value={r.leads} />
      </div>

      {/* monthly performance since joining */}
      <Card className="p-5 sm:p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-bold text-[var(--color-ink)]">Monthly performance</h2>
          <span className="text-xs font-semibold text-[var(--color-ink-faint)]">target {perMonthTarget}/mo</span>
        </div>
        <p className="mb-5 text-xs text-[var(--color-ink-faint)]">Since {data.me?.joined ? dateShort(data.me.joined) : 'joining'}</p>
        {trend.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-faint)]">No history yet.</p>
        ) : (
          <div className="relative flex items-end justify-around gap-3 pt-4" style={{ height: 180 }}>
            {/* target line */}
            <div className="pointer-events-none absolute inset-x-0" style={{ bottom: `${(perMonthTarget / maxScale) * 140 + 28}px` }}>
              <div className="border-t border-dashed border-[var(--color-warn)]/60" />
            </div>
            {trend.map((m) => {
              const h = (m.sales / maxScale) * 140
              const hit = m.sales >= perMonthTarget
              return (
                <div key={m.key} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-sm font-extrabold text-[var(--color-ink)]">{m.sales}</span>
                  <div
                    className="w-full max-w-[46px] rounded-t-lg transition-all"
                    style={{ height: Math.max(6, h), background: hit ? 'var(--color-good)' : 'var(--color-brand)' }}
                    title={`${m.label}: ${m.sales} sales · ${dalasi(m.revenue)}`}
                  />
                  <span className="text-xs font-semibold text-[var(--color-ink-soft)]">{m.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* closed deals in period */}
      <div>
        <h2 className="mb-3 text-base font-bold text-[var(--color-ink)]">Sales closed · {period.label}</h2>
        {r.closedCustomers.length === 0 ? (
          <Card className="px-5 py-10 text-center text-[var(--color-ink-faint)]">No sales closed in this period.</Card>
        ) : (
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {r.closedCustomers.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-good-bg)] text-[var(--color-good)]"><Trophy size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--color-ink)]">{c.company}</div>
                  <div className="text-xs text-[var(--color-ink-faint)]">{c.wonAt ? dateShort(c.wonAt) : ''}</div>
                </div>
                <span className="font-bold text-[var(--color-ink)]">{dalasi(Number(c.amountPaid) || Number(c.amountExpected) || 0)}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}

function Ring({ pct, value, color }) {
  const R = 46
  const C = 2 * Math.PI * R
  const off = C * (1 - pct)
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
      <circle cx="60" cy="60" r={R} fill="none" stroke="var(--color-line)" strokeWidth="11" />
      <circle cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset .6s ease' }} />
      <text x="60" y="60" textAnchor="middle" dominantBaseline="central" className="fill-[var(--color-ink)]" style={{ fontSize: 30, fontWeight: 800 }}>{value}</text>
      <text x="60" y="82" textAnchor="middle" dominantBaseline="central" className="fill-[var(--color-ink-faint)]" style={{ fontSize: 11, fontWeight: 600 }}>sales</text>
    </svg>
  )
}
