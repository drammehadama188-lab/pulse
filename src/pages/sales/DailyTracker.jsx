import { useEffect, useMemo, useState } from 'react'
import { Phone, MapPin, StickyNote, Trophy, Target, LogIn } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Card, Pill, Spinner } from '../../components/ui.jsx'
import { timeShort, dateLong, dalasi } from '../../lib/format.js'
import { ymd } from '../../lib/schedule.js'

const blank = () => ({ calls: 0, visits: 0, notes: 0, leads: 0, sales: 0, revenue: 0, checkIn: null, checkOut: null })

export default function DailyTracker() {
  const { user } = useAuth()
  const [data, setData] = useState(null)

  useEffect(() => {
    Promise.all([api('/activities'), api('/customers'), api('/attendance/mine')]).then(([a, c, att]) => {
      setData({ activities: a.activities, customers: c.customers, attendance: att.records })
    })
  }, [user.name])

  const days = useMemo(() => {
    if (!data) return []
    const map = {}
    const get = (k) => (map[k] ||= blank())

    data.activities.forEach((a) => {
      const k = (a.date || a.createdAt || '').slice(0, 10)
      if (!k) return
      const d = get(k)
      if (a.type === 'call') {
        d.calls += 1
        if (a.callStatus === 'Interested - Lead') d.leads += 1
      } else if (a.type === 'visit') d.visits += 1
      else if (a.type === 'note') d.notes += 1
    })
    data.customers.filter((c) => c.status === 'Won' && c.wonAt).forEach((c) => {
      const d = get(c.wonAt.slice(0, 10))
      d.sales += 1
      d.revenue += Number(c.amountPaid) || Number(c.amountExpected) || 0
    })
    data.attendance.forEach((r) => {
      const d = get(r.date)
      d.checkIn = r.checkIn
      d.checkOut = r.checkOut
    })

    return Object.entries(map)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (a.key < b.key ? 1 : -1))
  }, [data])

  if (!data) return <div className="flex justify-center py-16"><Spinner size={26} /></div>

  const todayKey = ymd(new Date())
  const today = days.find((d) => d.key === todayKey) || { key: todayKey, ...blank() }
  const past = days.filter((d) => d.key !== todayKey)
  const hasToday = today.calls || today.visits || today.notes || today.sales || today.checkIn

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[27px]">My Day</h1>
        <p className="mt-1 text-[var(--color-ink-soft)]">{dateLong()} · auto-summarised from what you log.</p>
      </div>

      {/* today */}
      <Card className="p-5 sm:p-6" >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-[var(--color-ink)]">Today</h2>
          {today.checkIn ? (
            <Pill tone="good" dot>In at {timeShort(today.checkIn)}{today.checkOut ? ` · out ${timeShort(today.checkOut)}` : ''}</Pill>
          ) : (
            <Pill tone="neutral">Not checked in</Pill>
          )}
        </div>
        {hasToday ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric icon={Phone} tone="brand" label="Calls" value={today.calls} />
            <Metric icon={MapPin} tone="rest" label="Visits" value={today.visits} />
            <Metric icon={Target} tone="warn" label="Leads" value={today.leads} />
            <Metric icon={Trophy} tone="good" label="Sales" value={today.sales} sub={today.revenue ? dalasi(today.revenue) : null} />
          </div>
        ) : (
          <p className="py-4 text-center text-[var(--color-ink-faint)]">Nothing logged yet today. Check in, log a call or a visit and it shows up here.</p>
        )}
        {today.notes > 0 && <div className="mt-3 text-sm text-[var(--color-ink-faint)]"><StickyNote size={13} className="mr-1 inline" />{today.notes} note{today.notes > 1 ? 's' : ''} added</div>}
      </Card>

      {/* recent days */}
      <div>
        <h2 className="mb-3 text-base font-bold text-[var(--color-ink)]">Recent days</h2>
        {past.length === 0 ? (
          <Card className="px-5 py-10 text-center text-[var(--color-ink-faint)]">No earlier activity yet.</Card>
        ) : (
          <Card className="divide-y divide-[var(--color-line-soft)] overflow-hidden">
            {past.map((d) => (
              <div key={d.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <div className="w-32 shrink-0">
                  <div className="font-semibold text-[var(--color-ink)]">
                    {new Date(d.key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </div>
                  {d.checkIn && <div className="text-xs text-[var(--color-ink-faint)]"><LogIn size={11} className="mr-1 inline" />{timeShort(d.checkIn)}</div>}
                </div>
                <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-ink-soft)]">
                  {d.calls > 0 && <Chip icon={Phone}>{d.calls} calls</Chip>}
                  {d.visits > 0 && <Chip icon={MapPin}>{d.visits} visits</Chip>}
                  {d.leads > 0 && <Chip icon={Target}>{d.leads} leads</Chip>}
                  {d.notes > 0 && <Chip icon={StickyNote}>{d.notes} notes</Chip>}
                </div>
                {d.sales > 0 && (
                  <Pill tone="good">{d.sales} sale{d.sales > 1 ? 's' : ''} · {dalasi(d.revenue)}</Pill>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}

function Metric({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className="rounded-lg bg-[var(--color-fill)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--color-ink-soft)]">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ color: `var(--color-${tone})`, background: `var(--color-${tone}-bg)` }}>
          <Icon size={15} />
        </span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">{value}</div>
      {sub && <div className="text-xs text-[var(--color-good)]">{sub}</div>}
    </div>
  )
}

function Chip({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={14} className="text-[var(--color-ink-faint)]" />
      {children}
    </span>
  )
}
